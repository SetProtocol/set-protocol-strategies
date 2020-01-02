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
  MedianContract,
  SetTokenFactoryContract,
  StandardTokenMockContract,
  TransferProxyContract,
  WhiteListContract,
} from 'set-protocol-contracts';
import {
  LegacyMakerOracleAdapterContract,
  OracleProxyContract,
  SocialAllocatorContract,
  SocialTradingManagerContract,
} from '@utils/contracts';

import {
  ONE_DAY_IN_SECONDS,
  UNLIMITED_ALLOWANCE_IN_BASE_UNITS,
  WBTC_DECIMALS
} from '@utils/constants';

import { extractNewSetTokenAddressFromLogs } from '@utils/contract_logs/core';
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
  let usdc: StandardTokenMockContract;

  let liquidator: Address;
  let feeCalculator: Address;
  let rebalancingFactory: Address;
  let oracleWhiteList: Address;
  let liquidatorWhiteList: Address;
  let feeCalculatorWhiteList: Address;

  let ethMedianizer: MedianContract;
  let ethLegacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let ethOracleProxy: OracleProxyContract;

  let btcMedianizer: MedianContract;
  let btcLegacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let btcOracleProxy: OracleProxyContract;

  let allocator: SocialAllocatorContract;

  let initialUSDCPrice: BigNumber;
  let initialBtcPrice: BigNumber;

  let setManager: SocialTradingManagerContract;

  const allocatorPricePrecision: BigNumber = new BigNumber(1);

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

    initialUSDCPrice = ether(1);
    await oracleHelper.updateMedianizerPriceAsync(
      ethMedianizer,
      initialUSDCPrice,
      SetTestUtils.generateTimestamp(1000),
    );

    initialBtcPrice = ether(7500);
    await oracleHelper.updateMedianizerPriceAsync(
      btcMedianizer,
      initialBtcPrice,
      SetTestUtils.generateTimestamp(1000),
    );

    usdc = await erc20Helper.deployTokenAsync(deployerAccount, 6);
    wrappedBTC = await erc20Helper.deployTokenAsync(deployerAccount, WBTC_DECIMALS);
    await protocolHelper.addTokenToWhiteList(wrappedBTC.address, rebalancingComponentWhiteList);
    await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS.mul(7));
    await protocolHelper.addTokenToWhiteList(wrappedBTC.address, rebalancingComponentWhiteList);

    await protocolHelper.addTokenToWhiteList(usdc.address, rebalancingComponentWhiteList);
    await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS.mul(7));
    await protocolHelper.addTokenToWhiteList(usdc.address, rebalancingComponentWhiteList);

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
      [usdc.address, wrappedBTC.address],
      [ethOracleProxy.address, btcOracleProxy.address],
    );

    liquidator = await protocolHelper.deployLinearLiquidatorAsync(
      core.address,
      oracleWhiteList,
      ONE_DAY_IN_SECONDS.div(6), // 4 hours
      new BigNumber(3), // Start
      new BigNumber(21), // End
    );
    liquidatorWhiteList = await protocolHelper.deployWhiteListAsync([liquidator, newLiquidator]);

    feeCalculator = await protocolHelper.deployFixedFeeCalculatorAsync();
    feeCalculatorWhiteList = await protocolHelper.deployWhiteListAsync([feeCalculator]);

    rebalancingFactory = await protocolHelper.deployRebalancingSetTokenV2FactoryAsync(
      core.address,
      rebalancingComponentWhiteList.address,
      liquidatorWhiteList,
      feeCalculatorWhiteList,
    );

    await core.addFactory.sendTransactionAsync(rebalancingFactory, { from: deployerAccount });
    await blockchain.increaseTimeAsync(new BigNumber(2));
    await core.addFactory.sendTransactionAsync(rebalancingFactory, { from: deployerAccount });

    await erc20Helper.approveTransfersAsync(
      [wrappedBTC, usdc],
      transferProxy.address
    );

    allocator = await managerHelper.deploySocialAllocatorAsync(
      wrappedBTC.address,
      usdc.address,
      oracleWhiteList,
      core.address,
      factory.address,
      allocatorPricePrecision,
    );

    await oracleHelper.addAuthorizedAddressesToOracleProxy(
      ethOracleProxy,
      [allocator.address, liquidator]
    );

    await oracleHelper.addAuthorizedAddressesToOracleProxy(
      btcOracleProxy,
      [allocator.address, liquidator]
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#updateAllocation', async () => {
    let subjectTradingPool: Address;
    let subjectNewAllocation: BigNumber;
    let subjectLiquidatorData: string;
    let subjectTimeIncrease: BigNumber;
    let subjectCaller: Address;

    let startingBaseAssetAllocation: BigNumber;

    beforeEach(async () => {
      setManager = await managerHelper.deploySocialTradingManagerAsync(
        core.address,
        rebalancingFactory,
        [allocator.address]
      );

      const callDataManagerAddress = setManager.address;
      const callDataLiquidator = liquidator;
      const callDataFeeRecipient = feeRecipient;
      const callDataFeeCalculator = feeCalculator;
      const callDataRebalanceInterval = ONE_DAY_IN_SECONDS;
      const callDataFailAuctionPeriod = ONE_DAY_IN_SECONDS;
      const { timestamp } = await web3.eth.getBlock('latest');
      const callDataLastRebalanceTimestamp = timestamp;
      const callDataEntryFee = new BigNumber(0);
      const rebalanceFee = new BigNumber(0);
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
      startingBaseAssetAllocation = ether(1);
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
      subjectNewAllocation = ether(0);
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

    it('passes the correct nextSet', async () => {
      const txHash = await subject();
      const logs = await setTestUtils.getLogsFromTxHash(txHash);
      const collateralAddress = extractNewSetTokenAddressFromLogs(logs, 3);

      const poolInstance = await protocolHelper.getRebalancingSetTokenV2Async(subjectTradingPool);
      const actualNextSet = await poolInstance.nextSet.callAsync();
      const nextSetInstance = await protocolHelper.getSetTokenAsync(actualNextSet);

      const units = await nextSetInstance.getUnits.callAsync();
      const components = await nextSetInstance.getComponents.callAsync();
      console.log('Next Set Base Asset', components[0], units[0].toString());
      // console.log("Next Set Quote Asset", components[1], units[1].toString());
      const naturalUnit = await nextSetInstance.naturalUnit.callAsync();
      console.log('Next Set Natural Unit', naturalUnit.toString());

      const currentSet = await poolInstance.currentSet.callAsync();
      const currentSetInstance = await protocolHelper.getSetTokenAsync(currentSet);

      const currentSetUnits = await currentSetInstance.getUnits.callAsync();
      const currentComponents = await currentSetInstance.getComponents.callAsync();
      console.log('Current Set Base Asset', currentComponents[0], currentSetUnits[0].toString());
      // console.log("Current Set Quote Asset", currentComponents[1], currentSetUnits[1].toString());
      const currentSetNaturalUnit = await currentSetInstance.naturalUnit.callAsync();
      console.log('Current Set Natural Unit', currentSetNaturalUnit.toString());

      // Get to fair value
      const THIRT_MINS = new BigNumber(60 * 30);
      await blockchain.increaseTimeAsync(THIRT_MINS);
      // Do something
      await protocolHelper.addTokenToWhiteList(attacker, rebalancingComponentWhiteList);

      // oracle prices
      const usdcOraclePrice = await ethLegacyMakerOracleAdapter.read.callAsync();
      console.log('USDC Price', usdcOraclePrice.toString());

      const wbtcOraclePrice = await btcLegacyMakerOracleAdapter.read.callAsync();
      console.log('WBTC Price', wbtcOraclePrice.toString());


      // Now get liquidator information
      const liquidatorInstance = await protocolHelper.getLinearLiquidatorAsync(liquidator);
      const auction = await liquidatorInstance.auctions.callAsync(subjectTradingPool);
      console.log('Auction', JSON.stringify(auction));

      const minBid = new BigNumber(1e15);
      const price = await liquidatorInstance.getBidPrice.callAsync(
        subjectTradingPool,
        minBid,
      );
      console.log('Price', JSON.stringify(price));

      expect(actualNextSet).to.equal(collateralAddress);
    });
  });
});