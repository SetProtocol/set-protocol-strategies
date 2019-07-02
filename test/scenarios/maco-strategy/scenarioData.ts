import { BigNumber } from 'set-protocol-utils';

import CONSTANTS from '../constants';

import {
  BidTxn,
  GeneralRebalancingData,
  MACOInitializationParameters,
  IssuanceTxn,
  IssuanceSchedule,
  FullRebalanceProgram,
  SingleRebalanceCycleScenario,
  TokenPrices
} from './types';

export function getScenarioData(accounts): FullRebalanceProgram {
  const initializationParams: MACOInitializationParameters = getInitializationData();

  const generalRebalancingData: GeneralRebalancingData = {
    stableCollateralSets: [],
    riskCollateralSets: [],
    minimumBid: new BigNumber(0),
    initialRemainingSets: new BigNumber(0),
  };
  const cycleData = getCycleData(accounts);
  const rebalanceIterations = 3;

  return {
    rebalanceIterations,
    initializationParams,
    generalRebalancingData,
    cycleData,
  };
}

function getCycleData(accounts): SingleRebalanceCycleScenario[] {
  // Bid Assumptions
  const BID_ONE_PRICE = new BigNumber(0.004776);
  const BID_TWO_PRICE = new BigNumber(0.019102);
  const BID_ONE_QUANTITY = new BigNumber(0.5);
  const BID_TWO_QUANTITY = new BigNumber(0.5);

  // Rebalancing Cycle 1
  const issueRedeemScheduleOne: IssuanceSchedule = {
    issuances: [],
    redemptions: [],
  };
  const intermediatePxChangeOne = [];
  const priceUpdateOne: TokenPrices = {
    StableAssetPrice: CONSTANTS.USDC.PRICE,
    RiskAssetPrice: new BigNumber(504 * 10 ** 18),
  };
  const bidTxnOne: BidTxn = {
    sender: accounts[1],
    amount: BID_ONE_QUANTITY,
    price: BID_ONE_PRICE,
  };
  const bidTxnTwo: BidTxn = {
    sender: accounts[2],
    amount: BID_TWO_QUANTITY,
    price: BID_TWO_PRICE,
  };
  const biddingScheduleOne: BidTxn[] = [bidTxnOne, bidTxnTwo];
  const cycleScenarioOne: SingleRebalanceCycleScenario = {
    issueRedeemSchedule: issueRedeemScheduleOne,
    intermediatePriceChanges: intermediatePxChangeOne,
    priceUpdate: priceUpdateOne,
    biddingSchedule: biddingScheduleOne,
  };

  // Rebalancing Cycle 2
  const issueTxnOne: IssuanceTxn = {
    sender: accounts[5],
    amount: new BigNumber(10 ** 21),
  };
  const redeemTxnOne: IssuanceTxn = {
    sender: accounts[6],
    amount: new BigNumber(5 * 10 ** 16),
  };
  const issueRedeemScheduleTwo: IssuanceSchedule = {
    issuances: [issueTxnOne],
    redemptions: [redeemTxnOne],
  };
  const intermediatePxChangeTwo = [
    new BigNumber(478 * 10 ** 18),
    new BigNumber(455 * 10 ** 18),
    new BigNumber(432 * 10 ** 18),
    new BigNumber(410 * 10 ** 18),
    new BigNumber(390 * 10 ** 18),
    new BigNumber(370 * 10 ** 18),
    new BigNumber(352 * 10 ** 18),
    new BigNumber(334 * 10 ** 18),
    new BigNumber(318 * 10 ** 18),
    new BigNumber(381 * 10 ** 18),
    new BigNumber(457 * 10 ** 18),
  ];
  const priceUpdateTwo: TokenPrices = {
    StableAssetPrice: CONSTANTS.USDC.PRICE,
    RiskAssetPrice: new BigNumber(594 * 10 ** 18),
  };
  const cycleTwoBidTxnOne: BidTxn = {
    sender: accounts[3],
    amount: new BigNumber(0.2),
    price: new BigNumber(-0.005),
  };
  const cycleTwoBidTxnTwo: BidTxn = {
    sender: accounts[4],
    amount: new BigNumber(0.6),
    price: new BigNumber(0.01),
  };
  const cycleTwoBidTxnThree: BidTxn = {
    sender: accounts[2],
    amount: new BigNumber(0.2),
    price: new BigNumber(0.015),
  };
  const biddingScheduleTwo: BidTxn[] = [cycleTwoBidTxnOne, cycleTwoBidTxnTwo, cycleTwoBidTxnThree];
  const cycleScenarioTwo: SingleRebalanceCycleScenario = {
    issueRedeemSchedule: issueRedeemScheduleTwo,
    intermediatePriceChanges: intermediatePxChangeTwo,
    priceUpdate: priceUpdateTwo,
    biddingSchedule: biddingScheduleTwo,
  };

  // Rebalancing Cycle 3
  const issueRedeemScheduleThree: IssuanceSchedule = {
    issuances: [],
    redemptions: [],
  };
  const intermediatePxChangeThree = [
    new BigNumber(713 * 10 ** 18),
    new BigNumber(856 * 10 ** 18),
    new BigNumber(1030 * 10 ** 18),
    new BigNumber(1230 * 10 ** 18),
    new BigNumber(1480 * 10 ** 18),
    new BigNumber(1770 * 10 ** 18),
    new BigNumber(2130 * 10 ** 18),
    new BigNumber(2560 * 10 ** 18),
    new BigNumber(3070 * 10 ** 18),
    new BigNumber(3680 * 10 ** 18),
    new BigNumber(2940 * 10 ** 18),
    new BigNumber(2360 * 10 ** 18),
    new BigNumber(1880 * 10 ** 18),
    new BigNumber(1510 * 10 ** 18),
  ];
  const priceUpdateThree: TokenPrices = {
    StableAssetPrice: CONSTANTS.USDC.PRICE,
    RiskAssetPrice: new BigNumber(1210 * 10 ** 18),
  };
  const cycleThreeBidTxnOne: BidTxn = {
    sender: accounts[3],
    amount: new BigNumber(0.2),
    price: new BigNumber(-0.005),
  };
  const cycleThreeBidTxnTwo: BidTxn = {
    sender: accounts[4],
    amount: new BigNumber(0.6),
    price: new BigNumber(0.01),
  };
  const cycleThreeBidTxnThree: BidTxn = {
    sender: accounts[2],
    amount: new BigNumber(0.2),
    price: new BigNumber(0.015),
  };
  const biddingScheduleThree: BidTxn[] = [cycleThreeBidTxnOne, cycleThreeBidTxnTwo, cycleThreeBidTxnThree];
  const cycleScenarioThree: SingleRebalanceCycleScenario = {
    issueRedeemSchedule: issueRedeemScheduleThree,
    intermediatePriceChanges: intermediatePxChangeThree,
    priceUpdate: priceUpdateThree,
    biddingSchedule: biddingScheduleThree,
  };

  return [cycleScenarioOne, cycleScenarioTwo, cycleScenarioThree];
}

function getInitializationData(): MACOInitializationParameters {
  const initialTokenPrices: TokenPrices = {
    RiskAssetPrice: new BigNumber(530 * 10 ** 18),
    StableAssetPrice: CONSTANTS.USDC.PRICE,
  };

  // Rebalancing Set Details
  const RISK_ASSET_PRICE_IN_DOLLARS = initialTokenPrices.RiskAssetPrice.div(10 ** 18).round(0, 3);
  const REBALANCING_SET_NATURAL_UNIT = new BigNumber(10 ** 10);
  const REBALANCING_SET_UNIT_SHARES = new BigNumber(100)
                                        .div(RISK_ASSET_PRICE_IN_DOLLARS)
                                        .mul(REBALANCING_SET_NATURAL_UNIT)
                                        .round(0, 3);

  // Initial Stable Collateral
  const initialStableCollateralNaturalUnit = new BigNumber(10 ** 12);
  const initialStableCollateralUnits = [new BigNumber(250)];

  // Initial Risk Collateral
  const initialRiskCollateralNaturalUnit = new BigNumber(10 ** 6);
  const initialRiskCollateralUnits = [new BigNumber(10 ** 6)];

  // Issue Quantity
  const initialCollateralIssueQuantity = new BigNumber(10 ** 18);
  const UNROUNDED_REBALANCING_SET_ISSUE_QUANTITY = initialCollateralIssueQuantity
                                                  .mul(REBALANCING_SET_NATURAL_UNIT)
                                                  .div(REBALANCING_SET_UNIT_SHARES);

  // Round the number to a certain precision w/o rounding up
  const REBALANCING_SET_ISSUE_QUANTITY = UNROUNDED_REBALANCING_SET_ISSUE_QUANTITY
    .minus(UNROUNDED_REBALANCING_SET_ISSUE_QUANTITY
    .modulo(REBALANCING_SET_NATURAL_UNIT));

  // Rebalancing Details
  const REBALANCE_INTERVAL = new BigNumber(28).mul(CONSTANTS.SECONDS_PER_DAY);
  const PROPOSAL_PERIOD = new BigNumber(1).mul(CONSTANTS.SECONDS_PER_DAY);
  const TIME_TO_PIVOT = CONSTANTS.SECONDS_PER_DAY.div(6);
  const PRICE_DIVISOR = new BigNumber(1000);
  const MOVING_AVERAGE_DAYS = new BigNumber(20);
  const seededValues = [
    new BigNumber(346 * 10 ** 18),
    new BigNumber(363 * 10 ** 18),
    new BigNumber(382 * 10 ** 18),
    new BigNumber(401 * 10 ** 18),
    new BigNumber(421 * 10 ** 18),
    new BigNumber(442 * 10 ** 18),
    new BigNumber(464 * 10 ** 18),
    new BigNumber(487 * 10 ** 18),
    new BigNumber(511 * 10 ** 18),
    new BigNumber(537 * 10 ** 18),
    new BigNumber(564 * 10 ** 18),
    new BigNumber(592 * 10 ** 18),
    new BigNumber(622 * 10 ** 18),
    new BigNumber(653 * 10 ** 18),
    new BigNumber(685 * 10 ** 18),
    new BigNumber(651 * 10 ** 18),
    new BigNumber(619 * 10 ** 18),
    new BigNumber(588 * 10 ** 18),
    new BigNumber(558 * 10 ** 18),
  ];

  const crossoverConfirmationBounds = [
    CONSTANTS.SECONDS_PER_DAY.div(4),
    CONSTANTS.SECONDS_PER_DAY.div(2),
  ];

  return {
    initialTokenPrices,
    initialStableCollateralUnits,
    initialStableCollateralNaturalUnit,
    initialRiskCollateralUnits,
    initialRiskCollateralNaturalUnit,
    initialCollateralIssueQuantity,
    rebalancingSetIssueQuantity: REBALANCING_SET_ISSUE_QUANTITY,
    rebalancingSetUnitShares: [REBALANCING_SET_UNIT_SHARES],
    rebalancingSetNaturalUnit: REBALANCING_SET_NATURAL_UNIT,
    movingAverageDays: MOVING_AVERAGE_DAYS,
    proposalPeriod: PROPOSAL_PERIOD,
    rebalanceInterval: REBALANCE_INTERVAL,
    auctionTimeToPivot: TIME_TO_PIVOT,
    priceDivisor: PRICE_DIVISOR,
    seededValues,
    crossoverConfirmationBounds,
  } as MACOInitializationParameters;
}

