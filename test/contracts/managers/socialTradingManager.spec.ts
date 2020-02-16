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
  FixedFeeCalculatorContract,
  LinearAuctionLiquidatorContract,
  OracleWhiteListContract,
  SetTokenFactoryContract,
  StandardTokenMockContract,
  RebalancingSetTokenV2FactoryContract,
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
  SocialTradingManagerContract,
} from '@utils/contracts';

import {
  DEFAULT_REBALANCING_NATURAL_UNIT,
  ETH_DECIMALS,
  ONE_DAY_IN_SECONDS,
  UNLIMITED_ALLOWANCE_IN_BASE_UNITS,
  WBTC_DECIMALS,
  ZERO
} from '@utils/constants';

import { expectRevertError } from '@utils/tokenAssertions';
import { extractNewSetTokenAddressFromLogs } from '@utils/contract_logs/core';
import {
  LogAllocationUpdate,
  LogNewTrader,
  LogTradingPoolCreated
} from '@utils/contract_logs/socialTradingManager';
import { getWeb3 } from '@utils/web3Helper';

import { ERC20Helper } from '@utils/helpers/erc20Helper';
import { ManagerHelper } from '@utils/helpers/managerHelper';
import { OracleHelper } from '@utils/helpers/oracleHelper';
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

contract('SocialTradingManager', accounts => {
  const [
    deployerAccount,
    feeRecipient,
    newTrader,
    newLiquidator,
    liquidatorData,
    attacker,
    newAllocator,
  ] = accounts;

  let core: CoreContract;
  let transferProxy: TransferProxyContract;
  let factory: SetTokenFactoryContract;
  let rebalancingComponentWhiteList: WhiteListContract;
  let wrappedBTC: StandardTokenMockContract;
  let wrappedETH: WethMockContract;

  let liquidator: LinearAuctionLiquidatorContract;
  let feeCalculator: FixedFeeCalculatorContract;
  let rebalancingFactory: RebalancingSetTokenV2FactoryContract;
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

  let setManager: SocialTradingManagerContract;

  const protocolHelper = new ProtocolHelper(deployerAccount);
  const erc20Helper = new ERC20Helper(deployerAccount);
  const managerHelper = new ManagerHelper(deployerAccount);
  const oracleHelper = new OracleHelper(deployerAccount);

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

    oracleWhiteList = await protocolHelper.deployOracleWhiteListAsync(
      [wrappedETH.address, wrappedBTC.address],
      [ethOracleProxy.address, btcOracleProxy.address],
    );

    liquidator = await protocolHelper.deployLinearLiquidatorAsync(
      core.address,
      oracleWhiteList.address
    );
    liquidatorWhiteList = await protocolHelper.deployWhiteListAsync([liquidator.address, newLiquidator]);

    feeCalculator = await protocolHelper.deployFixedFeeCalculatorAsync();
    feeCalculatorWhiteList = await protocolHelper.deployWhiteListAsync([feeCalculator.address]);

    rebalancingFactory = await protocolHelper.deployRebalancingSetTokenV2FactoryAsync(
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
      [allocator.address, liquidator.address]
    );

    await oracleHelper.addAuthorizedAddressesToOracleProxy(
      btcOracleProxy,
      [allocator.address, liquidator.address]
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

    async function subject(): Promise<SocialTradingManagerContract> {
      return managerHelper.deploySocialTradingManagerAsync(
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

  describe('#createTradingPool', async () => {
    let subjectAllocator: Address;
    let subjectStartingBaseAssetAllocation: BigNumber;
    let subjectStartingValue: BigNumber;
    let subjectName: string;
    let subjectSymbol: string;
    let subjectRebalancingSetCallData: string;
    let subjectCaller: Address;

    let callDataManagerAddress: Address;
    let callDataLiquidator: Address;
    let callDataFeeRecipient: Address;
    let callDataRebalanceFeeCalculator: Address;
    let callDataRebalanceInterval: BigNumber;
    let callDataFailAuctionPeriod: BigNumber;
    let callDataLastRebalanceTimestamp: BigNumber;
    let callDataEntryFee: BigNumber;
    let callDataRebalanceFee: BigNumber;

    let customManagerAddress: Address = undefined;

    beforeEach(async () => {
      setManager = await managerHelper.deploySocialTradingManagerAsync(
        core.address,
        rebalancingFactory.address,
        [allocator.address]
      );

      callDataManagerAddress = customManagerAddress || setManager.address;
      callDataLiquidator = liquidator.address;
      callDataFeeRecipient = feeRecipient;
      callDataRebalanceFeeCalculator = feeCalculator.address;
      callDataRebalanceInterval = ONE_DAY_IN_SECONDS;
      callDataFailAuctionPeriod = ONE_DAY_IN_SECONDS;
      const { timestamp } = await web3.eth.getBlock('latest');
      callDataLastRebalanceTimestamp = timestamp;
      callDataEntryFee = ether(.01);
      callDataRebalanceFee = ether(.02);
      const callDataRebalanceFeeCallData = SetUtils.generateFixedFeeCalculatorCalldata(callDataRebalanceFee);
      subjectRebalancingSetCallData = SetUtils.generateRebalancingSetTokenV2CallData(
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

      subjectAllocator = allocator.address;
      subjectStartingBaseAssetAllocation = ether(1);
      subjectStartingValue = ether(100);
      subjectName = 'TestSet';
      subjectSymbol = 'TEST';
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      return setManager.createTradingPool.sendTransactionAsync(
        subjectAllocator,
        subjectStartingBaseAssetAllocation,
        subjectStartingValue,
        SetUtils.stringToBytes(subjectName),
        SetUtils.stringToBytes(subjectSymbol),
        subjectRebalancingSetCallData,
        { from: subjectCaller }
      );
    }

    it('sets the correct pool info', async () => {
      const txHash = await subject();

      const logs = await setTestUtils.getLogsFromTxHash(txHash);
      const poolAddress = extractNewSetTokenAddressFromLogs(logs, 2);

      const poolInfo: any = await setManager.pools.callAsync(poolAddress);

      expect(poolInfo.trader).to.equal(subjectCaller);
      expect(poolInfo.allocator).to.equal(subjectAllocator);
      expect(poolInfo.currentAllocation).to.be.bignumber.equal(subjectStartingBaseAssetAllocation);
      expect(poolInfo.feeUpdateTimestamp).to.be.bignumber.equal(ZERO);
    });

    it('emits the correct TradingPoolCreated log', async () => {
      const txHash = await subject();

      const formattedLogs = await setTestUtils.getLogsFromTxHash(txHash);
      const poolAddress = extractNewSetTokenAddressFromLogs(formattedLogs, 2);

      const expectedLogs = LogTradingPoolCreated(
        subjectCaller,
        subjectAllocator,
        poolAddress,
        subjectStartingBaseAssetAllocation,
        setManager.address
      );

      await SetTestUtils.assertLogEquivalence(formattedLogs, expectedLogs);
    });

    it('created pool has correct collateral set', async () => {
      const txHash = await subject();

      const logs = await setTestUtils.getLogsFromTxHash(txHash);
      const poolAddress = extractNewSetTokenAddressFromLogs(logs, 2);
      const collateralAddress = extractNewSetTokenAddressFromLogs(logs, 3);

      const poolInstance = await protocolHelper.getRebalancingSetTokenV2Async(poolAddress);
      const actualCollateralSet = await poolInstance.getComponents.callAsync();

      expect(actualCollateralSet[0]).to.equal(collateralAddress);
    });

    it('created pool has correct unitShares', async () => {
      const txHash = await subject();

      const logs = await setTestUtils.getLogsFromTxHash(txHash);
      const poolAddress = extractNewSetTokenAddressFromLogs(logs, 2);
      const collateralAddress = extractNewSetTokenAddressFromLogs(logs, 3);
      const collateralInstance = await protocolHelper.getSetTokenAsync(collateralAddress);
      const collateralValue = await await managerHelper.calculateSetTokenValue(
        collateralInstance,
        [initialEthPrice, initialBtcPrice],
        [ETH_DECIMALS, new BigNumber(10 ** WBTC_DECIMALS)]
      );

      const expectedUnitShares = subjectStartingValue
        .mul(DEFAULT_REBALANCING_NATURAL_UNIT)
        .div(collateralValue).round(0, 3);

      const poolInstance = await protocolHelper.getRebalancingSetTokenV2Async(poolAddress);
      const actualUnitShares = await poolInstance.getUnits.callAsync();

      expect(actualUnitShares[0]).to.be.bignumber.equal(expectedUnitShares);
    });

    it('created pool has correct naturalUnit', async () => {
      const txHash = await subject();

      const logs = await setTestUtils.getLogsFromTxHash(txHash);
      const poolAddress = extractNewSetTokenAddressFromLogs(logs, 2);
      const poolInstance = await protocolHelper.getRebalancingSetTokenV2Async(poolAddress);

      const actualNaturalUnit = await poolInstance.naturalUnit.callAsync();

      expect(actualNaturalUnit).to.be.bignumber.equal(DEFAULT_REBALANCING_NATURAL_UNIT);
    });

    it('created pool has correct name', async () => {
      const txHash = await subject();

      const logs = await setTestUtils.getLogsFromTxHash(txHash);
      const poolAddress = extractNewSetTokenAddressFromLogs(logs, 2);

      const poolInstance = await protocolHelper.getRebalancingSetTokenV2Async(poolAddress);
      const actualName = await poolInstance.name.callAsync();

      expect(actualName).to.equal(subjectName);
    });

    it('created pool has correct symbol', async () => {
      const txHash = await subject();

      const logs = await setTestUtils.getLogsFromTxHash(txHash);
      const poolAddress = extractNewSetTokenAddressFromLogs(logs, 2);

      const poolInstance = await protocolHelper.getRebalancingSetTokenV2Async(poolAddress);
      const actualSymbol = await poolInstance.symbol.callAsync();

      expect(actualSymbol).to.equal(subjectSymbol);
    });

    it('created pool has correct call data params', async () => {
      const txHash = await subject();

      const logs = await setTestUtils.getLogsFromTxHash(txHash);
      const poolAddress = extractNewSetTokenAddressFromLogs(logs, 2);

      const poolInstance = await protocolHelper.getRebalancingSetTokenV2Async(poolAddress);

      const actualManager = await poolInstance.manager.callAsync();
      const actualLiquidator = await poolInstance.liquidator.callAsync();
      const actualFeeRecipient = await poolInstance.feeRecipient.callAsync();
      const actualRebalanceInterval = await poolInstance.rebalanceInterval.callAsync();
      const actualFailAuctionPeriod = await poolInstance.rebalanceFailPeriod.callAsync();
      const actualLastRebalanceTimestamp = await poolInstance.lastRebalanceTimestamp.callAsync();
      const actualEntryFee = await poolInstance.entryFee.callAsync();
      const actualRebalanceFee = await poolInstance.rebalanceFee.callAsync();

      expect(actualManager).to.equal(callDataManagerAddress);
      expect(actualLiquidator).to.equal(callDataLiquidator);
      expect(actualFeeRecipient).to.equal(callDataFeeRecipient);
      expect(actualRebalanceInterval).to.be.bignumber.equal(callDataRebalanceInterval);
      expect(actualFailAuctionPeriod).to.be.bignumber.equal(callDataFailAuctionPeriod);
      expect(actualLastRebalanceTimestamp).to.be.bignumber.equal(callDataLastRebalanceTimestamp);
      expect(actualEntryFee).to.be.bignumber.equal(callDataEntryFee);
      expect(actualRebalanceFee).to.be.bignumber.equal(callDataRebalanceFee);
    });

    describe('but passed starting allocation is greater than 100%', async () => {
      beforeEach(async () => {
        subjectStartingBaseAssetAllocation = ether(2);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('but passed starting allocation is less than 1%', async () => {
      beforeEach(async () => {
        subjectStartingBaseAssetAllocation = ether(.009);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('but passed allocator address is not WhiteListed', async () => {
      beforeEach(async () => {
        subjectAllocator = attacker;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('but passed manager address is not SocialTradingManager', async () => {
      before(async () => {
        customManagerAddress = attacker;
      });

      after(async () => {
        customManagerAddress = undefined;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#updateAllocation', async () => {
    let subjectTradingPool: Address;
    let subjectNewAllocation: BigNumber;
    let subjectLiquidatorData: string;
    let subjectTimeIncrease: BigNumber;
    let subjectCaller: Address;

    let startingBaseAssetAllocation: BigNumber;
    let customStartingBaseAssetAllocation: BigNumber;

    beforeEach(async () => {
      setManager = await managerHelper.deploySocialTradingManagerAsync(
        core.address,
        rebalancingFactory.address,
        [allocator.address]
      );

      const callDataManagerAddress = setManager.address;
      const callDataLiquidator = liquidator.address;
      const callDataFeeRecipient = feeRecipient;
      const callDataFeeCalculator = feeCalculator.address;
      const callDataRebalanceInterval = ONE_DAY_IN_SECONDS;
      const callDataFailAuctionPeriod = ONE_DAY_IN_SECONDS;
      const { timestamp } = await web3.eth.getBlock('latest');
      const callDataLastRebalanceTimestamp = timestamp;
      const callDataEntryFee = ether(.01);
      const rebalanceFee = ether(.02);
      const callDataRebalanceFeeCallData = SetUtils.generateFixedFeeCalculatorCalldata(rebalanceFee);
      const rebalancingSetCallData = SetUtils.generateRebalancingSetTokenV2CallData(
        callDataManagerAddress,
        callDataLiquidator,
        callDataFeeRecipient,
        callDataFeeCalculator,
        callDataRebalanceInterval,
        callDataFailAuctionPeriod,
        callDataLastRebalanceTimestamp,
        callDataEntryFee,
        callDataRebalanceFeeCallData,
      );

      const usedAlocator = allocator.address;
      startingBaseAssetAllocation = customStartingBaseAssetAllocation || ether(1);
      const startingValue = ether(100);
      const name = 'TestSet';
      const symbol = 'TEST';

      const txHash = await setManager.createTradingPool.sendTransactionAsync(
        usedAlocator,
        startingBaseAssetAllocation,
        startingValue,
        SetUtils.stringToBytes(name),
        SetUtils.stringToBytes(symbol),
        rebalancingSetCallData,
        { from: deployerAccount }
      );

      const logs = await setTestUtils.getLogsFromTxHash(txHash);
      subjectTradingPool = extractNewSetTokenAddressFromLogs(logs, 2);
      subjectNewAllocation = ether(.20);
      subjectLiquidatorData = liquidatorData;
      subjectCaller = deployerAccount;
      subjectTimeIncrease = ONE_DAY_IN_SECONDS;

      const collateralAddress = extractNewSetTokenAddressFromLogs(logs, 3);
      const collateralInstance = await protocolHelper.getSetTokenAsync(collateralAddress);
      await collateralInstance.approve.sendTransactionAsync(
        transferProxy.address,
        UNLIMITED_ALLOWANCE_IN_BASE_UNITS,
        { from: deployerAccount }
      );

      await core.issue.sendTransactionAsync(collateralAddress, ether(2), { from: subjectCaller });
      await core.issue.sendTransactionAsync(subjectTradingPool, ether(2), { from: subjectCaller });
    });

    async function subject(): Promise<string> {
      blockchain.increaseTimeAsync(subjectTimeIncrease);
      return setManager.updateAllocation.sendTransactionAsync(
        subjectTradingPool,
        subjectNewAllocation,
        subjectLiquidatorData,
        { from: subjectCaller }
      );
    }

    it('sets the correct current allocation', async () => {
      await subject();

      const poolInfo = await setManager.pools.callAsync(subjectTradingPool);

      expect(poolInfo['currentAllocation']).to.be.bignumber.equal(subjectNewAllocation);
    });

    it('passes the correct nextSet', async () => {
      const txHash = await subject();
      const logs = await setTestUtils.getLogsFromTxHash(txHash);
      const collateralAddress = extractNewSetTokenAddressFromLogs(logs, 3);

      const poolInstance = await protocolHelper.getRebalancingSetTokenV2Async(subjectTradingPool);
      const actualNextSet = await poolInstance.nextSet.callAsync();

      expect(actualNextSet).to.equal(collateralAddress);
    });

    it('emits the correct AllocationUpdate log', async () => {
      const txHash = await subject();

      const formattedLogs = await setTestUtils.getLogsFromTxHash(txHash);

      const expectedLogs = LogAllocationUpdate(
        subjectTradingPool,
        startingBaseAssetAllocation,
        subjectNewAllocation,
        setManager.address
      );

      await SetTestUtils.assertLogEquivalence(formattedLogs, expectedLogs);
    });

    describe('but passed new allocation is greater than 100%', async () => {
      beforeEach(async () => {
        subjectNewAllocation = ZERO;
      });

      it('sets the correct current allocation', async () => {
        await subject();

        const poolInfo = await setManager.pools.callAsync(subjectTradingPool);

        expect(poolInfo['currentAllocation']).to.be.bignumber.equal(subjectNewAllocation);
      });

      it('passes the correct nextSet', async () => {
        const txHash = await subject();
        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const collateralAddress = extractNewSetTokenAddressFromLogs(logs, 3);

        const poolInstance = await protocolHelper.getRebalancingSetTokenV2Async(subjectTradingPool);
        const actualNextSet = await poolInstance.nextSet.callAsync();

        expect(actualNextSet).to.equal(collateralAddress);
      });

      it('emits the correct AllocationUpdate log', async () => {
        const txHash = await subject();

        const formattedLogs = await setTestUtils.getLogsFromTxHash(txHash);

        const expectedLogs = LogAllocationUpdate(
          subjectTradingPool,
          startingBaseAssetAllocation,
          subjectNewAllocation,
          setManager.address
        );

        await SetTestUtils.assertLogEquivalence(formattedLogs, expectedLogs);
      });
    });

    describe('but caller is not trader', async () => {
      beforeEach(async () => {
        subjectCaller = attacker;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('but passed new allocation is greater than 100%', async () => {
      beforeEach(async () => {
        subjectNewAllocation = ether(2);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('but passed starting allocation is less than 1%', async () => {
      beforeEach(async () => {
        subjectNewAllocation = ether(.009);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('but the update allocation is also 100%', async () => {
      beforeEach(async () => {
        subjectNewAllocation = ether(1);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('but the start allocation is 0% and new allocation is 0%', async () => {
      beforeEach(async () => {
        subjectNewAllocation = ZERO;
      });

      before(async () => {
        customStartingBaseAssetAllocation = ZERO;
      });

      after(async () => {
        customStartingBaseAssetAllocation = undefined;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('but passed starting allocation is not multiple of 1%', async () => {
      beforeEach(async () => {
        subjectNewAllocation = ether(.019);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('but rebalanceInterval has not elapsed', async () => {
      beforeEach(async () => {
        subjectTimeIncrease = ZERO;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('but rebalance currently underway', async () => {
      beforeEach(async () => {
        await subject();
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#initiateEntryFeeChange', async () => {
    let subjectTradingPool: Address;
    let subjectNewEntryFee: BigNumber;
    let subjectCaller: Address;

    beforeEach(async () => {
      setManager = await managerHelper.deploySocialTradingManagerAsync(
        core.address,
        rebalancingFactory.address,
        [allocator.address]
      );

      const callDataManagerAddress = setManager.address;
      const callDataLiquidator = liquidator.address;
      const callDataFeeRecipient = feeRecipient;
      const callDataFeeCalculator = feeCalculator.address;
      const callDataRebalanceInterval = ONE_DAY_IN_SECONDS;
      const callDataFailAuctionPeriod = ONE_DAY_IN_SECONDS;
      const { timestamp } = await web3.eth.getBlock('latest');
      const callDataLastRebalanceTimestamp = timestamp;
      const callDataEntryFee = ether(.01);
      const rebalanceFee = ether(.02);
      const callDataRebalanceFeeCallData = SetUtils.generateFixedFeeCalculatorCalldata(rebalanceFee);
      const rebalancingSetCallData = SetUtils.generateRebalancingSetTokenV2CallData(
        callDataManagerAddress,
        callDataLiquidator,
        callDataFeeRecipient,
        callDataFeeCalculator,
        callDataRebalanceInterval,
        callDataFailAuctionPeriod,
        callDataLastRebalanceTimestamp,
        callDataEntryFee,
        callDataRebalanceFeeCallData,
      );

      const usedAlocator = allocator.address;
      const startingBaseAssetAllocation = ether(.66);
      const startingValue = ether(100);
      const name = 'TestSet';
      const symbol = 'TEST';

      const txHash = await setManager.createTradingPool.sendTransactionAsync(
        usedAlocator,
        startingBaseAssetAllocation,
        startingValue,
        SetUtils.stringToBytes(name),
        SetUtils.stringToBytes(symbol),
        rebalancingSetCallData,
        { from: deployerAccount }
      );

      const logs = await setTestUtils.getLogsFromTxHash(txHash);
      subjectTradingPool = extractNewSetTokenAddressFromLogs(logs, 2);
      subjectNewEntryFee = ether(.02);
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      return setManager.initiateEntryFeeChange.sendTransactionAsync(
        subjectTradingPool,
        subjectNewEntryFee,
        { from: subjectCaller }
      );
    }

    it('sets the new entry fee correctly', async () => {
      await subject();

      const poolInfo: any = await setManager.pools.callAsync(subjectTradingPool);

      expect(poolInfo.newEntryFee).to.be.bignumber.equal(subjectNewEntryFee);
    });

    it('sets the correct feeUpdateTimestamp', async () => {
      await subject();
      const { timestamp } = await web3.eth.getBlock('latest');

      const poolInfo: any = await setManager.pools.callAsync(subjectTradingPool);

      const expectedTimestamp = ONE_DAY_IN_SECONDS.add(timestamp);

      expect(poolInfo.feeUpdateTimestamp).to.be.bignumber.equal(expectedTimestamp);
    });

    describe('but caller is not trader', async () => {
      beforeEach(async () => {
        subjectCaller = attacker;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('but new fee exceeds max fee', async () => {
      beforeEach(async () => {
        subjectNewEntryFee = ether(.5);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#finalizeEntryFeeChange', async () => {
    let subjectTradingPool: Address;
    let subjectCaller: Address;
    let subjectTimeFastForward: BigNumber;

    let newEntryFee: BigNumber;
    let initializeFeeChange: boolean = true;

    beforeEach(async () => {
      setManager = await managerHelper.deploySocialTradingManagerAsync(
        core.address,
        rebalancingFactory.address,
        [allocator.address]
      );

      const callDataManagerAddress = setManager.address;
      const callDataLiquidator = liquidator.address;
      const callDataFeeRecipient = feeRecipient;
      const callDataFeeCalculator = feeCalculator.address;
      const callDataRebalanceInterval = ONE_DAY_IN_SECONDS;
      const callDataFailAuctionPeriod = ONE_DAY_IN_SECONDS;
      const { timestamp } = await web3.eth.getBlock('latest');
      const callDataLastRebalanceTimestamp = timestamp;
      const callDataEntryFee = ether(.01);
      const rebalanceFee = ether(.02);
      const callDataRebalanceFeeCallData = SetUtils.generateFixedFeeCalculatorCalldata(rebalanceFee);
      const rebalancingSetCallData = SetUtils.generateRebalancingSetTokenV2CallData(
        callDataManagerAddress,
        callDataLiquidator,
        callDataFeeRecipient,
        callDataFeeCalculator,
        callDataRebalanceInterval,
        callDataFailAuctionPeriod,
        callDataLastRebalanceTimestamp,
        callDataEntryFee,
        callDataRebalanceFeeCallData,
      );

      const usedAlocator = allocator.address;
      const startingBaseAssetAllocation = ether(.66);
      const startingValue = ether(100);
      const name = 'TestSet';
      const symbol = 'TEST';

      const txHash = await setManager.createTradingPool.sendTransactionAsync(
        usedAlocator,
        startingBaseAssetAllocation,
        startingValue,
        SetUtils.stringToBytes(name),
        SetUtils.stringToBytes(symbol),
        rebalancingSetCallData,
        { from: deployerAccount }
      );

      const logs = await setTestUtils.getLogsFromTxHash(txHash);
      subjectTradingPool = extractNewSetTokenAddressFromLogs(logs, 2);
      subjectCaller = deployerAccount;

      if (initializeFeeChange) {
        newEntryFee = ether(.02);
        await setManager.initiateEntryFeeChange.sendTransactionAsync(
          subjectTradingPool,
          newEntryFee,
          { from: subjectCaller }
        );
      }

      subjectTimeFastForward = ONE_DAY_IN_SECONDS;
    });

    async function subject(): Promise<string> {
      await blockchain.increaseTimeAsync(subjectTimeFastForward);
      return setManager.finalizeEntryFeeChange.sendTransactionAsync(
        subjectTradingPool,
        { from: subjectCaller }
      );
    }

    it('sets the new entry fee on RebalancingSetTokenV2', async () => {
      await subject();

      const poolInstance = await protocolHelper.getRebalancingSetTokenV2Async(subjectTradingPool);
      const actualNewEntryFee = await poolInstance.entryFee.callAsync();

      expect(actualNewEntryFee).to.be.bignumber.equal(newEntryFee);
    });

    it('resets the new entry fee in PoolInfo', async () => {
      await subject();

      const poolInfo: any = await setManager.pools.callAsync(subjectTradingPool);

      expect(poolInfo.newEntryFee).to.be.bignumber.equal(ZERO);
    });

    it('resets the feeUpdateTimestamp in PoolInfo', async () => {
      await subject();

      const poolInfo: any = await setManager.pools.callAsync(subjectTradingPool);

      expect(poolInfo.feeUpdateTimestamp).to.be.bignumber.equal(ZERO);
    });

    describe('but caller is not trader', async () => {
      beforeEach(async () => {
        subjectCaller = attacker;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('but not enough time passed in timelock', async () => {
      beforeEach(async () => {
        subjectTimeFastForward = ZERO;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('but initialize was not called first', async () => {
      before(async () => {
        initializeFeeChange = false;
      });

      after(async () => {
        initializeFeeChange = true;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#setTrader', async () => {
    let subjectTradingPool: Address;
    let subjectNewTrader: Address;
    let subjectCaller: Address;

    beforeEach(async () => {
      setManager = await managerHelper.deploySocialTradingManagerAsync(
        core.address,
        rebalancingFactory.address,
        [allocator.address]
      );

      const callDataManagerAddress = setManager.address;
      const callDataLiquidator = liquidator.address;
      const callDataFeeRecipient = feeRecipient;
      const callDataFeeCalculator = feeCalculator.address;
      const callDataRebalanceInterval = ONE_DAY_IN_SECONDS;
      const callDataFailAuctionPeriod = ONE_DAY_IN_SECONDS;
      const { timestamp } = await web3.eth.getBlock('latest');
      const callDataLastRebalanceTimestamp = timestamp;
      const callDataEntryFee = ether(.01);
      const rebalanceFee = ether(.02);
      const callDataRebalanceFeeCallData = SetUtils.generateFixedFeeCalculatorCalldata(rebalanceFee);
      const rebalancingSetCallData = SetUtils.generateRebalancingSetTokenV2CallData(
        callDataManagerAddress,
        callDataLiquidator,
        callDataFeeRecipient,
        callDataFeeCalculator,
        callDataRebalanceInterval,
        callDataFailAuctionPeriod,
        callDataLastRebalanceTimestamp,
        callDataEntryFee,
        callDataRebalanceFeeCallData,
      );

      const usedAlocator = allocator.address;
      const startingBaseAssetAllocation = ether(.66);
      const startingValue = ether(100);
      const name = 'TestSet';
      const symbol = 'TEST';

      const txHash = await setManager.createTradingPool.sendTransactionAsync(
        usedAlocator,
        startingBaseAssetAllocation,
        startingValue,
        SetUtils.stringToBytes(name),
        SetUtils.stringToBytes(symbol),
        rebalancingSetCallData,
        { from: deployerAccount }
      );

      const logs = await setTestUtils.getLogsFromTxHash(txHash);
      subjectTradingPool = extractNewSetTokenAddressFromLogs(logs, 2);
      subjectNewTrader = newTrader;
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      return setManager.setTrader.sendTransactionAsync(
        subjectTradingPool,
        subjectNewTrader,
        { from: subjectCaller }
      );
    }

    it('sets the new trader correctly', async () => {
      await subject();

      const poolInfo = await setManager.pools.callAsync(subjectTradingPool);

      expect(poolInfo['trader']).to.equal(subjectNewTrader);
    });

    it('emits the correct NewTrader log', async () => {
      const txHash = await subject();

      const formattedLogs = await setTestUtils.getLogsFromTxHash(txHash);

      const expectedLogs = LogNewTrader(
        subjectTradingPool,
        deployerAccount,
        newTrader,
        setManager.address
      );

      await SetTestUtils.assertLogEquivalence(formattedLogs, expectedLogs);
    });

    describe('but caller is not trader', async () => {
      beforeEach(async () => {
        subjectCaller = attacker;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#setLiquidator', async () => {
    let subjectTradingPool: Address;
    let subjectNewLiquidator: Address;
    let subjectCaller: Address;

    beforeEach(async () => {
      setManager = await managerHelper.deploySocialTradingManagerAsync(
        core.address,
        rebalancingFactory.address,
        [allocator.address]
      );

      const callDataManagerAddress = setManager.address;
      const callDataLiquidator = liquidator.address;
      const callDataFeeRecipient = feeRecipient;
      const callDataFeeCalculator = feeCalculator.address;
      const callDataRebalanceInterval = ONE_DAY_IN_SECONDS;
      const callDataFailAuctionPeriod = ONE_DAY_IN_SECONDS;
      const { timestamp } = await web3.eth.getBlock('latest');
      const callDataLastRebalanceTimestamp = timestamp;
      const callDataEntryFee = ether(.01);
      const rebalanceFee = ether(.02);
      const callDataRebalanceFeeCallData = SetUtils.generateFixedFeeCalculatorCalldata(rebalanceFee);
      const rebalancingSetCallData = SetUtils.generateRebalancingSetTokenV2CallData(
        callDataManagerAddress,
        callDataLiquidator,
        callDataFeeRecipient,
        callDataFeeCalculator,
        callDataRebalanceInterval,
        callDataFailAuctionPeriod,
        callDataLastRebalanceTimestamp,
        callDataEntryFee,
        callDataRebalanceFeeCallData,
      );

      const usedAlocator = allocator.address;
      const startingBaseAssetAllocation = ether(.66);
      const startingValue = ether(100);
      const name = 'TestSet';
      const symbol = 'TEST';

      const txHash = await setManager.createTradingPool.sendTransactionAsync(
        usedAlocator,
        startingBaseAssetAllocation,
        startingValue,
        SetUtils.stringToBytes(name),
        SetUtils.stringToBytes(symbol),
        rebalancingSetCallData,
        { from: deployerAccount }
      );

      const logs = await setTestUtils.getLogsFromTxHash(txHash);
      subjectTradingPool = extractNewSetTokenAddressFromLogs(logs, 2);
      subjectNewLiquidator = newLiquidator;
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      return setManager.setLiquidator.sendTransactionAsync(
        subjectTradingPool,
        subjectNewLiquidator,
        { from: subjectCaller }
      );
    }

    it('sets the new liquidator correctly', async () => {
      await subject();

      const poolInstance = await protocolHelper.getRebalancingSetTokenV2Async(subjectTradingPool);
      const actualLiquidator = await poolInstance.liquidator.callAsync();

      expect(actualLiquidator).to.equal(subjectNewLiquidator);
    });

    describe('but caller is not trader', async () => {
      beforeEach(async () => {
        subjectCaller = attacker;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#setFeeRecipient', async () => {
    let subjectTradingPool: Address;
    let subjectNewFeeRecipient: Address;
    let subjectCaller: Address;

    beforeEach(async () => {
      setManager = await managerHelper.deploySocialTradingManagerAsync(
        core.address,
        rebalancingFactory.address,
        [allocator.address]
      );

      const callDataManagerAddress = setManager.address;
      const callDataLiquidator = liquidator.address;
      const callDataFeeRecipient = feeRecipient;
      const callDataFeeCalculator = feeCalculator.address;
      const callDataRebalanceInterval = ONE_DAY_IN_SECONDS;
      const callDataFailAuctionPeriod = ONE_DAY_IN_SECONDS;
      const { timestamp } = await web3.eth.getBlock('latest');
      const callDataLastRebalanceTimestamp = timestamp;
      const callDataEntryFee = ether(.01);
      const rebalanceFee = ether(.02);
      const callDataRebalanceFeeCallData = SetUtils.generateFixedFeeCalculatorCalldata(rebalanceFee);
      const rebalancingSetCallData = SetUtils.generateRebalancingSetTokenV2CallData(
        callDataManagerAddress,
        callDataLiquidator,
        callDataFeeRecipient,
        callDataFeeCalculator,
        callDataRebalanceInterval,
        callDataFailAuctionPeriod,
        callDataLastRebalanceTimestamp,
        callDataEntryFee,
        callDataRebalanceFeeCallData,
      );

      const usedAlocator = allocator.address;
      const startingBaseAssetAllocation = ether(.66);
      const startingValue = ether(100);
      const name = 'TestSet';
      const symbol = 'TEST';

      const txHash = await setManager.createTradingPool.sendTransactionAsync(
        usedAlocator,
        startingBaseAssetAllocation,
        startingValue,
        SetUtils.stringToBytes(name),
        SetUtils.stringToBytes(symbol),
        rebalancingSetCallData,
        { from: deployerAccount }
      );

      const logs = await setTestUtils.getLogsFromTxHash(txHash);
      subjectTradingPool = extractNewSetTokenAddressFromLogs(logs, 2);
      subjectNewFeeRecipient = newTrader;
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      return setManager.setFeeRecipient.sendTransactionAsync(
        subjectTradingPool,
        subjectNewFeeRecipient,
        { from: subjectCaller }
      );
    }

    it('sets the new fee recipient correctly', async () => {
      await subject();

      const poolInstance = await protocolHelper.getRebalancingSetTokenV2Async(subjectTradingPool);
      const actualFeeRecipient = await poolInstance.feeRecipient.callAsync();

      expect(actualFeeRecipient).to.equal(subjectNewFeeRecipient);
    });

    describe('but caller is not trader', async () => {
      beforeEach(async () => {
        subjectCaller = attacker;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });
});