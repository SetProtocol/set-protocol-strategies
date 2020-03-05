require('module-alias/register');

import * as _ from 'lodash';
import * as ABIDecoder from 'abi-decoder';
import * as chai from 'chai';
import * as setProtocolUtils from 'set-protocol-utils';

import { Address } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import { Blockchain } from 'set-protocol-contracts';
import { ether } from '@utils/units';
import {
  Core,
  CoreContract,
  LinearAuctionPriceCurveContract,
  RebalancingSetTokenContract,
  RebalancingSetTokenFactoryContract,
  SetTokenContract,
  SetTokenFactoryContract,
  TransferProxyContract,
  WethMockContract,
  WhiteListContract,
} from 'set-protocol-contracts';
import {
  ConstantPriceOracleContract,
  EMAOracleContract,
  LegacyMakerOracleAdapterContract,
  LinearizedEMATimeSeriesFeedContract,
  MedianContract,
  OracleProxyContract,
} from 'set-protocol-oracles';
import {
  BinaryAllocatorContract,
  MovingAverageCrossoverTriggerContract,
  AssetPairManagerContract,
  USDCMockContract,
} from '@utils/contracts';

import {
  DEFAULT_GAS,
  ETH_DECIMALS,
  ONE,
  ONE_DAY_IN_SECONDS,
  ONE_HOUR_IN_SECONDS,
  RISK_COLLATERAL_NATURAL_UNIT,
  STABLE_COLLATERAL_NATURAL_UNIT,
  USDC_DECIMALS,
  ZERO
} from '@utils/constants';

import { extractNewSetTokenAddressFromLogs } from '@utils/contract_logs/core';
import { expectRevertError } from '@utils/tokenAssertions';
import { getWeb3 } from '@utils/web3Helper';

import { ERC20Helper } from '@utils/helpers/erc20Helper';
import { ManagerHelper } from '@utils/helpers/managerHelper';
import { OracleHelper } from 'set-protocol-oracles';
import { ProtocolHelper } from '@utils/helpers/protocolHelper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;
const setTestUtils = new SetTestUtils(web3);

contract('Integration: AssetPairManager', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let rebalancingSetToken: RebalancingSetTokenContract;

  let core: CoreContract;
  let transferProxy: TransferProxyContract;
  let factory: SetTokenFactoryContract;
  let rebalancingFactory: RebalancingSetTokenFactoryContract;
  let linearAuctionPriceCurve: LinearAuctionPriceCurveContract;
  let whiteList: WhiteListContract;
  let usdcMock: USDCMockContract;
  let wrappedETH: WethMockContract;

  let ethMedianizer: MedianContract;
  let legacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let oracleProxy: OracleProxyContract;
  let usdcOracle: ConstantPriceOracleContract;
  let timeSeriesFeed: LinearizedEMATimeSeriesFeedContract;
  let emaOracle: EMAOracleContract;

  let trigger: MovingAverageCrossoverTriggerContract;
  let allocator: BinaryAllocatorContract;

  let setManager: AssetPairManagerContract;
  let quoteAssetCollateral: SetTokenContract;
  let baseAssetCollateral: SetTokenContract;

  let initialEthPrice: BigNumber;
  let usdcPrice: BigNumber;
  let timePeriod: BigNumber;

  const protocolHelper = new ProtocolHelper(deployerAccount);
  const erc20Helper = new ERC20Helper(deployerAccount);
  const managerHelper = new ManagerHelper(deployerAccount);
  const oracleHelper = new OracleHelper(deployerAccount);

  before(async () => {
    ABIDecoder.addABI(Core.abi);
  });

  after(async () => {
    ABIDecoder.removeABI(Core.abi);
  });

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    transferProxy = await protocolHelper.getDeployedTransferProxyAsync();
    core = await protocolHelper.getDeployedCoreAsync();

    factory = await protocolHelper.getDeployedSetTokenFactoryAsync();
    rebalancingFactory = await protocolHelper.getDeployedRebalancingSetTokenFactoryAsync();
    linearAuctionPriceCurve = await protocolHelper.getDeployedLinearAuctionPriceCurveAsync();
    whiteList = await protocolHelper.getDeployedWhiteList();

    ethMedianizer = await protocolHelper.getDeployedWETHMedianizerAsync();
    await oracleHelper.addPriceFeedOwnerToMedianizer(ethMedianizer, deployerAccount);

    initialEthPrice = ether(150);
    await oracleHelper.updateMedianizerPriceAsync(
      ethMedianizer,
      initialEthPrice,
      SetTestUtils.generateTimestamp(1000),
    );

    usdcMock = await erc20Helper.deployUSDCTokenAsync(deployerAccount);
    await protocolHelper.addTokenToWhiteList(usdcMock.address, whiteList);
    await blockchain.increaseTimeAsync(ONE);
    await protocolHelper.addTokenToWhiteList(usdcMock.address, whiteList);

    wrappedETH = await protocolHelper.getDeployedWETHAsync();
    await erc20Helper.approveTransfersAsync(
      [usdcMock, wrappedETH],
      transferProxy.address
    );

    legacyMakerOracleAdapter = await oracleHelper.deployLegacyMakerOracleAdapterAsync(
      ethMedianizer.address,
    );

    oracleProxy = await oracleHelper.deployOracleProxyAsync(
      legacyMakerOracleAdapter.address,
    );

    usdcPrice = ether(1);
    usdcOracle = await oracleHelper.deployConstantPriceOracleAsync(usdcPrice);

    timePeriod = new BigNumber(26);
    const seededValues = [initialEthPrice];
    timeSeriesFeed = await oracleHelper.deployLinearizedEMATimeSeriesFeedAsync(
      oracleProxy.address,
      timePeriod,
      seededValues
    );

    emaOracle = await oracleHelper.deployEMAOracleAsync(
      [timeSeriesFeed.address],
      [timePeriod],
    );

    quoteAssetCollateral = await protocolHelper.createSetTokenAsync(
      core,
      factory.address,
      [usdcMock.address],
      [new BigNumber(128)],
      STABLE_COLLATERAL_NATURAL_UNIT,
    );

    baseAssetCollateral = await protocolHelper.createSetTokenAsync(
      core,
      factory.address,
      [wrappedETH.address],
      [new BigNumber(1048576)],
      RISK_COLLATERAL_NATURAL_UNIT,
    );

    trigger = await managerHelper.deployMovingAverageCrossoverTrigger(
      emaOracle.address,
      oracleProxy.address,
      timePeriod,
    );

    allocator = await managerHelper.deployBinaryAllocatorAsync(
      wrappedETH.address,
      usdcMock.address,
      oracleProxy.address,
      usdcOracle.address,
      baseAssetCollateral.address,
      quoteAssetCollateral.address,
      core.address,
      factory.address
    );

    await oracleHelper.addAuthorizedAddressesToOracleProxy(
      oracleProxy,
      [timeSeriesFeed.address, allocator.address, trigger.address]
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#confirmPropose', async () => {
    let subjectTimeFastForward: BigNumber;
    let subjectCaller: Address;

    let crossoverPrice: BigNumber;
    let confirmPrice: BigNumber;
    let updateMarketState: boolean;

    let baseAssetAllocation: BigNumber;
    let auctionStartPercentage: BigNumber;
    let auctionEndPercentage: BigNumber;
    let auctionTimeToPivot: BigNumber;

    let collateralSetAddress: Address;
    let proposalPeriod: BigNumber;

    before(async () => {
      crossoverPrice = ether(140);
      confirmPrice = crossoverPrice;
      baseAssetAllocation = new BigNumber(100);
      updateMarketState = true;
    });

    beforeEach(async () => {
      auctionStartPercentage = new BigNumber(2);
      auctionEndPercentage = new BigNumber(10);
      auctionTimeToPivot = ONE_HOUR_IN_SECONDS.mul(4);
      const allocationPrecision = new BigNumber(100);
      const maxBaseAssetAllocation = new BigNumber(100);
      const signalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      const signalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      setManager = await managerHelper.deployAssetPairManagerAsync(
        core.address,
        allocator.address,
        trigger.address,
        linearAuctionPriceCurve.address,
        baseAssetAllocation,
        allocationPrecision,
        maxBaseAssetAllocation,
        auctionStartPercentage,
        auctionEndPercentage,
        auctionTimeToPivot,
        signalConfirmationMinTime,
        signalConfirmationMaxTime,
        subjectCaller,
      );

      collateralSetAddress = baseAssetAllocation.equals(ZERO) ? quoteAssetCollateral.address
        : baseAssetCollateral.address;

      proposalPeriod = ONE_DAY_IN_SECONDS;
      rebalancingSetToken = await protocolHelper.createDefaultRebalancingSetTokenAsync(
        core,
        rebalancingFactory.address,
        setManager.address,
        collateralSetAddress,
        proposalPeriod
      );

      await setManager.initialize.sendTransactionAsync(
        rebalancingSetToken.address,
        { from: subjectCaller, gas: DEFAULT_GAS}
      );

      const lastBlockInfo = await web3.eth.getBlock('latest');
      await oracleHelper.updateMedianizerPriceAsync(
        ethMedianizer,
        crossoverPrice,
        new BigNumber(lastBlockInfo.timestamp + 1),
      );

      await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS);

      await setManager.initialPropose.sendTransactionAsync();

      if (updateMarketState) {
        const lastBlockInfo = await web3.eth.getBlock('latest');
        await oracleHelper.updateMedianizerPriceAsync(
          ethMedianizer,
          confirmPrice,
          new BigNumber(lastBlockInfo.timestamp + 1),
        );
      }

      subjectTimeFastForward = ONE_HOUR_IN_SECONDS.mul(7);
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      await blockchain.increaseTimeAsync(subjectTimeFastForward);
      return setManager.confirmPropose.sendTransactionAsync(
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    describe('when propose is called from the Default state', async () => {
      describe('and allocating from base asset to quote asset', async () => {
        it('updates to the next set correctly', async () => {
          await subject();

          const actualNextSet = await rebalancingSetToken.nextSet.callAsync();
          expect(actualNextSet).to.equal(quoteAssetCollateral.address);
        });

        it('updates to the new auction library correctly', async () => {
          await subject();

          const newAuctionLibrary = await rebalancingSetToken.auctionLibrary.callAsync();
          expect(newAuctionLibrary).to.equal(linearAuctionPriceCurve.address);
        });

        it('updates the time to pivot correctly', async () => {
          await subject();

          const auctionPriceParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
          const newAuctionTimeToPivot = auctionPriceParameters[1];
          expect(newAuctionTimeToPivot).to.be.bignumber.equal(auctionTimeToPivot);
        });

        it('updates the auction start price correctly', async () => {
          await subject();

          const baseCollateralValue = await managerHelper.calculateSetTokenValue(
            baseAssetCollateral,
            [confirmPrice],
            [ETH_DECIMALS],
          );

          const quoteCollateralValue = await managerHelper.calculateSetTokenValue(
            quoteAssetCollateral,
            [ether(1)],
            [USDC_DECIMALS],
          );

          const auctionPriceParameters = managerHelper.calculateLinearAuctionParameters(
            baseCollateralValue,
            quoteCollateralValue,
            auctionStartPercentage,
            auctionEndPercentage
          );

          const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
          const newAuctionStartPrice = newAuctionParameters[2];

          expect(newAuctionStartPrice).to.be.bignumber.equal(auctionPriceParameters['auctionStartPrice']);
        });

        it('updates the auction pivot price correctly', async () => {
          await subject();

          const baseCollateralValue = await managerHelper.calculateSetTokenValue(
            baseAssetCollateral,
            [confirmPrice],
            [ETH_DECIMALS],
          );

          const quoteCollateralValue = await managerHelper.calculateSetTokenValue(
            quoteAssetCollateral,
            [ether(1)],
            [USDC_DECIMALS],
          );

          const auctionPriceParameters = managerHelper.calculateLinearAuctionParameters(
            baseCollateralValue,
            quoteCollateralValue,
            auctionStartPercentage,
            auctionEndPercentage
          );

          const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
          const newAuctionPivotPrice = newAuctionParameters[3];

          expect(newAuctionPivotPrice).to.be.bignumber.equal(auctionPriceParameters['auctionPivotPrice']);
        });

        describe('but quote collateral is 4x valuable than base collateral', async () => {
          before(async () => {
            crossoverPrice = ether(25);
            confirmPrice = crossoverPrice;
          });

          after(async () => {
            crossoverPrice = ether(140);
            confirmPrice = crossoverPrice;
          });

          it('should pass correct next set address', async () => {
            const txHash = await subject();

            const logs = await setTestUtils.getLogsFromTxHash(txHash);
            const expectedNextSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);

            const actualNextSetAddress = await rebalancingSetToken.nextSet.callAsync();
            expect(actualNextSetAddress).to.equal(expectedNextSetAddress);
          });

          it('updates new quote collateral to the correct naturalUnit', async () => {
            await subject();

            const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
            const nextSetNaturalUnit = await nextSet.naturalUnit.callAsync();

            const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParametersAsync(
              baseAssetCollateral,
              confirmPrice,
              usdcPrice,
              ETH_DECIMALS,
              USDC_DECIMALS,
            );
            expect(nextSetNaturalUnit).to.be.bignumber.equal(expectedNextSetParams['naturalUnit']);
          });

          it('updates new quote collateral to the correct units', async () => {
            await subject();

            const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
            const nextSetUnits = await nextSet.getUnits.callAsync();

            const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParametersAsync(
              baseAssetCollateral,
              confirmPrice,
              usdcPrice,
              ETH_DECIMALS,
              USDC_DECIMALS,
            );
            expect(JSON.stringify(nextSetUnits)).to.be.eql(JSON.stringify(expectedNextSetParams['units']));
          });

          it('updates new quote collateral to the correct components', async () => {
            await subject();

            const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
            const nextSetComponents = await nextSet.getComponents.callAsync();

            const expectedNextSetComponents = [usdcMock.address];
            expect(JSON.stringify(nextSetComponents)).to.be.eql(JSON.stringify(expectedNextSetComponents));
          });

          it('updates the auction start price correctly', async () => {
            const txHash = await subject();

            const logs = await setTestUtils.getLogsFromTxHash(txHash);
            const newSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);
            const newSet = await protocolHelper.getSetTokenAsync(newSetAddress);

            const baseCollateralValue = await managerHelper.calculateSetTokenValue(
              baseAssetCollateral,
              [confirmPrice],
              [ETH_DECIMALS],
            );

            const quoteCollateralValue = await managerHelper.calculateSetTokenValue(
              newSet,
              [ether(1)],
              [USDC_DECIMALS],
            );

            const auctionPriceParameters = managerHelper.calculateLinearAuctionParameters(
              baseCollateralValue,
              quoteCollateralValue,
              auctionStartPercentage,
              auctionEndPercentage
            );

            const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
            const newAuctionStartPrice = newAuctionParameters[2];

            expect(newAuctionStartPrice).to.be.bignumber.equal(auctionPriceParameters['auctionStartPrice']);
          });

          it('updates the auction pivot price correctly', async () => {
            const txHash = await subject();

            const logs = await setTestUtils.getLogsFromTxHash(txHash);
            const newSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);
            const newSet = await protocolHelper.getSetTokenAsync(newSetAddress);

            const baseCollateralValue = await managerHelper.calculateSetTokenValue(
              baseAssetCollateral,
              [confirmPrice],
              [ETH_DECIMALS],
            );

            const quoteCollateralValue = await managerHelper.calculateSetTokenValue(
              newSet,
              [ether(1)],
              [USDC_DECIMALS],
            );

            const auctionPriceParameters = managerHelper.calculateLinearAuctionParameters(
              baseCollateralValue,
              quoteCollateralValue,
              auctionStartPercentage,
              auctionEndPercentage
            );

            const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
            const newAuctionPivotPrice = newAuctionParameters[3];

            expect(newAuctionPivotPrice).to.be.bignumber.equal(auctionPriceParameters['auctionPivotPrice']);
          });
        });

        describe('but new stable collateral requires bump in natural unit', async () => {
          before(async () => {
            crossoverPrice = ether(.4);
            confirmPrice = crossoverPrice;
          });

          after(async () => {
            crossoverPrice = ether(140);
            confirmPrice = crossoverPrice;
          });

          it('should pass correct next set address', async () => {
            const txHash = await subject();

            const logs = await setTestUtils.getLogsFromTxHash(txHash);
            const expectedNextSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);

            const actualNextSetAddress = await rebalancingSetToken.nextSet.callAsync();
            expect(actualNextSetAddress).to.equal(expectedNextSetAddress);
          });

          it('updates new stable collateral to the correct naturalUnit', async () => {
            await subject();

            const newSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const newSet = await protocolHelper.getSetTokenAsync(newSetAddress);
            const newSetNaturalUnit = await newSet.naturalUnit.callAsync();

            const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParametersAsync(
              baseAssetCollateral,
              confirmPrice,
              usdcPrice,
              ETH_DECIMALS,
              USDC_DECIMALS,
            );
            expect(newSetNaturalUnit).to.be.bignumber.equal(expectedNextSetParams['naturalUnit']);
          });

          it('updates new stable collateral to the correct units', async () => {
            await subject();

            const newSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const newSet = await protocolHelper.getSetTokenAsync(newSetAddress);
            const newSetUnits = await newSet.getUnits.callAsync();

            const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParametersAsync(
              baseAssetCollateral,
              confirmPrice,
              usdcPrice,
              ETH_DECIMALS,
              USDC_DECIMALS,
            );
            expect(JSON.stringify(newSetUnits)).to.be.eql(JSON.stringify(expectedNextSetParams['units']));
          });

          it('updates new stable collateral to the correct components', async () => {
            await subject();

            const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
            const nextSetComponents = await nextSet.getComponents.callAsync();

            const expectedNextSetComponents = [usdcMock.address];
            expect(JSON.stringify(nextSetComponents)).to.be.eql(JSON.stringify(expectedNextSetComponents));
          });

          it('updates the auction start price correctly', async () => {
            const txHash = await subject();

            const logs = await setTestUtils.getLogsFromTxHash(txHash);
            const newSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);
            const newSet = await protocolHelper.getSetTokenAsync(newSetAddress);

            const baseCollateralValue = await managerHelper.calculateSetTokenValue(
              baseAssetCollateral,
              [confirmPrice],
              [ETH_DECIMALS],
            );

            const quoteCollateralValue = await managerHelper.calculateSetTokenValue(
              newSet,
              [ether(1)],
              [USDC_DECIMALS],
            );

            const auctionPriceParameters = managerHelper.calculateLinearAuctionParameters(
              baseCollateralValue,
              quoteCollateralValue,
              auctionStartPercentage,
              auctionEndPercentage
            );

            const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
            const newAuctionStartPrice = newAuctionParameters[2];

            expect(newAuctionStartPrice).to.be.bignumber.equal(auctionPriceParameters['auctionStartPrice']);
          });

          it('updates the auction pivot price correctly', async () => {
            const txHash = await subject();

            const logs = await setTestUtils.getLogsFromTxHash(txHash);
            const newSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);
            const newSet = await protocolHelper.getSetTokenAsync(newSetAddress);

            const baseCollateralValue = await managerHelper.calculateSetTokenValue(
              baseAssetCollateral,
              [confirmPrice],
              [ETH_DECIMALS],
            );

            const quoteCollateralValue = await managerHelper.calculateSetTokenValue(
              newSet,
              [ether(1)],
              [USDC_DECIMALS],
            );

            const auctionPriceParameters = managerHelper.calculateLinearAuctionParameters(
              baseCollateralValue,
              quoteCollateralValue,
              auctionStartPercentage,
              auctionEndPercentage
            );

            const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
            const newAuctionPivotPrice = newAuctionParameters[3];

            expect(newAuctionPivotPrice).to.be.bignumber.equal(auctionPriceParameters['auctionPivotPrice']);
          });
        });

        describe('but price has not dipped below MA', async () => {
          before(async () => {
            confirmPrice = ether(155);
          });

          after(async () => {
            confirmPrice = ether(140);
          });

          it('should revert', async () => {
            await expectRevertError(subject());
          });
        });

        describe('but not enough time has passed from last rebalance', async () => {
          beforeEach(async () => {
            subjectTimeFastForward = ZERO;
          });

          it('should revert', async () => {
            await expectRevertError(subject());
          });
        });
      });

      describe('and allocating from quote asset to base asset', async () => {
        before(async () => {
          baseAssetAllocation = ZERO;
          crossoverPrice = ether(170);
          confirmPrice = crossoverPrice;
        });

        after(async () => {
          baseAssetAllocation = new BigNumber(100);
          crossoverPrice = ether(140);
          confirmPrice = crossoverPrice;
        });

        it('updates to the next set correctly', async () => {
          await subject();

          const actualNextSet = await rebalancingSetToken.nextSet.callAsync();
          expect(actualNextSet).to.equal(baseAssetCollateral.address);
        });

        it('updates to the new auction library correctly', async () => {
          await subject();

          const newAuctionLibrary = await rebalancingSetToken.auctionLibrary.callAsync();
          expect(newAuctionLibrary).to.equal(linearAuctionPriceCurve.address);
        });

        it('updates the time to pivot correctly', async () => {
          await subject();

          const auctionPriceParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
          const newAuctionTimeToPivot = auctionPriceParameters[1];
          expect(newAuctionTimeToPivot).to.be.bignumber.equal(auctionTimeToPivot);
        });

        it('updates the auction start price correctly', async () => {
          await subject();

          const baseCollateralValue = await managerHelper.calculateSetTokenValue(
            baseAssetCollateral,
            [confirmPrice],
            [ETH_DECIMALS],
          );

          const quoteCollateralValue = await managerHelper.calculateSetTokenValue(
            quoteAssetCollateral,
            [ether(1)],
            [USDC_DECIMALS],
          );

          const auctionPriceParameters = managerHelper.calculateLinearAuctionParameters(
            quoteCollateralValue,
            baseCollateralValue,
            auctionStartPercentage,
            auctionEndPercentage
          );

          const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
          const newAuctionStartPrice = newAuctionParameters[2];

          expect(newAuctionStartPrice).to.be.bignumber.equal(auctionPriceParameters['auctionStartPrice']);
        });

        it('updates the auction pivot price correctly', async () => {
          await subject();

          const baseCollateralValue = await managerHelper.calculateSetTokenValue(
            baseAssetCollateral,
            [confirmPrice],
            [ETH_DECIMALS],
          );

          const quoteCollateralValue = await managerHelper.calculateSetTokenValue(
            quoteAssetCollateral,
            [ether(1)],
            [USDC_DECIMALS],
          );

          const auctionPriceParameters = managerHelper.calculateLinearAuctionParameters(
            quoteCollateralValue,
            baseCollateralValue,
            auctionStartPercentage,
            auctionEndPercentage
          );

          const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
          const newAuctionPivotPrice = newAuctionParameters[3];

          expect(newAuctionPivotPrice).to.be.bignumber.equal(auctionPriceParameters['auctionPivotPrice']);
        });

        describe('but baseAsset collateral is 4x valuable than quoteAsset collateral', async () => {
          before(async () => {
            crossoverPrice = ether(400);
            confirmPrice = crossoverPrice;
          });

          after(async () => {
            crossoverPrice = ether(170);
            confirmPrice = crossoverPrice;
          });

          it('should pass correct next set address', async () => {
            const txHash = await subject();

            const logs = await setTestUtils.getLogsFromTxHash(txHash);
            const expectedNextSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);

            const actualNextSetAddress = await rebalancingSetToken.nextSet.callAsync();
            expect(actualNextSetAddress).to.equal(expectedNextSetAddress);
          });

          it('updates new risk collateral to the correct naturalUnit', async () => {
            await subject();

            const newSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const newSet = await protocolHelper.getSetTokenAsync(newSetAddress);
            const newSetNaturalUnit = await newSet.naturalUnit.callAsync();

            const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParametersAsync(
              quoteAssetCollateral,
              usdcPrice,
              confirmPrice,
              USDC_DECIMALS,
              ETH_DECIMALS,
            );
            expect(newSetNaturalUnit).to.be.bignumber.equal(expectedNextSetParams['naturalUnit']);
          });

          it('updates new risk collateral to the correct units', async () => {
            await subject();

            const newSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const newSet = await protocolHelper.getSetTokenAsync(newSetAddress);
            const newSetUnits = await newSet.getUnits.callAsync();

            const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParametersAsync(
              quoteAssetCollateral,
              usdcPrice,
              confirmPrice,
              USDC_DECIMALS,
              ETH_DECIMALS,
            );
            expect(JSON.stringify(newSetUnits)).to.be.eql(JSON.stringify(expectedNextSetParams['units']));
          });

          it('updates new risk collateral to the correct components', async () => {
            await subject();

            const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
            const nextSetComponents = await nextSet.getComponents.callAsync();

            const expectedNextSetComponents = [wrappedETH.address];
            expect(JSON.stringify(nextSetComponents)).to.be.eql(JSON.stringify(expectedNextSetComponents));
          });

          it('updates the auction start price correctly', async () => {
            const txHash = await subject();

            const logs = await setTestUtils.getLogsFromTxHash(txHash);
            const newSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);
            const newSet = await protocolHelper.getSetTokenAsync(newSetAddress);

            const baseCollateralValue = await managerHelper.calculateSetTokenValue(
              newSet,
              [confirmPrice],
              [ETH_DECIMALS],
            );

            const quoteCollateralValue = await managerHelper.calculateSetTokenValue(
              quoteAssetCollateral,
              [ether(1)],
              [USDC_DECIMALS],
            );

            const auctionPriceParameters = managerHelper.calculateLinearAuctionParameters(
              quoteCollateralValue,
              baseCollateralValue,
              auctionStartPercentage,
              auctionEndPercentage
            );

            const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
            const newAuctionStartPrice = newAuctionParameters[2];

            expect(newAuctionStartPrice).to.be.bignumber.equal(auctionPriceParameters['auctionStartPrice']);
          });

          it('updates the auction pivot price correctly', async () => {
            const txHash = await subject();

            const logs = await setTestUtils.getLogsFromTxHash(txHash);
            const newSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);
            const newSet = await protocolHelper.getSetTokenAsync(newSetAddress);

            const baseCollateralValue = await managerHelper.calculateSetTokenValue(
              newSet,
              [confirmPrice],
              [ETH_DECIMALS],
            );

            const quoteCollateralValue = await managerHelper.calculateSetTokenValue(
              quoteAssetCollateral,
              [ether(1)],
              [USDC_DECIMALS],
            );

            const auctionPriceParameters = managerHelper.calculateLinearAuctionParameters(
              quoteCollateralValue,
              baseCollateralValue,
              auctionStartPercentage,
              auctionEndPercentage
            );

            const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
            const newAuctionPivotPrice = newAuctionParameters[3];

            expect(newAuctionPivotPrice).to.be.bignumber.equal(auctionPriceParameters['auctionPivotPrice']);
          });
        });

        describe('but new risk collateral requires bump in natural unit', async () => {
          before(async () => {
            crossoverPrice = ether(3 * 10 ** 8);
            confirmPrice = crossoverPrice;
          });

          after(async () => {
            crossoverPrice = ether(170);
            confirmPrice = crossoverPrice;
          });

          it('should pass correct next set address', async () => {
            const txHash = await subject();

            const logs = await setTestUtils.getLogsFromTxHash(txHash);
            const expectedNextSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);

            const actualNextSetAddress = await rebalancingSetToken.nextSet.callAsync();
            expect(actualNextSetAddress).to.equal(expectedNextSetAddress);
          });

          it('updates new risk collateral to the correct naturalUnit', async () => {
            await subject();

            const newSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const newSet = await protocolHelper.getSetTokenAsync(newSetAddress);
            const newSetNaturalUnit = await newSet.naturalUnit.callAsync();

            const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParametersAsync(
              quoteAssetCollateral,
              usdcPrice,
              confirmPrice,
              USDC_DECIMALS,
              ETH_DECIMALS,
            );

            expect(newSetNaturalUnit).to.be.bignumber.equal(expectedNextSetParams['naturalUnit']);
          });

          it('updates new risk collateral to the correct units', async () => {
            await subject();

            const newSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const newSet = await protocolHelper.getSetTokenAsync(newSetAddress);
            const newSetUnits = await newSet.getUnits.callAsync();

            const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParametersAsync(
              quoteAssetCollateral,
              usdcPrice,
              confirmPrice,
              USDC_DECIMALS,
              ETH_DECIMALS,
            );
            expect(JSON.stringify(newSetUnits)).to.be.eql(JSON.stringify(expectedNextSetParams['units']));
          });

          it('updates new risk collateral to the correct components', async () => {
            await subject();

            const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
            const nextSetComponents = await nextSet.getComponents.callAsync();

            const expectedNextSetComponents = [wrappedETH.address];
            expect(JSON.stringify(nextSetComponents)).to.be.eql(JSON.stringify(expectedNextSetComponents));
          });

          it('updates the auction start price correctly', async () => {
            const txHash = await subject();

            const logs = await setTestUtils.getLogsFromTxHash(txHash);
            const newSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);
            const newSet = await protocolHelper.getSetTokenAsync(newSetAddress);

            const baseCollateralValue = await managerHelper.calculateSetTokenValue(
              newSet,
              [confirmPrice],
              [ETH_DECIMALS],
            );

            const quoteCollateralValue = await managerHelper.calculateSetTokenValue(
              quoteAssetCollateral,
              [ether(1)],
              [USDC_DECIMALS],
            );

            const auctionPriceParameters = managerHelper.calculateLinearAuctionParameters(
              quoteCollateralValue,
              baseCollateralValue,
              auctionStartPercentage,
              auctionEndPercentage
            );

            const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
            const newAuctionStartPrice = newAuctionParameters[2];

            expect(newAuctionStartPrice).to.be.bignumber.equal(auctionPriceParameters['auctionStartPrice']);
          });

          it('updates the auction pivot price correctly', async () => {
            const txHash = await subject();

            const logs = await setTestUtils.getLogsFromTxHash(txHash);
            const newSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);
            const newSet = await protocolHelper.getSetTokenAsync(newSetAddress);

            const baseCollateralValue = await managerHelper.calculateSetTokenValue(
              newSet,
              [confirmPrice],
              [ETH_DECIMALS],
            );

            const quoteCollateralValue = await managerHelper.calculateSetTokenValue(
              quoteAssetCollateral,
              [ether(1)],
              [USDC_DECIMALS],
            );

            const auctionPriceParameters = managerHelper.calculateLinearAuctionParameters(
              quoteCollateralValue,
              baseCollateralValue,
              auctionStartPercentage,
              auctionEndPercentage
            );

            const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
            const newAuctionPivotPrice = newAuctionParameters[3];

            expect(newAuctionPivotPrice).to.be.bignumber.equal(auctionPriceParameters['auctionPivotPrice']);
          });
        });

        describe('but price has not gone above MA', async () => {
          before(async () => {
            confirmPrice = ether(140);
          });

          after(async () => {
            confirmPrice = ether(170);
          });

          it('should revert', async () => {
            await expectRevertError(subject());
          });
        });

        describe('but not enough time has passed from last rebalance', async () => {
          beforeEach(async () => {
            subjectTimeFastForward = ZERO;
          });

          it('should revert', async () => {
            await expectRevertError(subject());
          });
        });
      });
    });

    describe('when propose is called and rebalancing set token is in Proposal state', async () => {
      beforeEach(async () => {
        await blockchain.increaseTimeAsync(subjectTimeFastForward);
        await setManager.confirmPropose.sendTransactionAsync();
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('when propose is called and rebalancing set token is in Rebalance state', async () => {
      beforeEach(async () => {
        // Issue currentSetToken
        const initialAllocationTokenAddress = await rebalancingSetToken.currentSet.callAsync();
        const initialAllocationToken = await protocolHelper.getSetTokenAsync(initialAllocationTokenAddress);
        await core.issue.sendTransactionAsync(
          initialAllocationToken.address,
          ether(9),
          {from: deployerAccount, gas: DEFAULT_GAS},
        );
        await erc20Helper.approveTransfersAsync([initialAllocationToken], transferProxy.address);

        // Use issued currentSetToken to issue rebalancingSetToken
        await core.issue.sendTransactionAsync(
          rebalancingSetToken.address,
          ether(7),
          { from: deployerAccount, gas: DEFAULT_GAS }
        );

        await blockchain.increaseTimeAsync(subjectTimeFastForward);
        await setManager.confirmPropose.sendTransactionAsync();

        await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS);
        await rebalancingSetToken.startRebalance.sendTransactionAsync();
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });
});