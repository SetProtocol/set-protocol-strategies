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
  HistoricalPriceFeedContract,
  ETHTwentyDayMACOManagerContract,
  MovingAverageOracleContract,
  USDCMockContract,
} from '@utils/contracts';
import {
  DEFAULT_GAS,
  ETH_DECIMALS,
  ONE_DAY_IN_SECONDS,
  RISK_COLLATERAL_NATURAL_UNIT,
  STABLE_COLLATERAL_NATURAL_UNIT,
  USDC_DECIMALS,
} from '@utils/constants';
import { extractNewSetTokenAddressFromLogs } from '@utils/contract_logs/core';
import { expectRevertError } from '@utils/tokenAssertions';
import { getWeb3 } from '@utils/web3Helper';
import { LogManagerProposal } from '@utils/contract_logs/ethTwentyDayMACOManager';

import { ERC20Wrapper } from '@utils/wrappers/erc20Wrapper';
import { ManagerWrapper } from '@utils/wrappers/managerWrapper';
import { OracleWrapper } from '@utils/wrappers/oracleWrapper';
import { ProtocolWrapper } from '@utils/wrappers/protocolWrapper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const ETHTwentyDayMACOManager = artifacts.require('ETHTwentyDayMACOManager');
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;
const setTestUtils = new SetTestUtils(web3);

contract('ETHTwentyDayMACOManager', accounts => {
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
  let ethMedianizer: MedianContract;
  let usdcMock: USDCMockContract;
  let wrappedETH: WethMockContract;

  let dailyPriceFeed: HistoricalPriceFeedContract;
  let movingAverageOracle: MovingAverageOracleContract;
  let ethTwentyDayMACOManager: ETHTwentyDayMACOManagerContract;

  let stableCollateral: SetTokenContract;
  let riskCollateral: SetTokenContract;

  let initialEthPrice: BigNumber;

  const protocolWrapper = new ProtocolWrapper(deployerAccount);
  const erc20Wrapper = new ERC20Wrapper(deployerAccount);
  const managerWrapper = new ManagerWrapper(deployerAccount);
  const oracleWrapper = new OracleWrapper(deployerAccount);

  const SEVEN_DAYS_IN_MINUTES = 7 * 1440;

  before(async () => {
    ABIDecoder.addABI(Core.abi);
    ABIDecoder.addABI(ETHTwentyDayMACOManager.abi);
  });

  after(async () => {
    ABIDecoder.removeABI(Core.abi);
    ABIDecoder.removeABI(ETHTwentyDayMACOManager.abi);
  });

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    transferProxy = await protocolWrapper.getDeployedTransferProxyAsync();
    core = await protocolWrapper.getDeployedCoreAsync();

    factory = await protocolWrapper.getDeployedSetTokenFactoryAsync();
    rebalancingFactory = await protocolWrapper.getDeployedRebalancingSetTokenFactoryAsync();
    linearAuctionPriceCurve = await protocolWrapper.getDeployedLinearAuctionPriceCurveAsync();
    whiteList = await protocolWrapper.getDeployedWhiteList();

    ethMedianizer = await protocolWrapper.getDeployedWETHMedianizerAsync();
    await oracleWrapper.addPriceFeedOwnerToMedianizer(ethMedianizer, deployerAccount);

    initialEthPrice = ether(150);
    await oracleWrapper.updateMedianizerPriceAsync(
      ethMedianizer,
      initialEthPrice,
      SetTestUtils.generateTimestamp(1000),
    );

    usdcMock = await erc20Wrapper.deployUSDCTokenAsync(deployerAccount);
    await protocolWrapper.addTokenToWhiteList(usdcMock.address, whiteList);
    await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS.mul(7));
    await protocolWrapper.addTokenToWhiteList(usdcMock.address, whiteList);

    wrappedETH = await protocolWrapper.getDeployedWETHAsync();
    await erc20Wrapper.approveTransfersAsync(
      [usdcMock, wrappedETH],
      transferProxy.address
    );

    const updateFrequency = ONE_DAY_IN_SECONDS;
    const feedDataDescription = '200DailyETHPrice';
    const seededValues = [];
    dailyPriceFeed = await oracleWrapper.deployHistoricalPriceFeedAsync(
      updateFrequency,
      ethMedianizer.address,
      feedDataDescription,
      seededValues,
    );

    const dataDescription = 'ETH20dayMA';
    movingAverageOracle = await oracleWrapper.deployMovingAverageOracleAsync(
      dailyPriceFeed.address,
      dataDescription
    );

    stableCollateral = await protocolWrapper.createSetTokenAsync(
      core,
      factory.address,
      [usdcMock.address],
      [new BigNumber(100)],
      STABLE_COLLATERAL_NATURAL_UNIT,
    );

    riskCollateral = await protocolWrapper.createSetTokenAsync(
      core,
      factory.address,
      [wrappedETH.address],
      [new BigNumber(100)],
      RISK_COLLATERAL_NATURAL_UNIT,
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectCoreAddress: Address;
    let subjectMovingAveragePriceFeed: Address;
    let subjectUSDCAddress: Address;
    let subjectEthAddress: Address;
    let subjectStableCollateralAddress: Address;
    let subjectRiskCollateralAddress: Address;
    let subjectSetTokenFactoryAddress: Address;
    let subjectAuctionLibraryAddress: Address;
    let subjectAuctionTimeToPivot: BigNumber;
    let subjectRiskOn: boolean;

    beforeEach(async () => {
      subjectCoreAddress = core.address;
      subjectMovingAveragePriceFeed = movingAverageOracle.address;
      subjectUSDCAddress = usdcMock.address;
      subjectEthAddress = wrappedETH.address;
      subjectStableCollateralAddress = stableCollateral.address;
      subjectRiskCollateralAddress = riskCollateral.address;
      subjectSetTokenFactoryAddress = factory.address;
      subjectAuctionLibraryAddress = linearAuctionPriceCurve.address;
      subjectAuctionTimeToPivot = ONE_DAY_IN_SECONDS.div(6);
      subjectRiskOn = false;
    });

    async function subject(): Promise<ETHTwentyDayMACOManagerContract> {
      return managerWrapper.deployETHTwentyDayMACOManagerAsync(
        subjectCoreAddress,
        subjectMovingAveragePriceFeed,
        subjectUSDCAddress,
        subjectEthAddress,
        subjectStableCollateralAddress,
        subjectRiskCollateralAddress,
        subjectSetTokenFactoryAddress,
        subjectAuctionLibraryAddress,
        subjectAuctionTimeToPivot,
        subjectRiskOn
      );
    }

    it('sets the correct core address', async () => {
      ethTwentyDayMACOManager = await subject();

      const actualCoreAddress = await ethTwentyDayMACOManager.coreAddress.callAsync();

      expect(actualCoreAddress).to.equal(subjectCoreAddress);
    });

    it('sets the correct moving average price feed address', async () => {
      ethTwentyDayMACOManager = await subject();

      const actualMovingAveragePriceFeedAddress = await ethTwentyDayMACOManager.movingAveragePriceFeed.callAsync();

      expect(actualMovingAveragePriceFeedAddress).to.equal(subjectMovingAveragePriceFeed);
    });

    it('sets the correct usdc address', async () => {
      ethTwentyDayMACOManager = await subject();

      const actualUSDCAddress = await ethTwentyDayMACOManager.usdcAddress.callAsync();

      expect(actualUSDCAddress).to.equal(subjectUSDCAddress);
    });

    it('sets the correct stable collateral address', async () => {
      ethTwentyDayMACOManager = await subject();

      const actualStableCollateralAddress = await ethTwentyDayMACOManager.stableCollateralAddress.callAsync();

      expect(actualStableCollateralAddress).to.equal(subjectStableCollateralAddress);
    });

    it('sets the correct risk collateral address', async () => {
      ethTwentyDayMACOManager = await subject();

      const actualRiskCollateralAddress = await ethTwentyDayMACOManager.riskCollateralAddress.callAsync();

      expect(actualRiskCollateralAddress).to.equal(subjectRiskCollateralAddress);
    });

    it('sets the correct set token factory address', async () => {
      ethTwentyDayMACOManager = await subject();

      const actualSetTokenFactoryAddress = await ethTwentyDayMACOManager.setTokenFactory.callAsync();

      expect(actualSetTokenFactoryAddress).to.equal(subjectSetTokenFactoryAddress);
    });

    it('sets the correct auction library address', async () => {
      ethTwentyDayMACOManager = await subject();

      const actualAuctionLibraryAddress = await ethTwentyDayMACOManager.auctionLibrary.callAsync();

      expect(actualAuctionLibraryAddress).to.equal(subjectAuctionLibraryAddress);
    });

    it('sets the correct auction time to pivot', async () => {
      ethTwentyDayMACOManager = await subject();

      const actualAuctionTimeToPivot = await ethTwentyDayMACOManager.auctionTimeToPivot.callAsync();

      expect(actualAuctionTimeToPivot).to.be.bignumber.equal(subjectAuctionTimeToPivot);
    });

    it('sets the correct risk on parameter', async () => {
      ethTwentyDayMACOManager = await subject();

      const actualRiskOn = await ethTwentyDayMACOManager.riskOn.callAsync();

      expect(actualRiskOn).to.equal(subjectRiskOn);
    });
  });

  describe('#initialize', async () => {
    let subjectRebalancingSetToken: Address;
    let subjectCaller: Address;

    let updatedValues: BigNumber[];
    let proposalPeriod: BigNumber;
    let auctionTimeToPivot: BigNumber;

    before(async () => {
      updatedValues = _.map(new Array(19), function(el, i) {return ether(150 + i); });
    });

    beforeEach(async () => {
      await oracleWrapper.batchUpdateHistoricalPriceFeedAsync(
        dailyPriceFeed,
        ethMedianizer,
        SEVEN_DAYS_IN_MINUTES,
        20,
        updatedValues
      );

      auctionTimeToPivot = ONE_DAY_IN_SECONDS.div(4);
      const [riskOn, initialAllocationAddress] = await managerWrapper.getMACOInitialAllocationAsync(
        stableCollateral,
        riskCollateral,
        ethMedianizer,
        movingAverageOracle,
        new BigNumber(20)
      );

      ethTwentyDayMACOManager = await managerWrapper.deployETHTwentyDayMACOManagerAsync(
        core.address,
        movingAverageOracle.address,
        usdcMock.address,
        wrappedETH.address,
        stableCollateral.address,
        riskCollateral.address,
        factory.address,
        linearAuctionPriceCurve.address,
        auctionTimeToPivot,
        riskOn,
      );

      proposalPeriod = ONE_DAY_IN_SECONDS;
      rebalancingSetToken = await protocolWrapper.createDefaultRebalancingSetTokenAsync(
        core,
        rebalancingFactory.address,
        ethTwentyDayMACOManager.address,
        initialAllocationAddress,
        proposalPeriod
      );

      subjectRebalancingSetToken = rebalancingSetToken.address;
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      return ethTwentyDayMACOManager.initialize.sendTransactionAsync(
        subjectRebalancingSetToken,
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    it('sets the rebalancing set token address', async () => {
      await subject();

      const rebalancingSetTokenAddress = await ethTwentyDayMACOManager.rebalancingSetTokenAddress.callAsync();

      expect(rebalancingSetTokenAddress).to.equal(subjectRebalancingSetToken);
    });

    describe('when the rebalancing set address has already been set', async () => {
      beforeEach(async () => {
        await ethTwentyDayMACOManager.initialize.sendTransactionAsync(
          subjectRebalancingSetToken,
          { from: subjectCaller, gas: DEFAULT_GAS}
        );
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
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
        const unTrackedSetToken = await protocolWrapper.createDefaultRebalancingSetTokenAsync(
          core,
          rebalancingFactory.address,
          ethTwentyDayMACOManager.address,
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
    let misalignedRiskOn: boolean = undefined;

    before(async () => {
      updatedValues = _.map(new Array(19), function(el, i) {return ether(150 + i); });
      lastPrice = ether(140);
    });

    beforeEach(async () => {
      await oracleWrapper.batchUpdateHistoricalPriceFeedAsync(
        dailyPriceFeed,
        ethMedianizer,
        SEVEN_DAYS_IN_MINUTES,
        20,
        updatedValues
      );

      auctionTimeToPivot = ONE_DAY_IN_SECONDS.div(4);
      const [riskOn, initialAllocationAddress] = await managerWrapper.getMACOInitialAllocationAsync(
        stableCollateral,
        riskCollateral,
        ethMedianizer,
        movingAverageOracle,
        new BigNumber(20)
      );

      let passedRiskOn: boolean;
      if (misalignedRiskOn != undefined) {
        passedRiskOn = misalignedRiskOn;
      } else {
        passedRiskOn = riskOn;
      }

      ethTwentyDayMACOManager = await managerWrapper.deployETHTwentyDayMACOManagerAsync(
        core.address,
        movingAverageOracle.address,
        usdcMock.address,
        wrappedETH.address,
        stableCollateral.address,
        riskCollateral.address,
        factory.address,
        linearAuctionPriceCurve.address,
        auctionTimeToPivot,
        passedRiskOn,
      );

      proposalPeriod = ONE_DAY_IN_SECONDS;
      rebalancingSetToken = await protocolWrapper.createDefaultRebalancingSetTokenAsync(
        core,
        rebalancingFactory.address,
        ethTwentyDayMACOManager.address,
        initialAllocationAddress,
        proposalPeriod
      );

      await ethTwentyDayMACOManager.initialize.sendTransactionAsync(
        rebalancingSetToken.address,
        { from: subjectCaller, gas: DEFAULT_GAS}
      );

      const blockInfo = await web3.eth.getBlock('latest');
      await oracleWrapper.updateMedianizerPriceAsync(
        ethMedianizer,
        lastPrice,
        new BigNumber(blockInfo.timestamp + 1),
      );

      subjectTimeFastForward = ONE_DAY_IN_SECONDS.add(1);
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      await blockchain.increaseTimeAsync(subjectTimeFastForward);
      return ethTwentyDayMACOManager.initialPropose.sendTransactionAsync(
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    describe('when propose is called from the Default state', async () => {
      describe('and allocating from risk asset to stable asset', async () => {
        it('sets the proposalTimestamp correctly', async () => {
          await subject();

          const block = await web3.eth.getBlock('latest');
          const expectedTimestamp = new BigNumber(block.timestamp);

          const actualTimestamp = await ethTwentyDayMACOManager.proposalTimestamp.callAsync();
          expect(actualTimestamp).to.be.bignumber.equal(expectedTimestamp);
        });

        describe('but riskOn parameter has become misaligned due to failed rebalance', async () => {
          before(async () => {
            misalignedRiskOn = false;
          });

          after(async () => {
            misalignedRiskOn = undefined;
          });

          it('riskOn parameter is flipped', async () => {
            const preCallRiskOn = await ethTwentyDayMACOManager.riskOn.callAsync();
            expect(preCallRiskOn).to.equal(false);

            await subject();

            const postCallRiskOn = await ethTwentyDayMACOManager.riskOn.callAsync();
            expect(postCallRiskOn).to.equal(true);
          });

          it('sets the proposalTimestamp correctly', async () => {
            await subject();

            const block = await web3.eth.getBlock('latest');
            const expectedTimestamp = new BigNumber(block.timestamp);

            const actualTimestamp = await ethTwentyDayMACOManager.proposalTimestamp.callAsync();
            expect(actualTimestamp).to.be.bignumber.equal(expectedTimestamp);
          });
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
            await ethTwentyDayMACOManager.initialPropose.sendTransactionAsync();
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
          updatedValues = _.map(new Array(19), function(el, i) {return ether(170 - i); });
          lastPrice = ether(170);
        });

        it('sets the proposalTimestamp correctly', async () => {
          await subject();

          const block = await web3.eth.getBlock('latest');
          const expectedTimestamp = new BigNumber(block.timestamp);

          const actualTimestamp = await ethTwentyDayMACOManager.proposalTimestamp.callAsync();
          expect(actualTimestamp).to.be.bignumber.equal(expectedTimestamp);
        });

        describe('but riskOn parameter has become misaligned due to failed rebalance', async () => {
          before(async () => {
            misalignedRiskOn = true;
          });

          after(async () => {
            misalignedRiskOn = undefined;
          });

          it('riskOn parameter is flipped', async () => {
            const preCallRiskOn = await ethTwentyDayMACOManager.riskOn.callAsync();
            expect(preCallRiskOn).to.equal(true);

            await subject();

            const postCallRiskOn = await ethTwentyDayMACOManager.riskOn.callAsync();
            expect(postCallRiskOn).to.equal(false);
          });

          it('sets the proposalTimestamp correctly', async () => {
            await subject();

            const block = await web3.eth.getBlock('latest');
            const expectedTimestamp = new BigNumber(block.timestamp);

            const actualTimestamp = await ethTwentyDayMACOManager.proposalTimestamp.callAsync();
            expect(actualTimestamp).to.be.bignumber.equal(expectedTimestamp);
          });
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
        await ethTwentyDayMACOManager.initialPropose.sendTransactionAsync();

        await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS.div(4));
        await ethTwentyDayMACOManager.confirmPropose.sendTransactionAsync();
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

    before(async () => {
      updatedValues = _.map(new Array(19), function(el, i) {return ether(150 + i); });
      triggerPrice = ether(140);
      lastPrice = triggerPrice;
    });

    beforeEach(async () => {
      await oracleWrapper.batchUpdateHistoricalPriceFeedAsync(
        dailyPriceFeed,
        ethMedianizer,
        SEVEN_DAYS_IN_MINUTES,
        20,
        updatedValues
      );

      auctionTimeToPivot = ONE_DAY_IN_SECONDS.div(4);
      const [riskOn, initialAllocationAddress] = await managerWrapper.getMACOInitialAllocationAsync(
        stableCollateral,
        riskCollateral,
        ethMedianizer,
        movingAverageOracle,
        new BigNumber(20)
      );

      ethTwentyDayMACOManager = await managerWrapper.deployETHTwentyDayMACOManagerAsync(
        core.address,
        movingAverageOracle.address,
        usdcMock.address,
        wrappedETH.address,
        stableCollateral.address,
        riskCollateral.address,
        factory.address,
        linearAuctionPriceCurve.address,
        auctionTimeToPivot,
        riskOn,
      );

      proposalPeriod = ONE_DAY_IN_SECONDS;
      rebalancingSetToken = await protocolWrapper.createDefaultRebalancingSetTokenAsync(
        core,
        rebalancingFactory.address,
        ethTwentyDayMACOManager.address,
        initialAllocationAddress,
        proposalPeriod
      );

      await ethTwentyDayMACOManager.initialize.sendTransactionAsync(
        rebalancingSetToken.address,
        { from: subjectCaller, gas: DEFAULT_GAS}
      );

      const triggerBlockInfo = await web3.eth.getBlock('latest');
      await oracleWrapper.updateMedianizerPriceAsync(
        ethMedianizer,
        triggerPrice,
        new BigNumber(triggerBlockInfo.timestamp + 1),
      );

      await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS.add(1));
      await ethTwentyDayMACOManager.initialPropose.sendTransactionAsync();

      const lastBlockInfo = await web3.eth.getBlock('latest');
      await oracleWrapper.updateMedianizerPriceAsync(
        ethMedianizer,
        lastPrice,
        new BigNumber(lastBlockInfo.timestamp + 1),
      );

      subjectTimeFastForward = ONE_DAY_IN_SECONDS.div(4).add(1);
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      await blockchain.increaseTimeAsync(subjectTimeFastForward);
      return ethTwentyDayMACOManager.confirmPropose.sendTransactionAsync(
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
          const auctionPriceParameters = await managerWrapper.getExpectedMACOAuctionParametersAsync(
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
          const auctionPriceParameters = await managerWrapper.getExpectedMACOAuctionParametersAsync(
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

        it('updates riskOn to false', async () => {
          await subject();

          const actualRiskOn = await ethTwentyDayMACOManager.riskOn.callAsync();

          expect(actualRiskOn).to.equal(false);
        });

        it('emits correct LogProposal event', async () => {
          const txHash = await subject();

          const movingAveragePrice = new BigNumber(await movingAverageOracle.read.callAsync(new BigNumber(20)));
          const formattedLogs = await setTestUtils.getLogsFromTxHash(txHash);
          const expectedLogs = LogManagerProposal(
            lastPrice,
            movingAveragePrice,
            ethTwentyDayMACOManager.address
          );

          await SetTestUtils.assertLogEquivalence(formattedLogs, expectedLogs);
        });

        describe('but stable collateral is 5x valuable than risk collateral', async () => {
          before(async () => {
            triggerPrice = ether(20);
            lastPrice = triggerPrice;
          });

          it('should set new stable collateral address', async () => {
            const txHash = await subject();

            const logs = await setTestUtils.getLogsFromTxHash(txHash);
            const expectedSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);

            const actualStableCollateralAddress = await ethTwentyDayMACOManager.stableCollateralAddress.callAsync();
            expect(actualStableCollateralAddress).to.equal(expectedSetAddress);
          });

          it('updates new stable collateral to the correct naturalUnit', async () => {
            await subject();

            const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const nextSet = await protocolWrapper.getSetTokenAsync(nextSetAddress);
            const nextSetNaturalUnit = await nextSet.naturalUnit.callAsync();

            const expectedNextSetParams = await managerWrapper.getExpectedMACONewCollateralParametersAsync(
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
            const nextSet = await protocolWrapper.getSetTokenAsync(nextSetAddress);
            const nextSetUnits = await nextSet.getUnits.callAsync();

            const expectedNextSetParams = await managerWrapper.getExpectedMACONewCollateralParametersAsync(
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
            const nextSet = await protocolWrapper.getSetTokenAsync(nextSetAddress);
            const nextSetComponents = await nextSet.getComponents.callAsync();

            const expectedNextSetComponents = [usdcMock.address];
            expect(JSON.stringify(nextSetComponents)).to.be.eql(JSON.stringify(expectedNextSetComponents));
          });

          it('updates the auction start price correctly', async () => {
            const txHash = await subject();

            const logs = await setTestUtils.getLogsFromTxHash(txHash);
            const newSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);
            const newSet = await protocolWrapper.getSetTokenAsync(newSetAddress);

            const timeIncrement = new BigNumber(600);
            const auctionPriceParameters = await managerWrapper.getExpectedMACOAuctionParametersAsync(
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
            const newSet = await protocolWrapper.getSetTokenAsync(newSetAddress);

            const timeIncrement = new BigNumber(600);
            const auctionPriceParameters = await managerWrapper.getExpectedMACOAuctionParametersAsync(
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

          it('updates riskOn to false', async () => {
            await subject();

            const actualRiskOn = await ethTwentyDayMACOManager.riskOn.callAsync();

            expect(actualRiskOn).to.equal(false);
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

      describe('and allocating from stable asset to risk asset', async () => {
        before(async () => {
          updatedValues = _.map(new Array(19), function(el, i) {return ether(170 - i); });
          triggerPrice = ether(170);
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
          const auctionPriceParameters = await managerWrapper.getExpectedMACOAuctionParametersAsync(
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
          const auctionPriceParameters = await managerWrapper.getExpectedMACOAuctionParametersAsync(
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

        it('updates riskOn to true', async () => {
          await subject();

          const actualRiskOn = await ethTwentyDayMACOManager.riskOn.callAsync();

          expect(actualRiskOn).to.equal(true);
        });

        it('emits correct LogProposal event', async () => {
          const txHash = await subject();

          const movingAveragePrice = new BigNumber(await movingAverageOracle.read.callAsync(new BigNumber(20)));
          const formattedLogs = await setTestUtils.getLogsFromTxHash(txHash);
          const expectedLogs = LogManagerProposal(
            lastPrice,
            movingAveragePrice,
            ethTwentyDayMACOManager.address
          );

          await SetTestUtils.assertLogEquivalence(formattedLogs, expectedLogs);
        });

        describe('but risk collateral is 5x valuable than stable collateral', async () => {
          before(async () => {
            triggerPrice = ether(500);
            lastPrice = triggerPrice;
          });

          it('should set new risk collateral address', async () => {
            const txHash = await subject();

            const logs = await setTestUtils.getLogsFromTxHash(txHash);
            const expectedSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);

            const actualRiskCollateralAddress = await ethTwentyDayMACOManager.riskCollateralAddress.callAsync();
            expect(actualRiskCollateralAddress).to.equal(expectedSetAddress);
          });

          it('updates new risk collateral to the correct naturalUnit', async () => {
            await subject();

            const newSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const newSet = await protocolWrapper.getSetTokenAsync(newSetAddress);
            const newSetNaturalUnit = await newSet.naturalUnit.callAsync();

            const expectedNextSetParams = await managerWrapper.getExpectedMACONewCollateralParametersAsync(
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
            const newSet = await protocolWrapper.getSetTokenAsync(newSetAddress);
            const newSetUnits = await newSet.getUnits.callAsync();

            const expectedNextSetParams = await managerWrapper.getExpectedMACONewCollateralParametersAsync(
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
            const nextSet = await protocolWrapper.getSetTokenAsync(nextSetAddress);
            const nextSetComponents = await nextSet.getComponents.callAsync();

            const expectedNextSetComponents = [wrappedETH.address];
            expect(JSON.stringify(nextSetComponents)).to.be.eql(JSON.stringify(expectedNextSetComponents));
          });

          it('updates the auction start price correctly', async () => {
            const txHash = await subject();

            const logs = await setTestUtils.getLogsFromTxHash(txHash);
            const newSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);
            const newSet = await protocolWrapper.getSetTokenAsync(newSetAddress);

            const timeIncrement = new BigNumber(600);
            const auctionPriceParameters = await managerWrapper.getExpectedMACOAuctionParametersAsync(
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
            const newSet = await protocolWrapper.getSetTokenAsync(newSetAddress);

            const timeIncrement = new BigNumber(600);
            const auctionPriceParameters = await managerWrapper.getExpectedMACOAuctionParametersAsync(
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

          it('updates riskOn to true', async () => {
            await subject();

            const actualRiskOn = await ethTwentyDayMACOManager.riskOn.callAsync();

            expect(actualRiskOn).to.equal(true);
          });
        });

        describe('but price has not gone above MA', async () => {
          before(async () => {
            triggerPrice = ether(170);
            lastPrice = ether(150);
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
    });
  });
});