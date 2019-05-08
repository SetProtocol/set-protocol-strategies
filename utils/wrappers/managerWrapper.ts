import * as _ from 'lodash';
import * as setProtocolUtils from 'set-protocol-utils';
import { Address } from 'set-protocol-utils';

import { SetTokenContract } from 'set-protocol-contracts';

import {
  BTCETHRebalancingManagerContract,
} from '../contracts';
import { BigNumber } from 'bignumber.js';

import {
  DEFAULT_GAS,
  DEFAULT_REBALANCING_NATURAL_UNIT,
  DEFAULT_UNIT_SHARES,
  ONE_DAY_IN_SECONDS,
  UNLIMITED_ALLOWANCE_IN_BASE_UNITS,
  DEFAULT_AUCTION_PRICE_NUMERATOR,
  DEFAULT_AUCTION_PRICE_DIVISOR,
} from '../constants';
import { extractNewSetTokenAddressFromLogs } from '../contract_logs/core';

import { Blockchain } from '../blockchain';
import { getWeb3 } from '../web3Helper';

const web3 = getWeb3();
const BTCETHRebalancingManager = artifacts.require('BTCETHRebalancingManager');

const { SetProtocolTestUtils: SetTestUtils, SetProtocolUtils: SetUtils } = setProtocolUtils;
const setTestUtils = new SetTestUtils(web3);
const {
  SET_FULL_TOKEN_UNITS,
  WBTC_FULL_TOKEN_UNITS,
  WETH_FULL_TOKEN_UNITS,
} = SetUtils.CONSTANTS;

export class ManagerWrapper {
  private _tokenOwnerAddress: Address;

  constructor(
    tokenOwnerAddress: Address,
  ) {
    this._tokenOwnerAddress = tokenOwnerAddress;
  }

  /* ============ Rebalancing Token Manager ============ */

  public async deployBTCETHRebalancingManagerAsync(
    coreAddress: Address,
    btcPriceFeedAddress: Address,
    ethPriceFeedAddress: Address,
    btcAddress: Address,
    ethAddress: Address,
    setTokenFactoryAddress: Address,
    auctionLibrary: Address,
    auctionTimeToPivot: BigNumber = new BigNumber(100000),
    multiplers: BigNumber[],
    allocationBounds: BigNumber[],
    from: Address = this._tokenOwnerAddress
  ): Promise<BTCETHRebalancingManagerContract> {
    const truffleRebalacingTokenManager = await BTCETHRebalancingManager.new(
      coreAddress,
      btcPriceFeedAddress,
      ethPriceFeedAddress,
      btcAddress,
      ethAddress,
      setTokenFactoryAddress,
      auctionLibrary,
      auctionTimeToPivot,
      multiplers,
      allocationBounds,
      { from },
    );

    return new BTCETHRebalancingManagerContract(
      new web3.eth.Contract(truffleRebalacingTokenManager.abi, truffleRebalacingTokenManager.address),
      { from, gas: DEFAULT_GAS },
    );
  }

  public getExpectedBtcEthNextSetParameters(
    btcPrice: BigNumber,
    ethPrice: BigNumber,
    btcMultiplier: BigNumber,
    ethMultiplier: BigNumber,
  ): any {
    let units: BigNumber[];
    let naturalUnit: BigNumber;
    if (btcPrice.greaterThanOrEqualTo(ethPrice)) {
      const ethUnits = btcPrice.mul(new BigNumber(10 ** 10)).div(ethPrice).round(0, 3);
      units = [new BigNumber(1).mul(btcMultiplier), ethUnits.mul(ethMultiplier)];
      naturalUnit = new BigNumber(10 ** 10);
    } else {
      const btcUnits = ethPrice.mul(new BigNumber(100)).mul(btcMultiplier).div(btcPrice).round(0, 3);
      const ethUnits = new BigNumber(100).mul(new BigNumber(10 ** 10)).mul(ethMultiplier);
      units = [btcUnits, ethUnits];
      naturalUnit = new BigNumber(10 ** 12);
    }

    return {
      units,
      naturalUnit,
    };
  }

  public async getExpectedBtcEthAuctionParameters(
    btcPrice: BigNumber,
    ethPrice: BigNumber,
    btcMultiplier: BigNumber,
    ethMultiplier: BigNumber,
    auctionTimeToPivot: BigNumber,
    currentSetToken: SetTokenContract,
  ): Promise<any> {
    const THIRTY_MINUTES_IN_SECONDS = new BigNumber(30 * 60);
    const BTC_DECIMALS = WBTC_FULL_TOKEN_UNITS;
    const ETH_DECIMALS = WETH_FULL_TOKEN_UNITS;

    const nextSetParams = this.getExpectedBtcEthNextSetParameters(
      btcPrice,
      ethPrice,
      btcMultiplier,
      ethMultiplier,
    );

    const currentSetNaturalUnit = await currentSetToken.naturalUnit.callAsync();
    const currentSetUnits = await currentSetToken.getUnits.callAsync();

    const currentSetDollarAmount = this.computeTokenValue(
      currentSetUnits,
      currentSetNaturalUnit,
      btcPrice,
      ethPrice,
      BTC_DECIMALS,
      ETH_DECIMALS,
    );

    const nextSetDollarAmount = this.computeTokenValue(
      nextSetParams['units'],
      nextSetParams['naturalUnit'],
      btcPrice,
      ethPrice,
      BTC_DECIMALS,
      ETH_DECIMALS,
    );

    const fairValue = nextSetDollarAmount.div(currentSetDollarAmount).mul(1000).round(0, 3);
    const onePercentSlippage = fairValue.div(100).round(0, 3);

    const thirtyMinutePeriods = auctionTimeToPivot.div(THIRTY_MINUTES_IN_SECONDS).round(0, 3);
    const halfPriceRange = thirtyMinutePeriods.mul(onePercentSlippage).div(2).round(0, 3);

    const auctionStartPrice = fairValue.sub(halfPriceRange);
    const auctionPivotPrice = fairValue.add(halfPriceRange);

    return {
      auctionStartPrice,
      auctionPivotPrice,
    };
  }

  private computeTokenValue(
    units: BigNumber[],
    naturalUnit: BigNumber,
    tokenOnePrice: BigNumber,
    tokenTwoPrice: BigNumber,
    tokenOneDecimals: BigNumber,
    tokenTwoDecimals: BigNumber,
  ): BigNumber {
    const tokenOneUnitsInFullToken = SET_FULL_TOKEN_UNITS.mul(units[0]).div(naturalUnit).round(0, 3);
    const tokenTwoUnitsInFullToken = SET_FULL_TOKEN_UNITS.mul(units[1]).div(naturalUnit).round(0, 3);

    const tokenOneDollarAmount = this.computeTokenDollarAmount(
      tokenOnePrice,
      tokenOneUnitsInFullToken,
      tokenOneDecimals
    );
    const tokenTwoDollarAmount = this.computeTokenDollarAmount(
      tokenTwoPrice,
      tokenTwoUnitsInFullToken,
      tokenTwoDecimals
    );

    return tokenOneDollarAmount.add(tokenTwoDollarAmount);
  }

  private computeTokenDollarAmount(
    tokenPrice: BigNumber,
    unitsInFullSet: BigNumber,
    tokenDecimals: BigNumber,
  ): BigNumber {
    const VALUE_TO_CENTS_CONVERSION = new BigNumber(10 ** 16);

    return tokenPrice
             .mul(unitsInFullSet)
             .div(tokenDecimals)
             .div(VALUE_TO_CENTS_CONVERSION)
             .round(0, 3);
  }
}
