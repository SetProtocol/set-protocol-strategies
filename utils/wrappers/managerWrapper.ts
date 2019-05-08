import * as _ from 'lodash';
import * as setProtocolUtils from 'set-protocol-utils';
import { Address } from 'set-protocol-utils';

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
}
