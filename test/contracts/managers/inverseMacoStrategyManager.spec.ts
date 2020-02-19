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
  RebalancingSetTokenContract,
  RebalancingSetTokenFactoryContract,
  SetTokenContract,
  SetTokenFactoryContract,
  TransferProxyContract,
  WethMockContract,
  WhiteListContract,
} from 'set-protocol-contracts';
import {
  LegacyMakerOracleAdapterContract,
  LinearizedPriceDataSourceContract,
  MedianContract,
  MovingAverageOracleV2Contract,
  OracleProxyContract,
  TimeSeriesFeedContract,
} from 'set-protocol-oracles';
import {
  InverseMACOStrategyManagerContract,
  USDCMockContract,
} from '@utils/contracts';
import {
  DEFAULT_GAS,
  ETH_DECIMALS,
  ONE_DAY_IN_SECONDS,
  ONE_HOUR_IN_SECONDS,
  RISK_COLLATERAL_NATURAL_UNIT,
  STABLE_COLLATERAL_NATURAL_UNIT,
  USDC_DECIMALS,
} from '@utils/constants';
import { extractNewSetTokenAddressFromLogs } from '@utils/contract_logs/core';
import { expectRevertError } from '@utils/tokenAssertions';
import { getWeb3 } from '@utils/web3Helper';
import { LogManagerProposal } from '@utils/contract_logs/macoStrategyManager';

import { ERC20Helper } from '@utils/helpers/erc20Helper';
import { ManagerHelper } from '@utils/helpers/managerHelper';
import { OracleHelper } from '@utils/helpers/oracleHelper';
import { ProtocolHelper } from '@utils/helpers/protocolHelper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const InverseMACOStrategyManager = artifacts.require('InverseMACOStrategyManager');
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;
const setTestUtils = new SetTestUtils(web3);

contract('InverseMACOStrategyManager', accounts => {
  const [
    deployerAccount,
    notDeployerAccount,
    randomTokenAddress,
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
  let linearizedDataSource: LinearizedPriceDataSourceContract;
  let timeSeriesFeed: TimeSeriesFeedContract;
  let movingAverageOracle: MovingAverageOracleV2Contract;
  let macoStrategyManager: InverseMACOStrategyManagerContract;

  let stableCollateral: SetTokenContract;
  let riskCollateral: SetTokenContract;

  let initialEthPrice: BigNumber;

  const protocolHelper = new ProtocolHelper(deployerAccount);
  const erc20Helper = new ERC20Helper(deployerAccount);
  const managerHelper = new ManagerHelper(deployerAccount);
  const oracleHelper = new OracleHelper(deployerAccount);

  before(async () => {
    ABIDecoder.addABI(Core.abi);
    ABIDecoder.addABI(InverseMACOStrategyManager.abi);
  });

  after(async () => {
    ABIDecoder.removeABI(Core.abi);
    ABIDecoder.removeABI(InverseMACOStrategyManager.abi);
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
    await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS.mul(7));
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

    const interpolationThreshold = ONE_DAY_IN_SECONDS;
    linearizedDataSource = await oracleHelper.deployLinearizedPriceDataSourceAsync(
      oracleProxy.address,
      interpolationThreshold,
    );

    initialEthPrice = ether(150);
    const seededValues = [initialEthPrice];
    timeSeriesFeed = await oracleHelper.deployTimeSeriesFeedAsync(
      linearizedDataSource.address,
      seededValues
    );

    const dataDescription = 'ETH20dayMA';
    movingAverageOracle = await oracleHelper.deployMovingAverageOracleV2Async(
      timeSeriesFeed.address,
      dataDescription
    );

    stableCollateral = await protocolHelper.createSetTokenAsync(
      core,
      factory.address,
      [usdcMock.address],
      [new BigNumber(100)],
      STABLE_COLLATERAL_NATURAL_UNIT,
    );

    riskCollateral = await protocolHelper.createSetTokenAsync(
      core,
      factory.address,
      [wrappedETH.address],
      [new BigNumber(10 ** 6)],
      RISK_COLLATERAL_NATURAL_UNIT,
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectCoreAddress: Address;
    let subjectMovingAveragePriceFeed: Address;
    let subjectRiskAssetOracle: Address;
    let subjectStableAssetAddress: Address;
    let subjectRiskAssetAddress: Address;
    let subjectStableCollateralAddress: Address;
    let subjectRiskCollateralAddress: Address;
    let subjectSetTokenFactoryAddress: Address;
    let subjectAuctionLibraryAddress: Address;
    let subjectAuctionTimeToPivot: BigNumber;
    let subjectMovingAverageDays: BigNumber;
    let subjectCrossoverConfirmationBounds: BigNumber[];

    beforeEach(async () => {
      subjectCoreAddress = core.address;
      subjectMovingAveragePriceFeed = movingAverageOracle.address;
      subjectRiskAssetOracle = oracleProxy.address;
      subjectStableAssetAddress = usdcMock.address;
      subjectRiskAssetAddress = wrappedETH.address;
      subjectStableCollateralAddress = stableCollateral.address;
      subjectRiskCollateralAddress = riskCollateral.address;
      subjectSetTokenFactoryAddress = factory.address;
      subjectAuctionLibraryAddress = linearAuctionPriceCurve.address;
      subjectMovingAverageDays = new BigNumber(20);
      subjectAuctionTimeToPivot = ONE_DAY_IN_SECONDS.div(6);
      subjectCrossoverConfirmationBounds = [ONE_HOUR_IN_SECONDS.mul(6), ONE_HOUR_IN_SECONDS.mul(12)];
    });

    async function subject(): Promise<InverseMACOStrategyManagerContract> {
      return managerHelper.deployInverseMACOStrategyManagerAsync(
        subjectCoreAddress,
        subjectMovingAveragePriceFeed,
        subjectRiskAssetOracle,
        subjectStableAssetAddress,
        subjectRiskAssetAddress,
        subjectStableCollateralAddress,
        subjectRiskCollateralAddress,
        subjectSetTokenFactoryAddress,
        subjectAuctionLibraryAddress,
        subjectMovingAverageDays,
        subjectCrossoverConfirmationBounds,
        subjectAuctionTimeToPivot,
      );
    }

    it('sets the correct core address', async () => {
      macoStrategyManager = await subject();

      const actualCoreAddress = await macoStrategyManager.coreAddress.callAsync();

      expect(actualCoreAddress).to.equal(subjectCoreAddress);
    });

    it('sets the correct moving average price feed address', async () => {
      macoStrategyManager = await subject();

      const actualMovingAveragePriceFeedAddress = await macoStrategyManager.movingAveragePriceFeedInstance.callAsync();

      expect(actualMovingAveragePriceFeedAddress).to.equal(subjectMovingAveragePriceFeed);
    });

    it('sets the correct risk asset oracle address', async () => {
      macoStrategyManager = await subject();

      const actualRiskAssetOracleAddress = await macoStrategyManager.riskAssetOracleInstance.callAsync();

      expect(actualRiskAssetOracleAddress).to.equal(subjectRiskAssetOracle);
    });

    it('sets the correct stable asset address', async () => {
      macoStrategyManager = await subject();

      const actualStableAssetAddress = await macoStrategyManager.stableAssetAddress.callAsync();

      expect(actualStableAssetAddress).to.equal(subjectStableAssetAddress);
    });

    it('sets the correct risk asset address', async () => {
      macoStrategyManager = await subject();

      const actualRiskAssetAddress = await macoStrategyManager.riskAssetAddress.callAsync();

      expect(actualRiskAssetAddress).to.equal(subjectRiskAssetAddress);
    });

    it('sets the correct stable collateral address', async () => {
      macoStrategyManager = await subject();

      const actualStableCollateralAddress = await macoStrategyManager.stableCollateralAddress.callAsync();

      expect(actualStableCollateralAddress).to.equal(subjectStableCollateralAddress);
    });

    it('sets the correct risk collateral address', async () => {
      macoStrategyManager = await subject();

      const actualRiskCollateralAddress = await macoStrategyManager.riskCollateralAddress.callAsync();

      expect(actualRiskCollateralAddress).to.equal(subjectRiskCollateralAddress);
    });

    it('sets the correct set token factory address', async () => {
      macoStrategyManager = await subject();

      const actualSetTokenFactoryAddress = await macoStrategyManager.setTokenFactory.callAsync();

      expect(actualSetTokenFactoryAddress).to.equal(subjectSetTokenFactoryAddress);
    });

    it('sets the correct auction library address', async () => {
      macoStrategyManager = await subject();

      const actualAuctionLibraryAddress = await macoStrategyManager.auctionLibrary.callAsync();

      expect(actualAuctionLibraryAddress).to.equal(subjectAuctionLibraryAddress);
    });

    it('sets the correct risk asset decimals', async () => {
      macoStrategyManager = await subject();

      const actualRiskAssetDecimals = await macoStrategyManager.riskAssetDecimals.callAsync();
      const expectedRiskAssetDecimals = await wrappedETH.decimals.callAsync();

      expect(actualRiskAssetDecimals).to.be.bignumber.equal(expectedRiskAssetDecimals);
    });

    it('sets the correct stable asset decimals', async () => {
      macoStrategyManager = await subject();

      const actualStableAssetDecimals = await macoStrategyManager.stableAssetDecimals.callAsync();
      const expectedStableAssetDecimals = await usdcMock.decimals.callAsync();

      expect(actualStableAssetDecimals).to.be.bignumber.equal(expectedStableAssetDecimals);
    });

    it('sets the correct moving average days', async () => {
      macoStrategyManager = await subject();

      const actualMovingAverageDays = await macoStrategyManager.movingAverageDays.callAsync();

      expect(actualMovingAverageDays).to.be.bignumber.equal(subjectMovingAverageDays);
    });

    it('sets the correct auction time to pivot', async () => {
      macoStrategyManager = await subject();

      const actualAuctionTimeToPivot = await macoStrategyManager.auctionTimeToPivot.callAsync();

      expect(actualAuctionTimeToPivot).to.be.bignumber.equal(subjectAuctionTimeToPivot);
    });

    describe('but max confirmation bound is less than the min', async () => {
      beforeEach(async () => {
        subjectCrossoverConfirmationBounds = [new BigNumber(100), new BigNumber(10)];
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('but max confirmation bound is equal to the min', async () => {
      beforeEach(async () => {
        subjectCrossoverConfirmationBounds = [new BigNumber(100), new BigNumber(100)];
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('but stable asset address does not match stable collateral component', async () => {
      beforeEach(async () => {
        subjectStableAssetAddress = randomTokenAddress;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('but risk asset address does not match risk collateral component', async () => {
      beforeEach(async () => {
        subjectRiskAssetAddress = randomTokenAddress;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#initialize', async () => {
    let subjectRebalancingSetToken: Address;
    let subjectCaller: Address;

    let updatedValues: BigNumber[];
    let proposalPeriod: BigNumber;
    let auctionTimeToPivot: BigNumber;
    let crossoverConfirmationBounds: BigNumber[];

    before(async () => {
      updatedValues = _.map(new Array(19), function(el, i) {return ether(150 + i); });
    });

    beforeEach(async () => {
      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        oracleProxy,
        [linearizedDataSource.address]
      );

      await oracleHelper.batchUpdateTimeSeriesFeedAsync(
        timeSeriesFeed,
        ethMedianizer,
        updatedValues.length,
        updatedValues
      );

      crossoverConfirmationBounds = [ONE_HOUR_IN_SECONDS.mul(6), ONE_HOUR_IN_SECONDS.mul(12)];

      auctionTimeToPivot = ONE_DAY_IN_SECONDS.div(4);
      const initialAllocationAddress = await managerHelper.getInverseMACOInitialAllocationAsync(
        stableCollateral,
        riskCollateral,
        ethMedianizer,
        movingAverageOracle,
        new BigNumber(20)
      );

      const movingAverageDays = new BigNumber(20);
      macoStrategyManager = await managerHelper.deployInverseMACOStrategyManagerAsync(
        core.address,
        movingAverageOracle.address,
        oracleProxy.address,
        usdcMock.address,
        wrappedETH.address,
        stableCollateral.address,
        riskCollateral.address,
        factory.address,
        linearAuctionPriceCurve.address,
        movingAverageDays,
        crossoverConfirmationBounds,
        auctionTimeToPivot,
      );

      proposalPeriod = ONE_DAY_IN_SECONDS;
      rebalancingSetToken = await protocolHelper.createDefaultRebalancingSetTokenAsync(
        core,
        rebalancingFactory.address,
        macoStrategyManager.address,
        initialAllocationAddress,
        proposalPeriod
      );

      subjectRebalancingSetToken = rebalancingSetToken.address;
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      return macoStrategyManager.initialize.sendTransactionAsync(
        subjectRebalancingSetToken,
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    it('sets the rebalancing set token address', async () => {
      await subject();

      const rebalancingSetTokenAddress = await macoStrategyManager.rebalancingSetTokenAddress.callAsync();

      expect(rebalancingSetTokenAddress).to.equal(subjectRebalancingSetToken);
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
          macoStrategyManager.address,
          riskCollateral.address,
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

    let updatedValues: BigNumber[];
    let lastPrice: BigNumber;
    let proposalPeriod: BigNumber;
    let auctionTimeToPivot: BigNumber;
    let crossoverConfirmationBounds: BigNumber[];

    before(async () => {
      updatedValues = _.map(new Array(19), function(el, i) {return ether(150 - i); });
      lastPrice = ether(180);
    });

    beforeEach(async () => {
      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        oracleProxy,
        [linearizedDataSource.address]
      );

      await oracleHelper.batchUpdateTimeSeriesFeedAsync(
        timeSeriesFeed,
        ethMedianizer,
        updatedValues.length,
        updatedValues
      );

      auctionTimeToPivot = ONE_DAY_IN_SECONDS.div(4);
      const initialAllocationAddress = await managerHelper.getInverseMACOInitialAllocationAsync(
        stableCollateral,
        riskCollateral,
        ethMedianizer,
        movingAverageOracle,
        new BigNumber(20)
      );

      crossoverConfirmationBounds = [ONE_HOUR_IN_SECONDS.mul(6), ONE_HOUR_IN_SECONDS.mul(12)];

      const movingAverageDays = new BigNumber(20);
      macoStrategyManager = await managerHelper.deployInverseMACOStrategyManagerAsync(
        core.address,
        movingAverageOracle.address,
        oracleProxy.address,
        usdcMock.address,
        wrappedETH.address,
        stableCollateral.address,
        riskCollateral.address,
        factory.address,
        linearAuctionPriceCurve.address,
        movingAverageDays,
        crossoverConfirmationBounds,
        auctionTimeToPivot,
      );

      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        oracleProxy,
        [macoStrategyManager.address]
      );

      proposalPeriod = ONE_DAY_IN_SECONDS;
      rebalancingSetToken = await protocolHelper.createDefaultRebalancingSetTokenAsync(
        core,
        rebalancingFactory.address,
        macoStrategyManager.address,
        initialAllocationAddress,
        proposalPeriod
      );

      await macoStrategyManager.initialize.sendTransactionAsync(
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
      return macoStrategyManager.initialPropose.sendTransactionAsync(
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    describe('when propose is called from the Default state', async () => {
      describe('and allocating from risk asset to stable asset', async () => {
        it('sets the proposalTimestamp correctly', async () => {
          await subject();

          const block = await web3.eth.getBlock('latest');
          const expectedTimestamp = new BigNumber(block.timestamp);

          const actualTimestamp = await macoStrategyManager.lastCrossoverConfirmationTimestamp.callAsync();
          expect(actualTimestamp).to.be.bignumber.equal(expectedTimestamp);
        });

        describe('but price has not spiked above MA', async () => {
          before(async () => {
            lastPrice = ether(100);
          });

          after(async () => {
            lastPrice = ether(180);
          });

          it('should revert', async () => {
            await expectRevertError(subject());
          });
        });

        describe('when 12 hours has not passed from an initial proposal', async () => {
          beforeEach(async () => {
            const timeFastForward = ONE_DAY_IN_SECONDS;
            await blockchain.increaseTimeAsync(timeFastForward);
            await macoStrategyManager.initialPropose.sendTransactionAsync();
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

      describe('and allocating from stable asset to risk asset', async () => {
        before(async () => {
          updatedValues = _.map(new Array(19), function(el, i) {return ether(170 + i); });
          lastPrice = ether(150);
        });

        it('sets the proposalTimestamp correctly', async () => {
          await subject();

          const block = await web3.eth.getBlock('latest');
          const expectedTimestamp = new BigNumber(block.timestamp);

          const actualTimestamp = await macoStrategyManager.lastCrossoverConfirmationTimestamp.callAsync();
          expect(actualTimestamp).to.be.bignumber.equal(expectedTimestamp);
        });

        describe('but price has not dipped below MA', async () => {
          before(async () => {
            lastPrice = ether(190);
          });

          after(async () => {
            lastPrice = ether(150);
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
        await macoStrategyManager.initialPropose.sendTransactionAsync(
          { from: subjectCaller, gas: DEFAULT_GAS}
        );

        await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS.div(4));
        await macoStrategyManager.confirmPropose.sendTransactionAsync();
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
        await macoStrategyManager.initialPropose.sendTransactionAsync(
          { from: subjectCaller, gas: DEFAULT_GAS}
        );

        await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS.div(4));
        await macoStrategyManager.confirmPropose.sendTransactionAsync();

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

    let updatedValues: BigNumber[];
    let triggerPrice: BigNumber;
    let lastPrice: BigNumber;
    let proposalPeriod: BigNumber;
    let auctionTimeToPivot: BigNumber;
    let crossoverConfirmationBounds: BigNumber[];

    before(async () => {
      updatedValues = _.map(new Array(19), function(el, i) {return ether(150 - i); });
      triggerPrice = ether(180);
      lastPrice = triggerPrice;
    });

    beforeEach(async () => {
      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        oracleProxy,
        [linearizedDataSource.address]
      );

      await oracleHelper.batchUpdateTimeSeriesFeedAsync(
        timeSeriesFeed,
        ethMedianizer,
        updatedValues.length,
        updatedValues
      );

      auctionTimeToPivot = ONE_DAY_IN_SECONDS.div(4);
      const initialAllocationAddress = await managerHelper.getInverseMACOInitialAllocationAsync(
        stableCollateral,
        riskCollateral,
        ethMedianizer,
        movingAverageOracle,
        new BigNumber(20)
      );

      crossoverConfirmationBounds = [ONE_HOUR_IN_SECONDS.mul(6), ONE_HOUR_IN_SECONDS.mul(12)];

      const movingAverageDays = new BigNumber(20);
      macoStrategyManager = await managerHelper.deployInverseMACOStrategyManagerAsync(
        core.address,
        movingAverageOracle.address,
        oracleProxy.address,
        usdcMock.address,
        wrappedETH.address,
        stableCollateral.address,
        riskCollateral.address,
        factory.address,
        linearAuctionPriceCurve.address,
        movingAverageDays,
        crossoverConfirmationBounds,
        auctionTimeToPivot,
      );

      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        oracleProxy,
        [macoStrategyManager.address]
      );

      proposalPeriod = ONE_DAY_IN_SECONDS;
      rebalancingSetToken = await protocolHelper.createDefaultRebalancingSetTokenAsync(
        core,
        rebalancingFactory.address,
        macoStrategyManager.address,
        initialAllocationAddress,
        proposalPeriod
      );

      await macoStrategyManager.initialize.sendTransactionAsync(
        rebalancingSetToken.address,
        { from: subjectCaller, gas: DEFAULT_GAS}
      );

      const triggerBlockInfo = await web3.eth.getBlock('latest');
      await oracleHelper.updateMedianizerPriceAsync(
        ethMedianizer,
        triggerPrice,
        new BigNumber(triggerBlockInfo.timestamp + 1),
      );

      await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS.add(1));
      await macoStrategyManager.initialPropose.sendTransactionAsync();

      const lastBlockInfo = await web3.eth.getBlock('latest');
      await oracleHelper.updateMedianizerPriceAsync(
        ethMedianizer,
        lastPrice,
        new BigNumber(lastBlockInfo.timestamp + 1),
      );

      subjectTimeFastForward = ONE_DAY_IN_SECONDS.div(4).add(1);
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      await blockchain.increaseTimeAsync(subjectTimeFastForward);
      return macoStrategyManager.confirmPropose.sendTransactionAsync(
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    describe('when propose is called from the Default state', async () => {
      describe('and allocating from risk asset to stable asset', async () => {
        it('updates to the next set correctly', async () => {
          await subject();

          const actualNextSet = await rebalancingSetToken.nextSet.callAsync();
          expect(actualNextSet).to.equal(stableCollateral.address);
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
            riskCollateral,
            stableCollateral,
            true,
            lastPrice,
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
            riskCollateral,
            stableCollateral,
            true,
            lastPrice,
            timeIncrement,
            auctionTimeToPivot
          );

          const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
          const newAuctionPivotPrice = newAuctionParameters[3];

          expect(newAuctionPivotPrice).to.be.bignumber.equal(auctionPriceParameters['auctionPivotPrice']);
        });

        it('emits correct LogProposal event', async () => {
          const txHash = await subject();

          const movingAveragePrice = new BigNumber(await movingAverageOracle.read.callAsync(new BigNumber(20)));
          const formattedLogs = await setTestUtils.getLogsFromTxHash(txHash);
          const expectedLogs = LogManagerProposal(
            lastPrice,
            movingAveragePrice,
            macoStrategyManager.address
          );

          await SetTestUtils.assertLogEquivalence(formattedLogs, expectedLogs);
        });

        describe('but risk collateral is 4x more than stable collateral', async () => {
          before(async () => {
            triggerPrice = ether(900);
            lastPrice = triggerPrice;
          });

          it('should set new stable collateral address', async () => {
            const txHash = await subject();

            const logs = await setTestUtils.getLogsFromTxHash(txHash);
            const expectedSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);

            const actualStableCollateralAddress = await macoStrategyManager.stableCollateralAddress.callAsync();
            expect(actualStableCollateralAddress).to.equal(expectedSetAddress);
          });

          it('updates new stable collateral to the correct naturalUnit', async () => {
            await subject();

            const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
            const nextSetNaturalUnit = await nextSet.naturalUnit.callAsync();

            const expectedNextSetParams = await managerHelper.getExpectedMACONewCollateralParametersAsync(
              stableCollateral,
              riskCollateral,
              ethMedianizer,
              USDC_DECIMALS,
              ETH_DECIMALS,
              true
            );
            expect(nextSetNaturalUnit).to.be.bignumber.equal(expectedNextSetParams['naturalUnit']);
          });

          it('updates new stable collateral to the correct units', async () => {
            await subject();

            const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
            const nextSetUnits = await nextSet.getUnits.callAsync();

            const expectedNextSetParams = await managerHelper.getExpectedMACONewCollateralParametersAsync(
              stableCollateral,
              riskCollateral,
              ethMedianizer,
              USDC_DECIMALS,
              ETH_DECIMALS,
              true
            );
            expect(JSON.stringify(nextSetUnits)).to.be.eql(JSON.stringify(expectedNextSetParams['units']));
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
              riskCollateral,
              newSet,
              true,
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
              riskCollateral,
              newSet,
              true,
              lastPrice,
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
            updatedValues = _.map(new Array(20), function(el, i) {return ether(.5 - (i / 100)); });
            triggerPrice = ether(.8);
            lastPrice = triggerPrice;
          });

          after(async () => {
            updatedValues = _.map(new Array(19), function(el, i) {return ether(150 - i); });
          });

          it('should set new stable collateral address', async () => {
            const txHash = await subject();

            const logs = await setTestUtils.getLogsFromTxHash(txHash);
            const expectedSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);

            const actualStableCollateralAddress = await macoStrategyManager.stableCollateralAddress.callAsync();
            expect(actualStableCollateralAddress).to.equal(expectedSetAddress);
          });

          it('updates new stable collateral to the correct naturalUnit', async () => {
            const previousNaturalUnit = await stableCollateral.naturalUnit.callAsync();

            await subject();

            const newSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const newSet = await protocolHelper.getSetTokenAsync(newSetAddress);
            const newSetNaturalUnit = await newSet.naturalUnit.callAsync();

            const expectedNextSetParams = await managerHelper.getExpectedMACONewCollateralParametersAsync(
              stableCollateral,
              riskCollateral,
              ethMedianizer,
              USDC_DECIMALS,
              ETH_DECIMALS,
              true
            );

            expect(previousNaturalUnit).to.be.bignumber.not.equal(newSetNaturalUnit);
            expect(newSetNaturalUnit).to.be.bignumber.equal(expectedNextSetParams['naturalUnit']);
          });

          it('updates new stable collateral to the correct units', async () => {
            await subject();

            const newSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const newSet = await protocolHelper.getSetTokenAsync(newSetAddress);
            const newSetUnits = await newSet.getUnits.callAsync();

            const expectedNextSetParams = await managerHelper.getExpectedMACONewCollateralParametersAsync(
              stableCollateral,
              riskCollateral,
              ethMedianizer,
              USDC_DECIMALS,
              ETH_DECIMALS,
              true
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
              riskCollateral,
              newSet,
              true,
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
              riskCollateral,
              newSet,
              true,
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
            triggerPrice = ether(150);
            lastPrice = ether(130);
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

      describe('and allocating from stable asset to risk asset', async () => {
        before(async () => {
          updatedValues = _.map(new Array(19), function(el, i) {return ether(170 + i); });
          triggerPrice = ether(100);
          lastPrice = triggerPrice;
        });

        it('updates to the next set correctly', async () => {
          await subject();

          const actualNextSet = await rebalancingSetToken.nextSet.callAsync();
          expect(actualNextSet).to.equal(riskCollateral.address);
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
            stableCollateral,
            riskCollateral,
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
          await subject();

          const timeIncrement = new BigNumber(600);
          const auctionPriceParameters = await managerHelper.getExpectedMACOAuctionParametersAsync(
            stableCollateral,
            riskCollateral,
            false,
            lastPrice,
            timeIncrement,
            auctionTimeToPivot
          );

          const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
          const newAuctionPivotPrice = newAuctionParameters[3];

          expect(newAuctionPivotPrice).to.be.bignumber.equal(auctionPriceParameters['auctionPivotPrice']);
        });

        it('emits correct LogProposal event', async () => {
          const txHash = await subject();

          const movingAveragePrice = new BigNumber(await movingAverageOracle.read.callAsync(new BigNumber(20)));
          const formattedLogs = await setTestUtils.getLogsFromTxHash(txHash);
          const expectedLogs = LogManagerProposal(
            lastPrice,
            movingAveragePrice,
            macoStrategyManager.address
          );

          await SetTestUtils.assertLogEquivalence(formattedLogs, expectedLogs);
        });

        describe('but quoteAsset collateral is 4x more valuable than baseAsset collateral', async () => {
          before(async () => {
            triggerPrice = ether(20);
            lastPrice = triggerPrice;
          });

          it('should set new risk collateral address', async () => {
            const txHash = await subject();

            const logs = await setTestUtils.getLogsFromTxHash(txHash);
            const expectedSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);

            const actualRiskCollateralAddress = await macoStrategyManager.riskCollateralAddress.callAsync();
            expect(actualRiskCollateralAddress).to.equal(expectedSetAddress);
          });

          it('updates new risk collateral to the correct naturalUnit', async () => {
            await subject();

            const newSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const newSet = await protocolHelper.getSetTokenAsync(newSetAddress);
            const newSetNaturalUnit = await newSet.naturalUnit.callAsync();

            const expectedNextSetParams = await managerHelper.getExpectedMACONewCollateralParametersAsync(
              stableCollateral,
              newSet,
              ethMedianizer,
              USDC_DECIMALS,
              ETH_DECIMALS,
              false
            );
            expect(newSetNaturalUnit).to.be.bignumber.equal(expectedNextSetParams['naturalUnit']);
          });

          it('updates new risk collateral to the correct units', async () => {
            await subject();

            const newSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const newSet = await protocolHelper.getSetTokenAsync(newSetAddress);
            const newSetUnits = await newSet.getUnits.callAsync();

            const expectedNextSetParams = await managerHelper.getExpectedMACONewCollateralParametersAsync(
              stableCollateral,
              newSet,
              ethMedianizer,
              USDC_DECIMALS,
              ETH_DECIMALS,
              false
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
              stableCollateral,
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
              stableCollateral,
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
            updatedValues = _.map(new Array(20), function(el, i) {return ether((2 * 10 ** 8) + i); });
            triggerPrice = ether(2 * 10 ** 8);
            lastPrice = triggerPrice;
          });

          after(async () => {
            updatedValues = _.map(new Array(19), function(el, i) {return ether(170 + i); });
          });

          it('should set new risk collateral address', async () => {
            const txHash = await subject();

            const logs = await setTestUtils.getLogsFromTxHash(txHash);
            const expectedSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);

            const actualRiskCollateralAddress = await macoStrategyManager.riskCollateralAddress.callAsync();
            expect(actualRiskCollateralAddress).to.equal(expectedSetAddress);
          });

          it('updates new risk collateral to the correct naturalUnit', async () => {
            const previousNaturalUnit = await riskCollateral.naturalUnit.callAsync();

            await subject();

            const newSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const newSet = await protocolHelper.getSetTokenAsync(newSetAddress);
            const newSetNaturalUnit = await newSet.naturalUnit.callAsync();

            const expectedNextSetParams = await managerHelper.getExpectedMACONewCollateralParametersAsync(
              stableCollateral,
              riskCollateral,
              ethMedianizer,
              USDC_DECIMALS,
              ETH_DECIMALS,
              false
            );

            expect(previousNaturalUnit).to.be.bignumber.not.equal(newSetNaturalUnit);
            expect(newSetNaturalUnit).to.be.bignumber.equal(expectedNextSetParams['naturalUnit']);
          });

          it('updates new risk collateral to the correct units', async () => {
            await subject();

            const newSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const newSet = await protocolHelper.getSetTokenAsync(newSetAddress);
            const newSetUnits = await newSet.getUnits.callAsync();

            const expectedNextSetParams = await managerHelper.getExpectedMACONewCollateralParametersAsync(
              stableCollateral,
              riskCollateral,
              ethMedianizer,
              USDC_DECIMALS,
              ETH_DECIMALS,
              false
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
              stableCollateral,
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
              stableCollateral,
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

        describe('but price has not gone below MA', async () => {
          before(async () => {
            triggerPrice = ether(170);
            lastPrice = ether(180);
          });

          after(async () => {
            triggerPrice = ether(140);
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

    describe('when propose is called and rebalancing set token is in Proposal state', async () => {
      beforeEach(async () => {
        await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS.div(4));
        await macoStrategyManager.confirmPropose.sendTransactionAsync();

        subjectTimeFastForward = new BigNumber(1);
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

        await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS.div(4));
        await macoStrategyManager.confirmPropose.sendTransactionAsync();

        await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS);
        await rebalancingSetToken.startRebalance.sendTransactionAsync();
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });
});