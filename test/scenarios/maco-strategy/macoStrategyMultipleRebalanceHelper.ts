require('module-alias/register');

import * as _ from 'lodash';
import * as setProtocolUtils from 'set-protocol-utils';
import { Address, Web3Utils } from 'set-protocol-utils';
import { BigNumber } from 'set-protocol-utils';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import {
  CoreContract,
  LinearAuctionPriceCurveContract,
  RebalanceAuctionModuleContract,
  RebalancingSetTokenContract,
  RebalancingSetTokenFactoryContract,
  SetTokenContract,
  SetTokenFactoryContract,
  TransferProxyContract,
  VaultContract,
  WethMockContract,
  WhiteListContract,
} from 'set-protocol-contracts';
import {
  HistoricalPriceFeedContract,
  MedianContract,
  MovingAverageOracleContract,
} from 'set-protocol-oracles';
import {
  MACOStrategyManagerContract,
  USDCMockContract,
} from '@utils/contracts';
import {
  DEFAULT_GAS,
  ONE_DAY_IN_SECONDS,
  UNLIMITED_ALLOWANCE_IN_BASE_UNITS
} from '@utils/constants';
import { getWeb3 } from '@utils/web3Helper';

import {
  UserAccountData,
  TokenBalances,
  UserTokenBalances,
  IssuanceTxn,
  IssuanceSchedule,
  TokenPrices,
  BidTxn,
  SingleRebalanceCycleScenario,
  FullRebalanceProgram,
  DataOutput,
} from './types';

import { ProtocolHelper } from '@utils/helpers/protocolHelper';
import { ERC20Helper } from '@utils/helpers/erc20Helper';
import { OracleHelper } from '@utils/helpers/oracleHelper';
import { ManagerHelper } from '@utils/helpers/managerHelper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { SetProtocolTestUtils: SetTestUtils, SetProtocolUtils: SetUtils } = setProtocolUtils;
const web3Utils = new Web3Utils(web3);

export class MACOStrategyMultipleRebalanceHelper {
  private _accounts: UserAccountData;
  private _rebalanceProgram: FullRebalanceProgram;
  private _dataLogger: DataOutput;

  private _contractOwnerAddress: Address;
  private _protocolHelper: ProtocolHelper;
  private _erc20Helper: ERC20Helper;
  private _oracleHelper: OracleHelper;
  private _managerHelper: ManagerHelper;

  private _rebalancingSetToken: RebalancingSetTokenContract;

  private _core: CoreContract;
  private _transferProxy: TransferProxyContract;
  private _vault: VaultContract;
  private _rebalanceAuctionModule: RebalanceAuctionModuleContract;
  private _factory: SetTokenFactoryContract;
  private _rebalancingFactory: RebalancingSetTokenFactoryContract;
  private _linearAuctionPriceCurve: LinearAuctionPriceCurveContract;
  private _whiteList: WhiteListContract;
  private _macoStrategyManager: MACOStrategyManagerContract;
  private _ethMedianizer: MedianContract;
  private _historicalPriceFeed: HistoricalPriceFeedContract;
  private _movingAverageOracle: MovingAverageOracleContract;

  private _usdc: USDCMockContract;
  private _wrappedETH: WethMockContract;
  private _stableCollateralSet: SetTokenContract;
  private _riskCollateralSet: SetTokenContract;

  constructor(otherAccounts: Address[], rebalanceProgram: FullRebalanceProgram, profileGas: boolean = false) {
    this._contractOwnerAddress = otherAccounts[0];
    this._accounts = this._createAccountPersonalitiesAsync(otherAccounts);
    this._validateScenarioObject(rebalanceProgram);
    this._rebalanceProgram = rebalanceProgram;
    this._dataLogger = {
      collateralizingSets: [],
      issuedRebalancingSets: [],
      rebalanceFairValues: [],
      rebalancingSetBaseSetDust: [],
      rebalancingSetComponentDust: [],
      gasProfile: {},
    };

    this._protocolHelper = new ProtocolHelper(this._contractOwnerAddress);
    this._erc20Helper = new ERC20Helper(this._contractOwnerAddress);
    this._managerHelper = new ManagerHelper(this._contractOwnerAddress);
    this._oracleHelper = new OracleHelper(this._contractOwnerAddress);
  }

  public async runFullRebalanceProgram(): Promise<DataOutput> {

    await this.deployAndAuthorizeCoreContractsAsync();

    await this.createRebalancingSetToken();

    await this.distributeTokensAndMintSets();

    await this.runRebalanceScenario(this._rebalanceProgram.cycleData);

    return this._dataLogger;
  }

  public async deployAndAuthorizeCoreContractsAsync(
    deployerAccount: Address = this._contractOwnerAddress,
  ): Promise<void> {
    // Deploy core contracts
    this._transferProxy = await this._protocolHelper.getDeployedTransferProxyAsync();

    this._vault = await this._protocolHelper.getDeployedVaultAsync();

    this._core = await this._protocolHelper.getDeployedCoreAsync();

    this._rebalanceAuctionModule = await this._protocolHelper.getDeployedRebalanceAuctionModuleAsync();

    this._factory = await this._protocolHelper.getDeployedSetTokenFactoryAsync();

    this._linearAuctionPriceCurve = await this._protocolHelper.getDeployedLinearAuctionPriceCurveAsync();

    this._whiteList = await this._protocolHelper.getDeployedWhiteList();

    this._rebalancingFactory = await this._protocolHelper.getDeployedRebalancingSetTokenFactoryTwoAsync();

    // Deploy Oracles and set initial prices
    this._ethMedianizer = await this._protocolHelper.getDeployedWETHMedianizerAsync();
    await this._oracleHelper.addPriceFeedOwnerToMedianizer(this._ethMedianizer, deployerAccount);
    await this._oracleHelper.updateMedianizerPriceAsync(
      this._ethMedianizer,
      this._rebalanceProgram.initializationParams.initialTokenPrices.RiskAssetPrice,
      SetTestUtils.generateTimestamp(1000),
    );

    this._historicalPriceFeed = await this._oracleHelper.deployHistoricalPriceFeedAsync(
      ONE_DAY_IN_SECONDS,
      this._ethMedianizer.address,
      'ETH200Daily',
      this._rebalanceProgram.initializationParams.seededValues,
    );

    this._movingAverageOracle = await this._oracleHelper.deployMovingAverageOracleAsync(
      this._historicalPriceFeed.address,
      'ETHDailyMA',
    );

    // Deploy USDC, WETH and add usdc to whitelist (must add twice due to timelock)
    this._usdc = await this._erc20Helper.deployUSDCTokenAsync(deployerAccount);
    await this._protocolHelper.addTokenToWhiteList(this._usdc.address, this._whiteList);
    await web3Utils.increaseTime(
      1
    );
    await this._protocolHelper.addTokenToWhiteList(this._usdc.address, this._whiteList);

    this._wrappedETH = await this._protocolHelper.getDeployedWETHAsync();
  }

  public async createRebalancingSetToken(): Promise<void> {
    this._stableCollateralSet = await this._protocolHelper.createSetTokenAsync(
      this._core,
      this._factory.address,
      [this._usdc.address],
      this._rebalanceProgram.initializationParams.initialStableCollateralUnits,
      this._rebalanceProgram.initializationParams.initialStableCollateralNaturalUnit,
    );
    this._dataLogger.gasProfile.createInitialBaseSet = await this._extractGasCostFromLatestBlockAsync();
    this._rebalanceProgram.generalRebalancingData.stableCollateralSets.push(
      this._stableCollateralSet.address
    );

    this._riskCollateralSet = await this._protocolHelper.createSetTokenAsync(
      this._core,
      this._factory.address,
      [this._wrappedETH.address],
      this._rebalanceProgram.initializationParams.initialRiskCollateralUnits,
      this._rebalanceProgram.initializationParams.initialRiskCollateralNaturalUnit,
    );
    this._rebalanceProgram.generalRebalancingData.riskCollateralSets.push(
      this._riskCollateralSet.address
    );

    // Deploy manager contract
    this._macoStrategyManager = await this._managerHelper.deployMACOStrategyManagerAsync(
      this._core.address,
      this._movingAverageOracle.address,
      this._usdc.address,
      this._wrappedETH.address,
      this._stableCollateralSet.address,
      this._riskCollateralSet.address,
      this._factory.address,
      this._linearAuctionPriceCurve.address,
      this._rebalanceProgram.initializationParams.movingAverageDays,
      this._rebalanceProgram.initializationParams.crossoverConfirmationBounds,
      this._rebalanceProgram.initializationParams.auctionTimeToPivot,
    );

    const rebalancingSetCallData = SetUtils.generateRebalancingSetTokenCallData(
      this._macoStrategyManager.address,
      this._rebalanceProgram.initializationParams.proposalPeriod,
      this._rebalanceProgram.initializationParams.rebalanceInterval,
    );

    this._rebalancingSetToken = await this._protocolHelper.createRebalancingTokenAsync(
      this._core,
      this._rebalancingFactory.address,
      [this._riskCollateralSet.address],
      this._rebalanceProgram.initializationParams.rebalancingSetUnitShares,
      this._rebalanceProgram.initializationParams.rebalancingSetNaturalUnit,
      rebalancingSetCallData,
    );
    this._dataLogger.gasProfile.createRebalancingSet = await this._extractGasCostFromLatestBlockAsync();

    // Initialize manager with rebalancing set address
    this._macoStrategyManager.initialize.sendTransactionAsync(this._rebalancingSetToken.address);
  }

  public async distributeTokensAndMintSets(): Promise<void> {
    // Issue Rebalancing Sets using _contractOwnerAddress tokens and distrubuted to owner group
    await this._issueAndDistributeRebalancingSetsAsync();

    // Distribute tokens to bidding accounts
    await this._distributeUSDCAndEthToBiddersAsync();
  }

  public async runRebalanceScenario(
    scenarios: SingleRebalanceCycleScenario[],
  ): Promise<void> {
    // For each rebalance iteration
    for (let i = 0; i < this._rebalanceProgram.rebalanceIterations; i++) {
      const scenario = scenarios[i];

      // Issue and Redeem Sets
      await this._executeIssuanceScheduleAsync(scenario.issueRedeemSchedule);

      // Log daily ptice changes to update moving average oracle
      await this._logDailyPriceChangesAsync(scenario.intermediatePriceChanges);

      // Run Proposal (change prices) and transtion to rebalance
      await this._proposeAndTransitionToRebalanceAsync(scenario.priceUpdate);

      // Run bidding program
      await this._executeBiddingScheduleAsync(scenario.biddingSchedule, scenario.priceUpdate);

      // Finish rebalance cycle and log outputs
      await this._settleRebalanceAndLogState();

    }
  }

  public async returnAllUserTokenBalancesAsync(): Promise<UserTokenBalances> {
    let allUserTokenBalances: UserTokenBalances;

    const bidderOne = await this._getTokenBalancesAsync(this._accounts.bidderOne);
    const bidderTwo = await this._getTokenBalancesAsync(this._accounts.bidderTwo);
    const bidderThree = await this._getTokenBalancesAsync(this._accounts.bidderThree);
    const bidderFour = await this._getTokenBalancesAsync(this._accounts.bidderFour);
    const bidderFive = await this._getTokenBalancesAsync(this._accounts.bidderFive);

    const tokenOwnerOne = await this._getTokenBalancesAsync(this._accounts.tokenOwnerOne);
    const tokenOwnerTwo = await this._getTokenBalancesAsync(this._accounts.tokenOwnerTwo);
    const tokenOwnerThree = await this._getTokenBalancesAsync(this._accounts.tokenOwnerThree);
    const tokenOwnerFour = await this._getTokenBalancesAsync(this._accounts.tokenOwnerFour);
    const tokenOwnerFive = await this._getTokenBalancesAsync(this._accounts.tokenOwnerFive);

    allUserTokenBalances = {
      bidderOne,
      bidderTwo,
      bidderThree,
      bidderFour,
      bidderFive,
      tokenOwnerOne,
      tokenOwnerTwo,
      tokenOwnerThree,
      tokenOwnerFour,
      tokenOwnerFive,
    };
    return allUserTokenBalances;
  }

  /* ============ Private ============ */

  private _validateScenarioObject(
    rebalanceProgram: FullRebalanceProgram,
  ): void {
    if (rebalanceProgram.rebalanceIterations != rebalanceProgram.cycleData.length) {
      throw new Error('Provided rebalance iterations does not match cycle data');
    }

    let lastBidPrice: BigNumber;
    for (let i = 0; i < rebalanceProgram.rebalanceIterations; i++) {
      lastBidPrice = new BigNumber(-1);
      for (let j = 0; j < rebalanceProgram.cycleData[i].biddingSchedule.length; j++) {
        const bid = rebalanceProgram.cycleData[i].biddingSchedule[j];
        if (lastBidPrice.greaterThan(bid.price)) {
          throw new Error('Bids must be placed in ascending price order');
        }
        lastBidPrice = bid.price;
      }
    }
  }

  private _createAccountPersonalitiesAsync(
    accounts: Address[],
  ): UserAccountData {
    const personalities = {
      bidderOne: accounts[1],
      bidderTwo: accounts[2],
      bidderThree: accounts[3],
      bidderFour: accounts[4],
      bidderFive: accounts[5],
      tokenOwnerOne: accounts[6],
      tokenOwnerTwo: accounts[7],
      tokenOwnerThree: accounts[8],
      tokenOwnerFour: accounts[9],
      tokenOwnerFive: accounts[10],
      bidders: accounts.slice(1, 6),
      tokenOwners: accounts.slice(6, 11),
    };

    return personalities;
  }

  private async _issueAndDistributeRebalancingSetsAsync(): Promise<void> {
    // Approve transfers for WBTC and WETH
    await this._erc20Helper.approveTransfersAsync(
      [this._usdc],
      this._transferProxy.address
    );

    await this._wrappedETH.approve.sendTransactionAsync(
      this._transferProxy.address,
      UNLIMITED_ALLOWANCE_IN_BASE_UNITS,
      { from: this._contractOwnerAddress, gas: DEFAULT_GAS },
    );

    // Issue Rebalancing Set to the the deployer
    const txHashIssueBase = await this._core.issue.sendTransactionAsync(
      this._riskCollateralSet.address,
      this._rebalanceProgram.initializationParams.initialCollateralIssueQuantity,
      { from: this._contractOwnerAddress, gas: DEFAULT_GAS },
    );
    this._dataLogger.gasProfile.issueInitialBaseSet = await this._extractGasCostAsync(
      txHashIssueBase
    );

    await this._riskCollateralSet.approve.sendTransactionAsync(
      this._transferProxy.address,
      UNLIMITED_ALLOWANCE_IN_BASE_UNITS,
      { from: this._contractOwnerAddress, gas: DEFAULT_GAS },
    );

    // Issue Rebalancing Set to the the deployer
    const txHashIssueRebalancing = await this._core.issue.sendTransactionAsync(
      this._rebalancingSetToken.address,
      this._rebalanceProgram.initializationParams.rebalancingSetIssueQuantity,
      { from: this._contractOwnerAddress, gas: DEFAULT_GAS },
    );
    this._dataLogger.gasProfile.issueRebalancingSet = await this._extractGasCostAsync(
      txHashIssueRebalancing
    );

    // Transfer RebalancingSetToken amounts to bidders
    const transferRebalancingSetPromises = _.map(
      this._accounts.tokenOwners,
      address => this._rebalancingSetToken.transfer.sendTransactionAsync(
        address,
        this._rebalanceProgram.initializationParams.rebalancingSetIssueQuantity.div(5),
        { from: this._contractOwnerAddress, gas: DEFAULT_GAS },
      )
    );
    await Promise.all(transferRebalancingSetPromises);

    this._dataLogger.collateralizingSets.push(
      await this._vault.getOwnerBalance.callAsync(
        this._riskCollateralSet.address,
        this._rebalancingSetToken.address,
      )
    );

    this._dataLogger.issuedRebalancingSets.push(
      await this._rebalancingSetToken.totalSupply.callAsync()
    );
  }

  private async _distributeUSDCAndEthToBiddersAsync(): Promise<void> {
    // Transfer USDC amounts to bidders
    const transferUSDCPromises = _.map(
      this._accounts.bidders,
      address => this._usdc.transfer.sendTransactionAsync(
        address,
        new BigNumber(10 ** 19),
        { from: this._contractOwnerAddress, gas: DEFAULT_GAS },
      )
    );
    await Promise.all(transferUSDCPromises);

    // Transfer WETH amounts to bidders
    const transferWETHPromises = _.map(
      this._accounts.bidders,
      address => this._wrappedETH.transfer.sendTransactionAsync(
        address,
        new BigNumber(10 ** 21),
        { from: this._contractOwnerAddress, gas: DEFAULT_GAS },
      )
    );
    await Promise.all(transferWETHPromises);

    // Approve USDC amounts for bidders to transferProxy
    const approveUSDCPromises = _.map(
      this._accounts.bidders,
      address => this._usdc.approve.sendTransactionAsync(
        this._transferProxy.address,
        UNLIMITED_ALLOWANCE_IN_BASE_UNITS,
        { from: address, gas: DEFAULT_GAS },
      )
    );
    await Promise.all(approveUSDCPromises);

    // Approve WETH amounts for bidders to transferProxy
    const approveWETHPromises = _.map(
      this._accounts.bidders,
      address => this._wrappedETH.approve.sendTransactionAsync(
        this._transferProxy.address,
        UNLIMITED_ALLOWANCE_IN_BASE_UNITS,
        { from: address, gas: DEFAULT_GAS },
      )
    );
    await Promise.all(approveWETHPromises);
  }

  private async _executeIssuanceScheduleAsync(
    schedule: IssuanceSchedule,
  ): Promise<void> {

    // Execute issuances
    const issuancePromises = _.map(
      schedule.issuances,
      txn => this._issueRebalancingSetsAsync(
        txn,
      )
    );
    await Promise.all(issuancePromises);

    // Execute redemptions
    const redemptionPromises = _.map(
      schedule.redemptions,
      txn => this._redeemRebalancingSetsAsync(
        txn,
      )
    );
    await Promise.all(redemptionPromises);
  }

  private async _logDailyPriceChangesAsync(
    priceChanges: BigNumber[],
  ): Promise<void> {
    await this._oracleHelper.batchUpdateHistoricalPriceFeedAsync(
      this._historicalPriceFeed,
      this._ethMedianizer,
      priceChanges.length,
      priceChanges
    );
  }

  private async _proposeAndTransitionToRebalanceAsync(
    newPrices: TokenPrices,
  ): Promise<void> {
    await this._oracleHelper.updateHistoricalPriceFeedAsync(
      this._historicalPriceFeed,
      this._ethMedianizer,
      newPrices.RiskAssetPrice,
    );

    // Fast forward the rebalance interval
    await web3Utils.increaseTime(
      this._rebalanceProgram.initializationParams.rebalanceInterval.plus(1).toNumber()
    );
    // Call propose from Rebalance Manager and log propose data
    const txHashInitialPropose = await this._macoStrategyManager.initialPropose.sendTransactionAsync(
      { from: this._contractOwnerAddress, gas: DEFAULT_GAS },
    );

    await web3Utils.increaseTime(
      ONE_DAY_IN_SECONDS.div(4).toNumber()
    );
    const txHashConfirmPropose = await this._macoStrategyManager.confirmPropose.sendTransactionAsync(
      { from: this._contractOwnerAddress, gas: DEFAULT_GAS },
    );
    await this._logPostProposeDataAsync(txHashInitialPropose, txHashConfirmPropose);

    await web3Utils.increaseTime(
      this._rebalanceProgram.initializationParams.proposalPeriod.toNumber()
    );
    const txHashStartRebalance = await this._rebalancingSetToken.startRebalance.sendTransactionAsync(
      { from: this._contractOwnerAddress, gas: DEFAULT_GAS },
    );
    await this._logPostStartRebalanceDataAsync(txHashStartRebalance);

  }

  private async _executeBiddingScheduleAsync(
    schedule: BidTxn[],
    tokenPrices: TokenPrices,
  ): Promise<void> {
    let cumulativeTime: number = 0;

    for (let i = 0; i < schedule.length; i++) {
      const bid = schedule[i];
      const bidPrice = await this._calculateImpliedBidPriceAsync(bid.price, tokenPrices);
      const bidTime = await this._calculateImpliedBidTimeAsync(bidPrice);
      const timeJump = bidTime - cumulativeTime;

      const bidAmount = this._calculateImpliedBidAmount(bid.amount);
      await web3Utils.increaseTime(timeJump);

      await this._rebalanceAuctionModule.bid.sendTransactionAsync(
        this._rebalancingSetToken.address,
        bidAmount,
        false,
        { from: bid.sender, gas: DEFAULT_GAS }
      );
      cumulativeTime += timeJump;
    }

    await this._executeBidCleanUpAsync(schedule[schedule.length - 1].sender);
  }

  private async _settleRebalanceAndLogState(): Promise<void> {
    const txHashSettle = await this._rebalancingSetToken.settleRebalance.sendTransactionAsync(
      { from: this._contractOwnerAddress, gas: DEFAULT_GAS },
    );
    this._dataLogger.gasProfile.settleRebalance = await this._extractGasCostAsync(
      txHashSettle
    );

    const currentSet = await this._rebalancingSetToken.currentSet.callAsync();
    this._dataLogger.collateralizingSets.push(
      await this._vault.getOwnerBalance.callAsync(
        currentSet,
        this._rebalancingSetToken.address,
      )
    );

    this._dataLogger.issuedRebalancingSets.push(
      await this._rebalancingSetToken.totalSupply.callAsync()
    );

    this._dataLogger.rebalancingSetComponentDust.push(
      await this._getTokenBalancesAsync(
        this._rebalancingSetToken.address
      )
    );
  }

  private async _issueRebalancingSetsAsync(
    issuance: IssuanceTxn,
  ): Promise<void> {
    const currentSet = await this._rebalancingSetToken.currentSet.callAsync();
    const currentSetInstance = await this._protocolHelper.getSetTokenAsync(currentSet);
    const currentSetNaturalUnit = await currentSetInstance.naturalUnit.callAsync();

    const rebalancingSetUnitShares = await this._rebalancingSetToken.unitShares.callAsync();
    const rebalancingSetNaturalUnit = await this._rebalancingSetToken.naturalUnit.callAsync();
    const currentSetRequiredAmountUnrounded = issuance.amount
                                       .mul(rebalancingSetUnitShares)
                                       .div(rebalancingSetNaturalUnit)
                                       .round(0, 3);
    const currentSetRequiredAmount = currentSetRequiredAmountUnrounded.sub(
      currentSetRequiredAmountUnrounded.modulo(currentSetNaturalUnit)
    ).add(currentSetNaturalUnit);

    await this._core.issue.sendTransactionAsync(
      currentSetInstance.address,
      currentSetRequiredAmount,
      { from: issuance.sender, gas: DEFAULT_GAS },
    );
    await currentSetInstance.approve.sendTransactionAsync(
      this._transferProxy.address,
      UNLIMITED_ALLOWANCE_IN_BASE_UNITS,
      { from: issuance.sender, gas: DEFAULT_GAS },
    );
    await this._core.issue.sendTransactionAsync(
      this._rebalancingSetToken.address,
      issuance.amount,
      { from: issuance.sender, gas: DEFAULT_GAS },
    );
  }

  private async _redeemRebalancingSetsAsync(
    redemption: IssuanceTxn,
  ): Promise<void> {
    const txHashRedeem = await this._core.redeem.sendTransactionAsync(
      this._rebalancingSetToken.address,
      redemption.amount,
      { from: redemption.sender, gas: DEFAULT_GAS },
    );

    this._dataLogger.gasProfile.redeemRebalancingSet = await this._extractGasCostAsync(
      txHashRedeem
    );
  }

  private async _calculateImpliedBidPriceAsync(
    percentFromFairValue: BigNumber,
    tokenPrices: TokenPrices,
  ): Promise<BigNumber> {
    const auctionPriceParameters = await this._rebalancingSetToken.getAuctionPriceParameters.callAsync();
    const auctionStartPrice = auctionPriceParameters[2];
    const auctionPivotPrice = auctionPriceParameters[3];

    const fairValue = (auctionStartPrice.add(auctionPivotPrice)).div(2).round(0, 3);
    return fairValue.mul(percentFromFairValue.add(1)).round(0, 4);
  }

  private async _calculateImpliedBidTimeAsync(
    bidPrice: BigNumber,
  ): Promise<number> {
    const auctionPriceParameters = await this._rebalancingSetToken.getAuctionPriceParameters.callAsync();
    const auctionTimeToPivot = this._rebalanceProgram.initializationParams.auctionTimeToPivot;
    const auctionStartPrice = auctionPriceParameters[2];
    const auctionPivotPrice = auctionPriceParameters[3];
    const linearPriceDifference = auctionPivotPrice.sub(auctionStartPrice);

    const bidTime = (bidPrice.sub(auctionStartPrice)).mul(auctionTimeToPivot)
      .div(linearPriceDifference).round(0, 3);
    return bidTime.toNumber();
  }

  private _calculateImpliedBidAmount(
    bidAmount: BigNumber,
  ): BigNumber {
    const initialRemainingSets = this._rebalanceProgram.generalRebalancingData.initialRemainingSets;
    const unroundedBidAmount = initialRemainingSets.mul(bidAmount);

    return unroundedBidAmount.sub(
      unroundedBidAmount.modulo(this._rebalanceProgram.generalRebalancingData.minimumBid)
    );
  }

  private async _executeBidCleanUpAsync(
    lastBidder: Address,
  ): Promise<void> {
    const biddingParameters = await this._rebalancingSetToken.getBiddingParameters.callAsync();
    const bidAmount = biddingParameters[1].sub(
      biddingParameters[1].modulo(this._rebalanceProgram.generalRebalancingData.minimumBid)
    );

    if (bidAmount.greaterThan(0)) {
      const txHashBid = await this._rebalanceAuctionModule.bid.sendTransactionAsync(
        this._rebalancingSetToken.address,
        bidAmount,
        false,
        { from: lastBidder, gas: DEFAULT_GAS }
      );
      this._dataLogger.gasProfile.bid = await this._extractGasCostAsync(
        txHashBid
      );
    }
  }

  private async _getTokenBalancesAsync(
    userAddress: Address,
  ): Promise<TokenBalances> {
    let userBalances: TokenBalances;

    const USDCWallet = await this._usdc.balanceOf.callAsync(userAddress);
    const USDCVault = await this._vault.getOwnerBalance.callAsync(this._usdc.address, userAddress);
    const WETHWallet = await this._wrappedETH.balanceOf.callAsync(userAddress);
    const WETHVault = await this._vault.getOwnerBalance.callAsync(this._wrappedETH.address, userAddress);
    const RebalancingSet = await this._rebalancingSetToken.balanceOf.callAsync(userAddress);

    userBalances = {
      StableAsset: USDCWallet.add(USDCVault),
      RiskAsset: WETHWallet.add(WETHVault),
      RebalancingSet,
    } as TokenBalances;
    return userBalances;
  }

  private async _extractGasCostAsync(
    txHash: string,
  ): Promise<BigNumber> {
    const issueReceipt = await web3.eth.getTransactionReceipt(txHash);
    return issueReceipt.gasUsed;
  }

  private async _extractGasCostFromLatestBlockAsync(): Promise<BigNumber> {
    const block = await web3.eth.getBlock('latest');

    const txHash = block.transactions[0];
    return this._extractGasCostAsync(txHash);
  }

  private async _logPostProposeDataAsync(initialTxHash: string, confirmTxHash: string): Promise<void> {
    this._dataLogger.gasProfile.initialProposeRebalance = await this._extractGasCostAsync(
      initialTxHash
    );

    this._dataLogger.gasProfile.confirmProposeRebalance = await this._extractGasCostAsync(
      confirmTxHash
    );

    this._checkNewCollateralCreatedAsync();

    const auctionPriceParameters = await this._rebalancingSetToken.getAuctionPriceParameters.callAsync();
    const auctionStartPrice = auctionPriceParameters[2];
    const auctionPivotPrice = auctionPriceParameters[3];
    this._dataLogger.rebalanceFairValues.push(
      (auctionStartPrice.add(auctionPivotPrice)).div(2).round(0, 3)
    );
  }

  private async _logPostStartRebalanceDataAsync(txHash: string): Promise<void> {
    this._dataLogger.gasProfile.startRebalance = await this._extractGasCostAsync(
      txHash
    );

    const biddingParameters = await this._rebalancingSetToken.getBiddingParameters.callAsync();
    this._rebalanceProgram.generalRebalancingData.minimumBid = biddingParameters[0];
    this._rebalanceProgram.generalRebalancingData.initialRemainingSets = biddingParameters[1];
  }

  private async _checkNewCollateralCreatedAsync(): Promise<void> {
    const currentStableCollateral = await this._macoStrategyManager.stableCollateralAddress.callAsync();
    const currentRiskCollateral = await this._macoStrategyManager.riskCollateralAddress.callAsync();

    if (currentStableCollateral != this._stableCollateralSet.address) {
      this._stableCollateralSet = await this._protocolHelper.getSetTokenAsync(currentStableCollateral);
      this._rebalanceProgram.generalRebalancingData.stableCollateralSets.push(currentStableCollateral);
    }

    if (currentRiskCollateral != this._riskCollateralSet.address) {
      this._riskCollateralSet = await this._protocolHelper.getSetTokenAsync(currentRiskCollateral);
      this._rebalanceProgram.generalRebalancingData.riskCollateralSets.push(currentRiskCollateral);
    }
  }
}