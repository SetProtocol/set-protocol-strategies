import { Address } from 'set-protocol-utils';
import { BigNumber } from 'set-protocol-utils';

export interface IssuanceSchedule {
  issuances: IssuanceTxn[];
  redemptions: IssuanceTxn[];
}

export interface UserAccountData {
  bidderOne: Address;
  bidderTwo: Address;
  bidderThree: Address;
  bidderFour: Address;
  bidderFive: Address;
  tokenOwnerOne: Address;
  tokenOwnerTwo: Address;
  tokenOwnerThree: Address;
  tokenOwnerFour: Address;
  tokenOwnerFive: Address;
  bidders: Address[];
  tokenOwners: Address[];
}

export interface TokenBalances {
  RiskAsset: BigNumber;
  StableAsset: BigNumber;
  RebalancingSet: BigNumber;
}

export interface UserTokenBalances {
  bidderOne: TokenBalances;
  bidderTwo: TokenBalances;
  bidderThree: TokenBalances;
  bidderFour: TokenBalances;
  bidderFive: TokenBalances;
  tokenOwnerOne: TokenBalances;
  tokenOwnerTwo: TokenBalances;
  tokenOwnerThree: TokenBalances;
  tokenOwnerFour: TokenBalances;
  tokenOwnerFive: TokenBalances;
}

export interface GasProfiler {
  coreMock?: BigNumber;
  transferProxy?: BigNumber;
  vault?: BigNumber;
  rebalanceAuctionModule?: BigNumber;
  factory?: BigNumber;
  rebalancingComponentWhiteList?: BigNumber;
  rebalancingFactory?: BigNumber;
  linearAuctionPriceCurve?: BigNumber;
  btcethRebalancingManager?: BigNumber;
  addTokenToWhiteList?: BigNumber;
  createInitialBaseSet?: BigNumber;
  createRebalancingSet?: BigNumber;
  issueInitialBaseSet?: BigNumber;
  issueRebalancingSet?: BigNumber;
  redeemRebalancingSet?: BigNumber;
  initialProposeRebalance?: BigNumber;
  confirmProposeRebalance?: BigNumber;
  startRebalance?: BigNumber;
  bid?: BigNumber;
  settleRebalance?: BigNumber;
}

export interface TokenPrices {
  RiskAssetPrice: BigNumber;
  StableAssetPrice: BigNumber;
}

export interface BidTxn {
  sender: Address;
  amount: BigNumber;
  price: BigNumber;
}

export interface IssuanceTxn {
  sender: Address;
  amount: BigNumber;
}

export interface MACOInitializationParameters {
  initialTokenPrices: TokenPrices;
  initialStableCollateralUnits: BigNumber[];
  initialStableCollateralNaturalUnit: BigNumber;
  initialRiskCollateralUnits: BigNumber[];
  initialRiskCollateralNaturalUnit: BigNumber;
  initialCollateralIssueQuantity: BigNumber;
  rebalancingSetIssueQuantity: BigNumber;
  rebalancingSetUnitShares: BigNumber[];
  rebalancingSetNaturalUnit: BigNumber;
  movingAverageDays: BigNumber;
  proposalPeriod: BigNumber;
  rebalanceInterval: BigNumber;
  auctionTimeToPivot: BigNumber;
  priceDivisor: BigNumber;
  seededValues: BigNumber[];
}

export interface GeneralRebalancingData {
  stableCollateralSets: Address[];
  riskCollateralSets: Address[];
  minimumBid: BigNumber;
  initialRemainingSets: BigNumber;
}

export interface SingleRebalanceCycleScenario {
  issueRedeemSchedule: IssuanceSchedule;
  intermediatePriceChanges: BigNumber[];
  priceUpdate: TokenPrices;
  biddingSchedule: BidTxn[];
}

export interface FullRebalanceProgram {
  rebalanceIterations: number;
  initializationParams: MACOInitializationParameters;
  generalRebalancingData: GeneralRebalancingData;
  cycleData: SingleRebalanceCycleScenario[];
}

export interface DataOutput {
  collateralizingSets?: BigNumber[];
  issuedRebalancingSets?: BigNumber[];
  rebalanceFairValues?: BigNumber[];
  rebalancingSetComponentDust?: TokenBalances[];
  rebalancingSetBaseSetDust?: BigNumber[];
  gasProfile: GasProfiler;
}