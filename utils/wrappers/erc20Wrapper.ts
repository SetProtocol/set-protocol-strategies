import * as _ from 'lodash';
import { Address } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';

import {
  StandardTokenMock,
  StandardTokenMockContract,
  WethMockContract,
} from 'set-protocol-contracts';

import {
  UNLIMITED_ALLOWANCE_IN_BASE_UNITS,
} from '../constants';
import {
  getWeb3,
} from '../web3Helper';

const web3 = getWeb3();

export class ERC20Wrapper {
  private _senderAccountAddress: Address;

  constructor(senderAccountAddress: Address) {
    this._senderAccountAddress = senderAccountAddress;
  }

  /* ============ Deployment ============ */

  public async approveTransferAsync(
    token: StandardTokenMockContract,
    to: Address,
    from: Address = this._senderAccountAddress,
  ) {
    await this.approveTransfersAsync([token], to, from);
  }

  public async approveTransfersAsync(
    tokens: (StandardTokenMockContract | WethMockContract)[],
    to: Address,
    from: Address = this._senderAccountAddress,
  ) {
    const approvePromises = _.map(tokens, token =>
      token.approve.sendTransactionAsync(
        to,
        UNLIMITED_ALLOWANCE_IN_BASE_UNITS,
        { from },
      ),
    );
    await Promise.all(approvePromises);
  }

  public async transferTokenAsync(
    token: StandardTokenMockContract,
    to: Address,
    quantity: BigNumber,
    from: Address = this._senderAccountAddress,
  ) {
    await this.transferTokensAsync([token], to, quantity, from);
  }

  public async transferTokensAsync(
    tokens: (StandardTokenMockContract | WethMockContract)[],
    to: Address,
    amount: BigNumber,
    from: Address = this._senderAccountAddress,
  ) {
    const transferPromises = _.map(tokens, token =>
      token.transfer.sendTransactionAsync(
        to,
        amount,
        { from, gas: 100000 },
      ),
    );
    await Promise.all(transferPromises);
  }

  public async getTokenBalances(
    tokens: StandardTokenMockContract[],
    owner: Address,
  ): Promise<BigNumber[]> {
    const balancePromises = _.map(tokens, token => token.balanceOf.callAsync(owner));

    let balances: BigNumber[];
    await Promise.all(balancePromises).then(fetchedTokenBalances => {
      balances = fetchedTokenBalances;
    });

    return balances;
  }

  public async getTokenAllowances(
    tokens: StandardTokenMockContract[],
    owner: Address,
    spender: Address,
  ): Promise<BigNumber[]> {
    const allowancePromises = _.map(tokens, token => token.allowance.callAsync(owner, spender));

    let allowances: BigNumber[];
    await Promise.all(allowancePromises).then(fetchedAllowances => {
      allowances = fetchedAllowances;
    });

    return allowances;
  }

  public async retrieveTokenInstancesAsync(
    tokens: Address[],
  ): Promise<StandardTokenMockContract[]> {
    const tokenPromises = _.map(
      tokens,
      tokenAddress => new StandardTokenMockContract(
        new web3.eth.Contract(StandardTokenMock.abi, tokenAddress),
        { from: this._senderAccountAddress },
      )
    );

    return tokenPromises;
  }
}
