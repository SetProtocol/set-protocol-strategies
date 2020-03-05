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
  LinearAuctionLiquidatorContract,
  OracleWhiteListContract,
  PerformanceFeeCalculatorContract,
  SetTokenFactoryContract,
  StandardTokenMockContract,
  RebalancingSetTokenV3FactoryContract,
  TransferProxyContract,
  WethMockContract,
  WhiteListContract,
} from 'set-protocol-contracts';
import {
  LegacyMakerOracleAdapterContract,
  MedianContract,
  OracleProxyContract,
} from 'set-protocol-oracles';
import {
  SocialAllocatorContract,
  SocialTradingManagerV2Contract,
} from '@utils/contracts';

import {
  ONE_DAY_IN_SECONDS,
  ONE_HOUR_IN_SECONDS,
  UNLIMITED_ALLOWANCE_IN_BASE_UNITS,
  WBTC_DECIMALS,
  ZERO,
} from '@utils/constants';

import { expectRevertError } from '@utils/tokenAssertions';
import { extractNewSetTokenAddressFromLogs } from '@utils/contract_logs/core';
import { getWeb3 } from '@utils/web3Helper';

import {
  CoreHelper,
  FeeCalculatorHelper,
  LiquidatorHelper,
  RebalancingSetV3Helper,
  ValuationHelper
} from 'set-protocol-contracts';
import { ERC20Helper as ERC20Contracts } from 'set-protocol-contracts';
import { OracleHelper } from 'set-protocol-oracles';
import { ERC20Helper } from '@utils/helpers/erc20Helper';
import { ManagerHelper } from '@utils/helpers/managerHelper';
import { ProtocolHelper } from '@utils/helpers/protocolHelper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const SocialTradingManager = artifacts.require('SocialTradingManager');
const { SetProtocolUtils: SetUtils } = setProtocolUtils;
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;
const setTestUtils = new SetTestUtils(web3);

contract('SocialTradingManagerV2', accounts => {
  const [
    deployerAccount,
    feeRecipient,
    newLiquidator,
    newAllocator,
    attackerAccount,
  ] = accounts;

  let core: CoreContract;
  let transferProxy: TransferProxyContract;
  let factory: SetTokenFactoryContract;
  let rebalancingComponentWhiteList: WhiteListContract;
  let wrappedBTC: StandardTokenMockContract;
  let wrappedETH: WethMockContract;

  let liquidator: LinearAuctionLiquidatorContract;
  let feeCalculator: PerformanceFeeCalculatorContract;
  let rebalancingFactory: RebalancingSetTokenV3FactoryContract;
  let oracleWhiteList: OracleWhiteListContract;
  let liquidatorWhiteList: WhiteListContract;
  let feeCalculatorWhiteList: WhiteListContract;

  let ethMedianizer: MedianContract;
  let ethLegacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let ethOracleProxy: OracleProxyContract;

  let btcMedianizer: MedianContract;
  let btcLegacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let btcOracleProxy: OracleProxyContract;

  let allocator: SocialAllocatorContract;

  let initialEthPrice: BigNumber;
  let initialBtcPrice: BigNumber;

  let setManager: SocialTradingManagerV2Contract;

  const protocolHelper = new ProtocolHelper(deployerAccount);
  const erc20Helper = new ERC20Helper(deployerAccount);
  const managerHelper = new ManagerHelper(deployerAccount);
  const oracleHelper = new OracleHelper(deployerAccount);

  const coreHelper = new CoreHelper(deployerAccount, deployerAccount);
  const feeCalculatorHelper = new FeeCalculatorHelper(deployerAccount);
  const ercContracts = new ERC20Contracts(deployerAccount);
  const valuationHelper = new ValuationHelper(deployerAccount, coreHelper, ercContracts, oracleHelper);
  const liquidatorHelper = new LiquidatorHelper(deployerAccount, ercContracts, valuationHelper);
  const v3Helper = new RebalancingSetV3Helper(deployerAccount, coreHelper, ercContracts, blockchain);

  before(async () => {
    ABIDecoder.addABI(Core.abi);
    ABIDecoder.addABI(SocialTradingManager.abi);
  });

  after(async () => {
    ABIDecoder.removeABI(Core.abi);
    ABIDecoder.removeABI(SocialTradingManager.abi);
  });

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    transferProxy = await protocolHelper.getDeployedTransferProxyAsync();
    core = await protocolHelper.getDeployedCoreAsync();

    factory = await protocolHelper.getDeployedSetTokenFactoryAsync();
    rebalancingComponentWhiteList = await protocolHelper.getDeployedWhiteList();

    ethMedianizer = await protocolHelper.getDeployedWETHMedianizerAsync();
    await oracleHelper.addPriceFeedOwnerToMedianizer(ethMedianizer, deployerAccount);

    btcMedianizer = await oracleHelper.deployMedianizerAsync();
    await oracleHelper.addPriceFeedOwnerToMedianizer(btcMedianizer, deployerAccount);

    initialEthPrice = ether(180);
    await oracleHelper.updateMedianizerPriceAsync(
      ethMedianizer,
      initialEthPrice,
      SetTestUtils.generateTimestamp(1000),
    );

    initialBtcPrice = ether(9000);
    await oracleHelper.updateMedianizerPriceAsync(
      btcMedianizer,
      initialBtcPrice,
      SetTestUtils.generateTimestamp(1000),
    );

    wrappedETH = await protocolHelper.getDeployedWETHAsync();
    wrappedBTC = await erc20Helper.deployTokenAsync(deployerAccount, WBTC_DECIMALS);
    await protocolHelper.addTokenToWhiteList(wrappedBTC.address, rebalancingComponentWhiteList);
    await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS.mul(7));
    await protocolHelper.addTokenToWhiteList(wrappedBTC.address, rebalancingComponentWhiteList);

    ethLegacyMakerOracleAdapter = await oracleHelper.deployLegacyMakerOracleAdapterAsync(
      ethMedianizer.address,
    );

    ethOracleProxy = await oracleHelper.deployOracleProxyAsync(
      ethLegacyMakerOracleAdapter.address,
    );

    btcLegacyMakerOracleAdapter = await oracleHelper.deployLegacyMakerOracleAdapterAsync(
      btcMedianizer.address,
    );

    btcOracleProxy = await oracleHelper.deployOracleProxyAsync(
      btcLegacyMakerOracleAdapter.address,
    );

    oracleWhiteList = await coreHelper.deployOracleWhiteListAsync(
      [wrappedETH.address, wrappedBTC.address],
      [ethOracleProxy.address, btcOracleProxy.address],
    );

    liquidator = await liquidatorHelper.deployLinearAuctionLiquidatorAsync(
      core.address,
      oracleWhiteList.address,
      ONE_HOUR_IN_SECONDS.mul(4),
      new BigNumber(3),
      new BigNumber(21),
      'LinearAuctionLiquidator'
    );
    liquidatorWhiteList = await coreHelper.deployWhiteListAsync([liquidator.address, newLiquidator]);

    feeCalculator = await feeCalculatorHelper.deployPerformanceFeeCalculatorAsync(
      core.address,
      oracleWhiteList.address,
      ether(.4),
      ether(.05)
    );
    feeCalculatorWhiteList = await coreHelper.deployWhiteListAsync([feeCalculator.address]);

    rebalancingFactory = await coreHelper.deployRebalancingSetTokenV3FactoryAsync(
      core.address,
      rebalancingComponentWhiteList.address,
      liquidatorWhiteList.address,
      feeCalculatorWhiteList.address,
    );

    await core.addFactory.sendTransactionAsync(rebalancingFactory.address, { from: deployerAccount });
    await blockchain.increaseTimeAsync(new BigNumber(2));
    await core.addFactory.sendTransactionAsync(rebalancingFactory.address, { from: deployerAccount });

    await erc20Helper.approveTransfersAsync(
      [wrappedBTC, wrappedETH],
      transferProxy.address
    );

    allocator = await managerHelper.deploySocialAllocatorAsync(
      wrappedETH.address,
      wrappedBTC.address,
      oracleWhiteList.address,
      core.address,
      factory.address,
    );

    await oracleHelper.addAuthorizedAddressesToOracleProxy(
      ethOracleProxy,
      [allocator.address, liquidator.address, feeCalculator.address]
    );

    await oracleHelper.addAuthorizedAddressesToOracleProxy(
      btcOracleProxy,
      [allocator.address, liquidator.address, feeCalculator.address]
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectCore: Address;
    let subjectFactory: Address;
    let subjectWhiteListedAllocators: Address[];
    let subjectMaxEntryFee: BigNumber;
    let subjectFeeUpdateTimelock: BigNumber;
    let subjectCaller: Address;

    beforeEach(async () => {
      subjectCore = core.address;
      subjectFactory = rebalancingFactory.address;
      subjectWhiteListedAllocators = [allocator.address, newAllocator];
      subjectMaxEntryFee = ether(.1);
      subjectFeeUpdateTimelock = ONE_DAY_IN_SECONDS;
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<SocialTradingManagerV2Contract> {
      return managerHelper.deploySocialTradingManagerV2Async(
        subjectCore,
        subjectFactory,
        subjectWhiteListedAllocators,
        subjectMaxEntryFee,
        subjectFeeUpdateTimelock,
        subjectCaller,
      );
    }

    it('sets the correct core address', async () => {
      setManager = await subject();

      const actualCore = await setManager.core.callAsync();

      expect(actualCore).to.equal(subjectCore);
    });

    it('sets the correct factory address', async () => {
      setManager = await subject();

      const actualFactory = await setManager.factory.callAsync();

      expect(actualFactory).to.equal(subjectFactory);
    });

    it('added allocators to the WhiteList', async () => {
      setManager = await subject();

      const actualWhiteListedAllocators = await setManager.validAddresses.callAsync();

      expect(JSON.stringify(actualWhiteListedAllocators)).to.equal(JSON.stringify(subjectWhiteListedAllocators));
    });

    it('sets the correct maxEntryFee', async () => {
      setManager = await subject();

      const actualMaxEntryFee = await setManager.maxEntryFee.callAsync();

      expect(actualMaxEntryFee).to.be.bignumber.equal(subjectMaxEntryFee);
    });

    it('sets the correct feeUpdateTimelock', async () => {
      setManager = await subject();

      const actualFeeUpdateTimelock = await setManager.feeUpdateTimelock.callAsync();

      expect(actualFeeUpdateTimelock).to.be.bignumber.equal(subjectFeeUpdateTimelock);
    });
  });

  describe('#adjustFee', async () => {
    let subjectPoolAddress: Address;
    let subjectNewFeeCallData: string;
    let subjectCaller: Address;

    let feeType: BigNumber;
    let newFeePercentage: BigNumber;

    before(async () => {
      feeType = ZERO;
      newFeePercentage = ether(.03);
    });

    beforeEach(async () => {
      setManager = await managerHelper.deploySocialTradingManagerV2Async(
        core.address,
        rebalancingFactory.address,
        [allocator.address]
      );

      await setManager.setTimeLockPeriod.sendTransactionAsync(ONE_DAY_IN_SECONDS, { from: deployerAccount });

      const callDataManagerAddress = setManager.address;
      const callDataLiquidator = liquidator.address;
      const callDataFeeRecipient = feeRecipient;
      const callDataRebalanceFeeCalculator = feeCalculator.address;
      const callDataRebalanceInterval = ONE_DAY_IN_SECONDS;
      const callDataFailAuctionPeriod = ONE_DAY_IN_SECONDS;
      const { timestamp } = await web3.eth.getBlock('latest');
      const callDataLastRebalanceTimestamp = timestamp;
      const callDataEntryFee = ZERO;

      const profitFeePeriod = ONE_DAY_IN_SECONDS.mul(30);
      const highWatermarkResetPeriod = ONE_DAY_IN_SECONDS.mul(365);
      const profitFeePercentage = ether(.2);
      const streamingFeePercentage = ether(.02);
      const callDataRebalanceFeeCallData = feeCalculatorHelper.generatePerformanceFeeCallDataBuffer(
        profitFeePeriod,
        highWatermarkResetPeriod,
        profitFeePercentage,
        streamingFeePercentage
      );
      const poolRebalancingSetCallData = v3Helper.generateRebalancingSetTokenV3CallData(
        callDataManagerAddress,
        callDataLiquidator,
        callDataFeeRecipient,
        callDataRebalanceFeeCalculator,
        callDataRebalanceInterval,
        callDataFailAuctionPeriod,
        callDataLastRebalanceTimestamp,
        callDataEntryFee,
        callDataRebalanceFeeCallData,
      );

      const poolAllocator = allocator.address;
      const poolStartingBaseAssetAllocation = ether(1);
      const poolStartingValue = ether(100);
      const poolName = 'TestSet';
      const poolSymbol = 'TEST';
      const poolCaller = deployerAccount;
      const txHash = await setManager.createTradingPool.sendTransactionAsync(
        poolAllocator,
        poolStartingBaseAssetAllocation,
        poolStartingValue,
        SetUtils.stringToBytes(poolName),
        SetUtils.stringToBytes(poolSymbol),
        poolRebalancingSetCallData,
        { from: poolCaller }
      );

      const logs = await setTestUtils.getLogsFromTxHash(txHash);
      subjectPoolAddress = extractNewSetTokenAddressFromLogs(logs, 2);
      subjectNewFeeCallData = feeCalculatorHelper.generateAdjustFeeCallData(feeType, newFeePercentage);
      subjectCaller = deployerAccount;

      const collateralAddress = extractNewSetTokenAddressFromLogs(logs, 3);
      const collateralInstance = await protocolHelper.getSetTokenAsync(collateralAddress);
      await collateralInstance.approve.sendTransactionAsync(
        transferProxy.address,
        UNLIMITED_ALLOWANCE_IN_BASE_UNITS,
        { from: deployerAccount }
      );

      await core.issue.sendTransactionAsync(collateralAddress, ether(2), { from: subjectCaller });
      await core.issue.sendTransactionAsync(subjectPoolAddress, ether(2), { from: subjectCaller });
    });

    async function subject(): Promise<string> {
      return setManager.adjustFee.sendTransactionAsync(
        subjectPoolAddress,
        subjectNewFeeCallData,
        { from: subjectCaller }
      );
    }

    it('sets the upgradeHash', async () => {
      const txHash = await subject();
      const { blockHash, input } = await web3.eth.getTransaction(txHash);
      const { timestamp } = await web3.eth.getBlock(blockHash);

      const upgradeHash = web3.utils.soliditySha3(input);
      const actualTimestamp = await setManager.timeLockedUpgrades.callAsync(upgradeHash);
      expect(actualTimestamp).to.bignumber.equal(timestamp);
    });

    describe('when called to confirm set streaming fee txn', async () => {
      beforeEach(async () => {
        await subject();

        await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS);
        await blockchain.mineBlockAsync();
      });

      it('sets the streaming fee percentage correctly', async () => {
        await subject();

        const feeState: any = await feeCalculator.feeState.callAsync(subjectPoolAddress);
        expect(feeState.streamingFeePercentage).to.be.bignumber.equal(newFeePercentage);
      });
    });

    describe('when called to confirm set profit fee txn', async () => {
      before(async () => {
        feeType = new BigNumber(1);
        newFeePercentage = ether(.25);
      });

      after(async () => {
        feeType = ZERO;
        newFeePercentage = ether(.03);
      });

      beforeEach(async () => {
        await subject();

        await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS);
        await blockchain.mineBlockAsync();
      });

      it('sets the profit fee percentage correctly', async () => {
        await subject();

        const feeState: any = await feeCalculator.feeState.callAsync(subjectPoolAddress);
        expect(feeState.profitFeePercentage).to.be.bignumber.equal(newFeePercentage);
      });
    });

    describe('when caller is not trader', async () => {
      beforeEach(async () => {
        subjectCaller = attackerAccount;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#removeRegisteredUpgrade', async () => {
    let subjectPoolAddress: Address;
    let subjectUpgradeHash: string;
    let subjectCaller: Address;

    let feeType: BigNumber;
    let newFeePercentage: BigNumber;

    before(async () => {
      feeType = ZERO;
      newFeePercentage = ether(.03);
    });

    beforeEach(async () => {
      setManager = await managerHelper.deploySocialTradingManagerV2Async(
        core.address,
        rebalancingFactory.address,
        [allocator.address]
      );

      await setManager.setTimeLockPeriod.sendTransactionAsync(ONE_DAY_IN_SECONDS, { from: deployerAccount });

      const callDataManagerAddress = setManager.address;
      const callDataLiquidator = liquidator.address;
      const callDataFeeRecipient = feeRecipient;
      const callDataRebalanceFeeCalculator = feeCalculator.address;
      const callDataRebalanceInterval = ONE_DAY_IN_SECONDS;
      const callDataFailAuctionPeriod = ONE_DAY_IN_SECONDS;
      const { timestamp } = await web3.eth.getBlock('latest');
      const callDataLastRebalanceTimestamp = timestamp;
      const callDataEntryFee = ZERO;

      const profitFeePeriod = ONE_DAY_IN_SECONDS.mul(30);
      const highWatermarkResetPeriod = ONE_DAY_IN_SECONDS.mul(365);
      const profitFeePercentage = ether(.2);
      const streamingFeePercentage = ether(.02);
      const callDataRebalanceFeeCallData = feeCalculatorHelper.generatePerformanceFeeCallDataBuffer(
        profitFeePeriod,
        highWatermarkResetPeriod,
        profitFeePercentage,
        streamingFeePercentage
      );
      const poolRebalancingSetCallData = v3Helper.generateRebalancingSetTokenV3CallData(
        callDataManagerAddress,
        callDataLiquidator,
        callDataFeeRecipient,
        callDataRebalanceFeeCalculator,
        callDataRebalanceInterval,
        callDataFailAuctionPeriod,
        callDataLastRebalanceTimestamp,
        callDataEntryFee,
        callDataRebalanceFeeCallData,
      );

      const poolAllocator = allocator.address;
      const poolStartingBaseAssetAllocation = ether(1);
      const poolStartingValue = ether(100);
      const poolName = 'TestSet';
      const poolSymbol = 'TEST';
      const poolCaller = deployerAccount;
      const txHash = await setManager.createTradingPool.sendTransactionAsync(
        poolAllocator,
        poolStartingBaseAssetAllocation,
        poolStartingValue,
        SetUtils.stringToBytes(poolName),
        SetUtils.stringToBytes(poolSymbol),
        poolRebalancingSetCallData,
        { from: poolCaller }
      );

      const logs = await setTestUtils.getLogsFromTxHash(txHash);
      const poolAddress = extractNewSetTokenAddressFromLogs(logs, 2);
      const newFeeCallData = feeCalculatorHelper.generateAdjustFeeCallData(feeType, newFeePercentage);
      subjectPoolAddress = extractNewSetTokenAddressFromLogs(logs, 2);
      subjectCaller = deployerAccount;

      const adjustTxHash = await setManager.adjustFee.sendTransactionAsync(
        poolAddress,
        newFeeCallData,
        { from: subjectCaller }
      );

      const { input } = await web3.eth.getTransaction(adjustTxHash);

      subjectUpgradeHash = web3.utils.soliditySha3(input);
    });

    async function subject(): Promise<string> {
      return setManager.removeRegisteredUpgrade.sendTransactionAsync(
        subjectPoolAddress,
        subjectUpgradeHash,
        { from: subjectCaller }
      );
    }

    it('sets the upgradeHash to 0', async () => {
      await subject();

      const actualTimestamp = await setManager.timeLockedUpgrades.callAsync(subjectUpgradeHash);
      expect(actualTimestamp).to.bignumber.equal(ZERO);
    });

    describe('when the hash specified is not registered', async () => {
      beforeEach(async () => {
        subjectUpgradeHash = web3.utils.soliditySha3(5);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('when caller is not trader', async () => {
      beforeEach(async () => {
        subjectCaller = attackerAccount;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });
});