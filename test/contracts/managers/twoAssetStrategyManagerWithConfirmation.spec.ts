require('module-alias/register');

import * as _ from 'lodash';
import * as ABIDecoder from 'abi-decoder';
import * as chai from 'chai';
import * as setProtocolUtils from 'set-protocol-utils';

import { Address } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import { Blockchain } from '@utils/blockchain';
import { ether } from '@utils/units';
import {
  Core,
  CoreContract,
  LinearAuctionPriceCurveContract,
  MedianContract,
  RebalancingSetTokenContract,
  RebalancingSetTokenFactoryContract,
  SetTokenContract,
  SetTokenFactoryContract,
  TransferProxyContract,
  WethMockContract,
  WhiteListContract,
} from 'set-protocol-contracts';
import {
  BinaryAllocationPricerContract,
  ConstantPriceOracleContract,
  EMAOracleContract,
  LegacyMakerOracleAdapterContract,
  LinearizedEMATimeSeriesFeedContract,
  MovingAverageToAssetPriceCrossoverTriggerContract,
  OracleProxyContract,
  TwoAssetStrategyManagerWithConfirmationContract,
  USDCMockContract,
} from '@utils/contracts';

import {
  DEFAULT_GAS,
  ETH_DECIMALS,
  NULL_ADDRESS,
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
import { OracleHelper } from '@utils/helpers/oracleHelper';
import { ProtocolHelper } from '@utils/helpers/protocolHelper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;
const setTestUtils = new SetTestUtils(web3);

contract('TwoAssetStrategyManagerWithConfirmation', accounts => {
  const [
    deployerAccount,
    notDeployerAccount,
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

  let priceTrigger: MovingAverageToAssetPriceCrossoverTriggerContract;
  let allocationPricer: BinaryAllocationPricerContract;

  let setManager: TwoAssetStrategyManagerWithConfirmationContract;
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
      [new BigNumber(100)],
      STABLE_COLLATERAL_NATURAL_UNIT,
    );

    baseAssetCollateral = await protocolHelper.createSetTokenAsync(
      core,
      factory.address,
      [wrappedETH.address],
      [new BigNumber(10 ** 6)],
      RISK_COLLATERAL_NATURAL_UNIT,
    );

    priceTrigger = await managerHelper.deployMovingAverageToAssetPriceCrossoverTrigger(
      emaOracle.address,
      oracleProxy.address,
      timePeriod
    );

    allocationPricer = await managerHelper.deployBinaryAllocationPricerAsync(
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
      [timeSeriesFeed.address, allocationPricer.address, priceTrigger.address]
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectCoreInstance: Address;
    let subjectPriceTriggerInstance: Address;
    let subjectAllocationPricerInstance: Address;
    let subjectAuctionLibraryInstance: Address;
    let subjectBaseAssetAllocation: BigNumber;
    let subjectAuctionTimeToPivot: BigNumber;
    let subjectAuctionSpeed: BigNumber;
    let subjectSignalConfirmationMinTime: BigNumber;
    let subjectSignalConfirmationMaxTime: BigNumber;
    let subjectCaller: Address;

    beforeEach(async () => {
      subjectCoreInstance = core.address;
      subjectPriceTriggerInstance = priceTrigger.address;
      subjectAllocationPricerInstance = allocationPricer.address;
      subjectAuctionLibraryInstance = linearAuctionPriceCurve.address;
      subjectBaseAssetAllocation = ZERO;
      subjectAuctionTimeToPivot = ONE_HOUR_IN_SECONDS.mul(2);
      subjectAuctionSpeed = ONE_HOUR_IN_SECONDS.div(6);
      subjectSignalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      subjectSignalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<TwoAssetStrategyManagerWithConfirmationContract> {
      return managerHelper.deployTwoAssetStrategyManagerWithConfirmationAsync(
        subjectCoreInstance,
        subjectPriceTriggerInstance,
        subjectAllocationPricerInstance,
        subjectAuctionLibraryInstance,
        subjectBaseAssetAllocation,
        subjectAuctionTimeToPivot,
        subjectAuctionSpeed,
        subjectSignalConfirmationMinTime,
        subjectSignalConfirmationMaxTime,
        subjectCaller,
      );
    }

    it('sets the correct core address', async () => {
      setManager = await subject();

      const actualCoreInstance = await setManager.coreInstance.callAsync();

      expect(actualCoreInstance).to.equal(subjectCoreInstance);
    });

    it('sets the correct priceTrigger address', async () => {
      setManager = await subject();

      const actualPriceTriggerInstance = await setManager.priceTriggerInstance.callAsync();

      expect(actualPriceTriggerInstance).to.equal(subjectPriceTriggerInstance);
    });

    it('sets the correct allocationPricer address', async () => {
      setManager = await subject();

      const actualAllocationPricerInstance = await setManager.allocationPricerInstance.callAsync();

      expect(actualAllocationPricerInstance).to.equal(subjectAllocationPricerInstance);
    });

    it('sets the correct auctionLibrary address', async () => {
      setManager = await subject();

      const actualAuctionLibraryInstance = await setManager.auctionLibraryInstance.callAsync();

      expect(actualAuctionLibraryInstance).to.equal(subjectAuctionLibraryInstance);
    });

    it('sets the correct baseAssetAllocation', async () => {
      setManager = await subject();

      const actualBaseAssetAllocation = await setManager.baseAssetAllocation.callAsync();

      expect(actualBaseAssetAllocation).to.be.bignumber.equal(subjectBaseAssetAllocation);
    });

    it('sets the correct auctionTimeToPivot', async () => {
      setManager = await subject();

      const actualAuctionTimeToPivot = await setManager.auctionTimeToPivot.callAsync();

      expect(actualAuctionTimeToPivot).to.be.bignumber.equal(subjectAuctionTimeToPivot);
    });

    it('sets the correct auctionSpeed', async () => {
      setManager = await subject();

      const actualAuctionSpeed = await setManager.auctionSpeed.callAsync();

      expect(actualAuctionSpeed).to.be.bignumber.equal(subjectAuctionSpeed);
    });

    it('sets the correct signalConfirmationMinTime', async () => {
      setManager = await subject();

      const actualSignalConfirmationMinTime = await setManager.signalConfirmationMinTime.callAsync();

      expect(actualSignalConfirmationMinTime).to.be.bignumber.equal(subjectSignalConfirmationMinTime);
    });

    it('sets the correct signalConfirmationMaxTime', async () => {
      setManager = await subject();

      const actualSignalConfirmationMaxTime = await setManager.signalConfirmationMaxTime.callAsync();

      expect(actualSignalConfirmationMaxTime).to.be.bignumber.equal(subjectSignalConfirmationMaxTime);
    });

    it('sets the correct contractDeployer', async () => {
      setManager = await subject();

      const actualContractDeployer = await setManager.contractDeployer.callAsync();

      expect(actualContractDeployer).to.equal(subjectCaller);
    });
  });

  describe('#initialize', async () => {
    let subjectRebalancingSetToken: Address;
    let subjectCaller: Address;

    let proposalPeriod: BigNumber;
    beforeEach(async () => {
      const auctionTimeToPivot = ONE_DAY_IN_SECONDS.div(4);
      const auctionSpeed = ONE_HOUR_IN_SECONDS.div(6);
      const signalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      const signalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      setManager = await  managerHelper.deployTwoAssetStrategyManagerWithConfirmationAsync(
        core.address,
        priceTrigger.address,
        allocationPricer.address,
        linearAuctionPriceCurve.address,
        ZERO,
        auctionTimeToPivot,
        auctionSpeed,
        signalConfirmationMinTime,
        signalConfirmationMaxTime,
      );

      proposalPeriod = ONE_DAY_IN_SECONDS;
      rebalancingSetToken = await protocolHelper.createDefaultRebalancingSetTokenAsync(
        core,
        rebalancingFactory.address,
        setManager.address,
        quoteAssetCollateral.address,
        proposalPeriod
      );

      subjectRebalancingSetToken = rebalancingSetToken.address;
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      return setManager.initialize.sendTransactionAsync(
        subjectRebalancingSetToken,
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    it('sets the rebalancing set token address', async () => {
      await subject();

      const actualRebalancingSetTokenInstance = await setManager.rebalancingSetTokenInstance.callAsync();

      expect(actualRebalancingSetTokenInstance).to.equal(subjectRebalancingSetToken);
    });

    it('sets the contract deployer address to zero', async () => {
      await subject();

      const actualContractDeployer = await setManager.contractDeployer.callAsync();

      expect(actualContractDeployer).to.equal(NULL_ADDRESS);
    });

    describe('but caller is not the contract deployer', async () => {
      beforeEach(async () => {
        subjectCaller = notDeployerAccount;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('but the passed rebalancing set address was not created by Core', async () => {
      beforeEach(async () => {
        const unTrackedSetToken = await protocolHelper.createDefaultRebalancingSetTokenAsync(
          core,
          rebalancingFactory.address,
          setManager.address,
          baseAssetCollateral.address,
          proposalPeriod,
        );

        await core.disableSet.sendTransactionAsync(
          unTrackedSetToken.address,
          { from: deployerAccount, gas: DEFAULT_GAS },
        );

        subjectRebalancingSetToken = unTrackedSetToken.address;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#initialPropose', async () => {
    let subjectTimeFastForward: BigNumber;
    let subjectCaller: Address;

    let lastPrice: BigNumber;

    let baseAssetAllocation: BigNumber;
    let auctionTimeToPivot: BigNumber;

    let collateralSetAddress: Address;
    let proposalPeriod: BigNumber;

    before(async () => {
      lastPrice = ether(140);
      baseAssetAllocation = new BigNumber(100);
    });

    beforeEach(async () => {
      await oracleHelper.updateTimeSeriesFeedAsync(
        timeSeriesFeed,
        ethMedianizer,
        lastPrice
      );

      auctionTimeToPivot = ONE_DAY_IN_SECONDS.div(4);
      const auctionSpeed = ONE_HOUR_IN_SECONDS.div(6);
      const signalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      const signalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      setManager = await  managerHelper.deployTwoAssetStrategyManagerWithConfirmationAsync(
        core.address,
        priceTrigger.address,
        allocationPricer.address,
        linearAuctionPriceCurve.address,
        baseAssetAllocation,
        auctionTimeToPivot,
        auctionSpeed,
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

      const blockInfo = await web3.eth.getBlock('latest');
      await oracleHelper.updateMedianizerPriceAsync(
        ethMedianizer,
        lastPrice,
        new BigNumber(blockInfo.timestamp + 1),
      );

      subjectTimeFastForward = ONE_DAY_IN_SECONDS.add(1);
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      await blockchain.increaseTimeAsync(subjectTimeFastForward);
      return setManager.initialPropose.sendTransactionAsync(
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    describe('when propose is called from the Default state', async () => {
      describe('and allocating from baseAsset to quoteAsset', async () => {
        it('sets the proposalTimestamp correctly', async () => {
          await subject();

          const block = await web3.eth.getBlock('latest');
          const expectedTimestamp = new BigNumber(block.timestamp);

          const actualTimestamp = await setManager.lastCrossoverConfirmationTimestamp.callAsync();
          expect(actualTimestamp).to.be.bignumber.equal(expectedTimestamp);
        });

        describe('but price has not dipped below MA', async () => {
          before(async () => {
            lastPrice = ether(170);
          });

          after(async () => {
            lastPrice = ether(140);
          });

          it('should revert', async () => {
            await expectRevertError(subject());
          });
        });

        describe('when 12 hours has not passed from an initial proposal', async () => {
          beforeEach(async () => {
            const timeFastForward = ONE_DAY_IN_SECONDS;
            await blockchain.increaseTimeAsync(timeFastForward);
            await setManager.initialPropose.sendTransactionAsync();
            subjectTimeFastForward = ONE_DAY_IN_SECONDS.div(4);
          });

          it('should revert', async () => {
            await expectRevertError(subject());
          });
        });

        describe('but the rebalance interval has not elapsed', async () => {
          beforeEach(async () => {
            subjectTimeFastForward = ONE_DAY_IN_SECONDS.sub(10);
          });

          it('should revert', async () => {
            await expectRevertError(subject());
          });
        });
      });

      describe('and allocating from quoteAsset to baseAsset', async () => {
        before(async () => {
          lastPrice = ether(170);
          collateralSetAddress = quoteAssetCollateral.address;
          baseAssetAllocation = ZERO;
        });

        it('sets the proposalTimestamp correctly', async () => {
          await subject();

          const block = await web3.eth.getBlock('latest');
          const expectedTimestamp = new BigNumber(block.timestamp);

          const actualTimestamp = await setManager.lastCrossoverConfirmationTimestamp.callAsync();
          expect(actualTimestamp).to.be.bignumber.equal(expectedTimestamp);
        });

        describe('but price has not dipped below MA', async () => {
          before(async () => {
            lastPrice = ether(150);
          });

          after(async () => {
            lastPrice = ether(170);
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
        await setManager.initialPropose.sendTransactionAsync(
          { from: subjectCaller, gas: DEFAULT_GAS}
        );

        await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS.div(4));
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
        await setManager.initialPropose.sendTransactionAsync(
          { from: subjectCaller, gas: DEFAULT_GAS}
        );

        await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS.div(4));
        await setManager.confirmPropose.sendTransactionAsync();

        await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS);
        await rebalancingSetToken.startRebalance.sendTransactionAsync();
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#confirmPropose', async () => {
    let subjectTimeFastForward: BigNumber;
    let subjectCaller: Address;

    let triggerPrice: BigNumber;
    let lastPrice: BigNumber;

    let baseAssetAllocation: BigNumber;
    let auctionTimeToPivot: BigNumber;

    let collateralSetAddress: Address;
    let proposalPeriod: BigNumber;

    before(async () => {
      triggerPrice = ether(140);
      lastPrice = triggerPrice;
      baseAssetAllocation = new BigNumber(100);
    });

    beforeEach(async () => {
      await oracleHelper.updateTimeSeriesFeedAsync(
        timeSeriesFeed,
        ethMedianizer,
        triggerPrice
      );

      auctionTimeToPivot = ONE_DAY_IN_SECONDS.div(4);
      const auctionSpeed = ONE_HOUR_IN_SECONDS.div(6);
      const signalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      const signalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      setManager = await  managerHelper.deployTwoAssetStrategyManagerWithConfirmationAsync(
        core.address,
        priceTrigger.address,
        allocationPricer.address,
        linearAuctionPriceCurve.address,
        baseAssetAllocation,
        auctionTimeToPivot,
        auctionSpeed,
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

      await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS.add(1));
      await setManager.initialPropose.sendTransactionAsync();

      const lastBlockInfo = await web3.eth.getBlock('latest');
      await oracleHelper.updateMedianizerPriceAsync(
        ethMedianizer,
        lastPrice,
        new BigNumber(lastBlockInfo.timestamp + 1),
      );

      subjectTimeFastForward = ONE_HOUR_IN_SECONDS.mul(6).add(1);
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

          const timeIncrement = new BigNumber(600);
          const auctionPriceParameters = await managerHelper.getExpectedMACOAuctionParametersAsync(
            baseAssetCollateral,
            quoteAssetCollateral,
            true,
            triggerPrice,
            timeIncrement,
            auctionTimeToPivot
          );

          const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
          const newAuctionStartPrice = newAuctionParameters[2];

          expect(newAuctionStartPrice).to.be.bignumber.equal(auctionPriceParameters['auctionStartPrice']);
        });

        it('updates the auction pivot price correctly', async () => {
          await subject();

          const timeIncrement = new BigNumber(600);
          const auctionPriceParameters = await managerHelper.getExpectedMACOAuctionParametersAsync(
            baseAssetCollateral,
            quoteAssetCollateral,
            true,
            triggerPrice,
            timeIncrement,
            auctionTimeToPivot
          );

          const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
          const newAuctionPivotPrice = newAuctionParameters[3];

          expect(newAuctionPivotPrice).to.be.bignumber.equal(auctionPriceParameters['auctionPivotPrice']);
        });

        ////// Log Event ///////

        describe('but quote collateral is 4x valuable than base collateral', async () => {
          before(async () => {
            triggerPrice = ether(25);
            lastPrice = triggerPrice;
          });

          it('should set new stable collateral address', async () => {
            const txHash = await subject();

            const logs = await setTestUtils.getLogsFromTxHash(txHash);
            const expectedSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);

            const actualStableCollateralAddress = await allocationPricer.quoteAssetCollateralInstance.callAsync();
            expect(actualStableCollateralAddress).to.equal(expectedSetAddress);
          });

          it('updates new quote collateral to the correct naturalUnit', async () => {
            await subject();

            const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
            const nextSetNaturalUnit = await nextSet.naturalUnit.callAsync();

            const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParametersAsync(
              baseAssetCollateral,
              quoteAssetCollateral,
              triggerPrice,
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
              quoteAssetCollateral,
              triggerPrice,
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

            const timeIncrement = new BigNumber(600);
            const auctionPriceParameters = await managerHelper.getExpectedMACOAuctionParametersAsync(
              baseAssetCollateral,
              newSet,
              true,
              triggerPrice,
              timeIncrement,
              auctionTimeToPivot
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

            const timeIncrement = new BigNumber(600);
            const auctionPriceParameters = await managerHelper.getExpectedMACOAuctionParametersAsync(
              baseAssetCollateral,
              newSet,
              true,
              triggerPrice,
              timeIncrement,
              auctionTimeToPivot
            );

            const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
            const newAuctionPivotPrice = newAuctionParameters[3];

            expect(newAuctionPivotPrice).to.be.bignumber.equal(auctionPriceParameters['auctionPivotPrice']);
          });
        });

        describe('but new stable collateral requires bump in natural unit', async () => {
          before(async () => {
            triggerPrice = ether(.4);
            lastPrice = triggerPrice;
          });

          it('should set new stable collateral address', async () => {
            const txHash = await subject();

            const logs = await setTestUtils.getLogsFromTxHash(txHash);
            const expectedSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);

            const actualStableCollateralAddress = await allocationPricer.quoteAssetCollateralInstance.callAsync();
            expect(actualStableCollateralAddress).to.equal(expectedSetAddress);
          });

          it('updates new stable collateral to the correct naturalUnit', async () => {
            await subject();

            const newSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const newSet = await protocolHelper.getSetTokenAsync(newSetAddress);
            const newSetNaturalUnit = await newSet.naturalUnit.callAsync();

            const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParametersAsync(
              baseAssetCollateral,
              quoteAssetCollateral,
              triggerPrice,
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
              quoteAssetCollateral,
              triggerPrice,
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

            const timeIncrement = new BigNumber(600);
            const auctionPriceParameters = await managerHelper.getExpectedMACOAuctionParametersAsync(
              baseAssetCollateral,
              newSet,
              true,
              triggerPrice,
              timeIncrement,
              auctionTimeToPivot
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

            const timeIncrement = new BigNumber(600);
            const auctionPriceParameters = await managerHelper.getExpectedMACOAuctionParametersAsync(
              baseAssetCollateral,
              newSet,
              true,
              triggerPrice,
              timeIncrement,
              auctionTimeToPivot
            );

            const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
            const newAuctionPivotPrice = newAuctionParameters[3];

            expect(newAuctionPivotPrice).to.be.bignumber.equal(auctionPriceParameters['auctionPivotPrice']);
          });
        });

        describe('but price has not dipped below MA', async () => {
          before(async () => {
            triggerPrice = ether(140);
            lastPrice = ether(170);
          });


          it('should revert', async () => {
            await expectRevertError(subject());
          });
        });

        describe('but not enough time has passed from initial propose', async () => {
          beforeEach(async () => {
            subjectTimeFastForward = new BigNumber(ONE_DAY_IN_SECONDS.div(4).sub(2));
          });

          it('should revert', async () => {
            await expectRevertError(subject());
          });
        });

        describe('but too much time has passed from initial propose', async () => {
          beforeEach(async () => {
            subjectTimeFastForward = new BigNumber(ONE_DAY_IN_SECONDS.div(2).add(2));
          });

          it('should revert', async () => {
            await expectRevertError(subject());
          });
        });
      });

      describe('and allocating from quote asset to base asset', async () => {
        before(async () => {
          baseAssetAllocation = ZERO;
          triggerPrice = ether(170);
          lastPrice = triggerPrice;
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

          const timeIncrement = new BigNumber(600);
          const auctionPriceParameters = await managerHelper.getExpectedMACOAuctionParametersAsync(
            quoteAssetCollateral,
            baseAssetCollateral,
            false,
            triggerPrice,
            timeIncrement,
            auctionTimeToPivot
          );

          const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
          const newAuctionStartPrice = newAuctionParameters[2];

          expect(newAuctionStartPrice).to.be.bignumber.equal(auctionPriceParameters['auctionStartPrice']);
        });

        it('updates the auction pivot price correctly', async () => {
          await subject();

          const timeIncrement = new BigNumber(600);
          const auctionPriceParameters = await managerHelper.getExpectedMACOAuctionParametersAsync(
            quoteAssetCollateral,
            baseAssetCollateral,
            false,
            triggerPrice,
            timeIncrement,
            auctionTimeToPivot
          );

          const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
          const newAuctionPivotPrice = newAuctionParameters[3];

          expect(newAuctionPivotPrice).to.be.bignumber.equal(auctionPriceParameters['auctionPivotPrice']);
        });

        describe('but baseAsset collateral is 4x valuable than quoteAsset collateral', async () => {
          before(async () => {
            triggerPrice = ether(400);
            lastPrice = triggerPrice;
          });

          it('should set new risk collateral address', async () => {
            const txHash = await subject();

            const logs = await setTestUtils.getLogsFromTxHash(txHash);
            const expectedSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);

            const actualRiskCollateralAddress = await allocationPricer.baseAssetCollateralInstance.callAsync();
            expect(actualRiskCollateralAddress).to.equal(expectedSetAddress);
          });

          it('updates new risk collateral to the correct naturalUnit', async () => {
            await subject();

            const newSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const newSet = await protocolHelper.getSetTokenAsync(newSetAddress);
            const newSetNaturalUnit = await newSet.naturalUnit.callAsync();

            const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParametersAsync(
              quoteAssetCollateral,
              baseAssetCollateral,
              usdcPrice,
              triggerPrice,
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
              baseAssetCollateral,
              usdcPrice,
              triggerPrice,
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

            const timeIncrement = new BigNumber(600);
            const auctionPriceParameters = await managerHelper.getExpectedMACOAuctionParametersAsync(
              quoteAssetCollateral,
              newSet,
              false,
              lastPrice,
              timeIncrement,
              auctionTimeToPivot
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

            const timeIncrement = new BigNumber(600);
            const auctionPriceParameters = await managerHelper.getExpectedMACOAuctionParametersAsync(
              quoteAssetCollateral,
              newSet,
              false,
              lastPrice,
              timeIncrement,
              auctionTimeToPivot
            );

            const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
            const newAuctionPivotPrice = newAuctionParameters[3];

            expect(newAuctionPivotPrice).to.be.bignumber.equal(auctionPriceParameters['auctionPivotPrice']);
          });
        });

        describe('but new risk collateral requires bump in natural unit', async () => {
          before(async () => {
            triggerPrice = ether(3 * 10 ** 8);
            lastPrice = triggerPrice;
          });

          it('should set new risk collateral address', async () => {
            const txHash = await subject();

            const logs = await setTestUtils.getLogsFromTxHash(txHash);
            const expectedSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);

            const actualRiskCollateralAddress = await allocationPricer.baseAssetCollateralInstance.callAsync();
            expect(actualRiskCollateralAddress).to.equal(expectedSetAddress);
          });

          it('updates new risk collateral to the correct naturalUnit', async () => {
            await subject();

            const newSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const newSet = await protocolHelper.getSetTokenAsync(newSetAddress);
            const newSetNaturalUnit = await newSet.naturalUnit.callAsync();

            const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParametersAsync(
              quoteAssetCollateral,
              baseAssetCollateral,
              usdcPrice,
              triggerPrice,
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
              baseAssetCollateral,
              usdcPrice,
              triggerPrice,
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

            const timeIncrement = new BigNumber(600);
            const auctionPriceParameters = await managerHelper.getExpectedMACOAuctionParametersAsync(
              quoteAssetCollateral,
              newSet,
              false,
              lastPrice,
              timeIncrement,
              auctionTimeToPivot
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

            const timeIncrement = new BigNumber(600);
            const auctionPriceParameters = await managerHelper.getExpectedMACOAuctionParametersAsync(
              quoteAssetCollateral,
              newSet,
              false,
              lastPrice,
              timeIncrement,
              auctionTimeToPivot
            );

            const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
            const newAuctionPivotPrice = newAuctionParameters[3];

            expect(newAuctionPivotPrice).to.be.bignumber.equal(auctionPriceParameters['auctionPivotPrice']);
          });
        });

        describe('but price has not gone above MA', async () => {
          before(async () => {
            triggerPrice = ether(170);
            lastPrice = ether(150);
          });

          after(async () => {
            triggerPrice = ether(170);
            lastPrice = triggerPrice;
          });

          it('should revert', async () => {
            await expectRevertError(subject());
          });
        });

        describe('but not enough time has passed from initial propose', async () => {
          beforeEach(async () => {
            subjectTimeFastForward = new BigNumber(ONE_HOUR_IN_SECONDS.mul(6).sub(2));
          });

          it('should revert', async () => {
            await expectRevertError(subject());
          });
        });

        describe('but too much time has passed from initial propose', async () => {
          beforeEach(async () => {
            subjectTimeFastForward = new BigNumber(ONE_HOUR_IN_SECONDS.mul(12).add(2));
          });

          it('should revert', async () => {
            await expectRevertError(subject());
          });
        });
      });
    });
  });
});