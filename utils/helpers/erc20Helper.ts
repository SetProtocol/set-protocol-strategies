import * as _ from 'lodash';
import { Address } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';

import {
  StandardTokenMockContract,
  WethMockContract,
} from 'set-protocol-contracts';

import {
  USDCMockContract,
} from '../contracts';

import {
  DEFAULT_GAS,
  DEFAULT_MOCK_TOKEN_DECIMALS,
  DEPLOYED_TOKEN_QUANTITY,
  UNLIMITED_ALLOWANCE_IN_BASE_UNITS,
} from '../constants';
import {
  getContractInstance,
  importArtifactsFromSource
} from '../web3Helper';

const USDCMock = importArtifactsFromSource('USDCMock');
const StandardTokenMock = importArtifactsFromSource('StandardTokenMock');

export class ERC20Helper {
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
    tokens: (StandardTokenMockContract | WethMockContract | USDCMockContract)[],
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
        getContractInstance(StandardTokenMock, tokenAddress),
        { from: this._senderAccountAddress },
      )
    );

    return tokenPromises;
  }

  public async getTokenInstanceAsync(
    token: Address,
  ): Promise<StandardTokenMockContract> {
    return new StandardTokenMockContract(
      getContractInstance(StandardTokenMock, token),
      { from: this._senderAccountAddress },
    );
  }

  public async deployUSDCTokenAsync(
    initialAccount: Address,
    initialTokenAmount: BigNumber = DEPLOYED_TOKEN_QUANTITY,
  ): Promise<USDCMockContract> {
    const truffleMockToken = await USDCMock.new(
      initialAccount,
      initialTokenAmount,
      'Mock Token',
      'MOCK',
      { from: this._senderAccountAddress, gas: DEFAULT_GAS },
    );

    return new USDCMockContract(
      getContractInstance(truffleMockToken),
      { from: this._senderAccountAddress, gas: DEFAULT_GAS },
    );
  }

  public async deployTokenAsync(
    initialAccount: Address,
    decimals: number = DEFAULT_MOCK_TOKEN_DECIMALS,
    initialTokenAmount: BigNumber = DEPLOYED_TOKEN_QUANTITY,
  ): Promise<StandardTokenMockContract> {
    const truffleMockToken = await StandardTokenMock.new(
      initialAccount,
      initialTokenAmount,
      'Mock Token',
      'MOCK',
      decimals,
      { from: this._senderAccountAddress, gas: DEFAULT_GAS },
    );

    return new StandardTokenMockContract(
      new web3.eth.Contract(truffleMockToken.abi, truffleMockToken.address),
      { from: this._senderAccountAddress },
    );
  }
}
