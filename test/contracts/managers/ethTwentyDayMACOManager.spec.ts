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
  StandardTokenMockContract,
  TransferProxyContract,
  WethMockContract,
} from 'set-protocol-contracts';
import {
  DailyPriceFeedContract,
  MovingAverageOracleContract,
  ETHTwentyDayMACOManagerContract,
} from '@utils/contracts';
import { ONE_DAY_IN_SECONDS, DEFAULT_GAS } from '@utils/constants';
import { expectRevertError } from '@utils/tokenAssertions';
import { getWeb3 } from '@utils/web3Helper';

import { ERC20Wrapper } from '@utils/wrappers/erc20Wrapper';
import { ManagerWrapper } from '@utils/wrappers/managerWrapper';
import { OracleWrapper } from '@utils/wrappers/oracleWrapper';
import { ProtocolWrapper } from '@utils/wrappers/protocolWrapper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;

contract('ETHTwentyDayMACOManager', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let rebalancingSetToken: RebalancingSetTokenContract;

  let core: CoreContract;
  let transferProxy: TransferProxyContract;
  let factory: SetTokenFactoryContract;
  let rebalancingFactory: RebalancingSetTokenFactoryContract;
  let linearAuctionPriceCurve: LinearAuctionPriceCurveContract;
  let ethMedianizer: MedianContract;
  let daiMock: StandardTokenMockContract;
  let wrappedETH: WethMockContract;

  let dailyPriceFeed: DailyPriceFeedContract;
  let movingAverageOracle: MovingAverageOracleContract;
  let ethTwentyDayMACOManager: ETHTwentyDayMACOManagerContract;

  let stableCollateral: SetTokenContract;
  let riskCollateral: SetTokenContract;

  let initialEthPrice: BigNumber;

  const protocolWrapper = new ProtocolWrapper(deployerAccount);
  const erc20Wrapper = new ERC20Wrapper(deployerAccount);
  const managerWrapper = new ManagerWrapper(deployerAccount);
  const oracleWrapper = new OracleWrapper(deployerAccount);

  before(async () => {
    ABIDecoder.addABI(Core.abi);
  });

  after(async () => {
    ABIDecoder.removeABI(Core.abi);
  });

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    transferProxy = await protocolWrapper.getDeployedTransferProxyAsync();
    core = await protocolWrapper.getDeployedCoreAsync();

    factory = await protocolWrapper.getDeployedSetTokenFactoryAsync();
    rebalancingFactory = await protocolWrapper.getDeployedRebalancingSetTokenFactoryAsync();
    linearAuctionPriceCurve = await protocolWrapper.getDeployedLinearAuctionPriceCurveAsync();

    ethMedianizer = await protocolWrapper.getDeployedWETHMedianizerAsync();
    await oracleWrapper.addPriceFeedOwnerToMedianizer(ethMedianizer, deployerAccount);

    initialEthPrice = ether(150);
    await oracleWrapper.updateMedianizerPriceAsync(
      ethMedianizer,
      initialEthPrice,
      SetTestUtils.generateTimestamp(1000),
    );

    daiMock = await protocolWrapper.getDeployedDAIAsync();
    wrappedETH = await protocolWrapper.getDeployedWETHAsync();
    await erc20Wrapper.approveTransfersAsync(
      [daiMock, wrappedETH],
      transferProxy.address
    );

    const feedDataDescription = '200DailyETHPrice';
    const seededValues = [];
    dailyPriceFeed = await oracleWrapper.deployDailyPriceFeedAsync(
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
      [daiMock.address],
      [new BigNumber(100)],
      new BigNumber(1),
    );

    riskCollateral = await protocolWrapper.createSetTokenAsync(
      core,
      factory.address,
      [wrappedETH.address],
      [new BigNumber(1)],
      new BigNumber(1),
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectCoreAddress: Address;
    let subjectMovingAveragePriceFeed: Address;
    let subjectDaiAddress: Address;
    let subjectStableCollateralAddress: Address;
    let subjectRiskCollateralAddress: Address;
    let subjectSetTokenFactoryAddress: Address;
    let subjectAuctionLibraryAddress: Address;
    let subjectAuctionTimeToPivot: BigNumber;
    let subjectRiskOn: boolean;

    beforeEach(async () => {
      subjectCoreAddress = core.address;
      subjectMovingAveragePriceFeed = movingAverageOracle.address;
      subjectDaiAddress = daiMock.address;
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
        subjectDaiAddress,
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

    it('sets the correct dai address', async () => {
      ethTwentyDayMACOManager = await subject();

      const actualDaiAddress = await ethTwentyDayMACOManager.daiAddress.callAsync();

      expect(actualDaiAddress).to.equal(subjectDaiAddress);
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

  describe.only('#propose', async () => {
    let subjectRebalancingSetToken: Address;
    let subjectTimeFastForward: BigNumber;
    let subjectCaller: Address;

    let updatedValues: BigNumber[];
    let lastPrice: BigNumber;

    before(async () => {
      updatedValues = _.map(new Array(19), function(el, i) {return ether(150 + i); });
      lastPrice = new BigNumber(140);
    });

    beforeEach(async () => {
      await oracleWrapper.batchUpdateDailyPriceFeedAsync(
        dailyPriceFeed,
        ethMedianizer,
        20,
        updatedValues
      );

      const auctionTimeToPivot = ONE_DAY_IN_SECONDS.div(6);
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
        daiMock.address,
        stableCollateral.address,
        riskCollateral.address,
        factory.address,
        linearAuctionPriceCurve.address,
        auctionTimeToPivot,
        riskOn,
      );

      const proposalPeriod = ONE_DAY_IN_SECONDS;
      rebalancingSetToken = await protocolWrapper.createDefaultRebalancingSetTokenAsync(
        core,
        rebalancingFactory.address,
        ethTwentyDayMACOManager.address,
        initialAllocationAddress,
        proposalPeriod
      );

      const blockInfo = await web3.eth.getBlock('latest');
      await oracleWrapper.updateMedianizerPriceAsync(
        ethMedianizer,
        lastPrice,
        new BigNumber(blockInfo.timestamp + 1),
      );

      subjectRebalancingSetToken = rebalancingSetToken.address;
      subjectTimeFastForward = ONE_DAY_IN_SECONDS.add(1);
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      await blockchain.increaseTimeAsync(subjectTimeFastForward);
      return ethTwentyDayMACOManager.propose.sendTransactionAsync(
        subjectRebalancingSetToken,
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    describe('when propose is called from the Default state', async () => {
      describe('and allocating from risk asset to stable asset', async () => {
        it('updates new set token to the correct naturalUnit', async () => {
          await subject();
        });

        describe('but price has not dipped below MA', async () => {
          before(async () => {
            lastPrice = new BigNumber(170);
          });

          it('should revert', async () => {
            await expectRevertError(subject());
          });
        });
      });
    });
  });
});