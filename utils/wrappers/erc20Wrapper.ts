import * as _ from 'lodash';
import { Address } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';

import { SetTokenContract } from 'set-protocol-contracts';

import {
  StandardTokenMockContract,
  WethMockContract,
} from '../contracts';

import {
  DEFAULT_GAS,
  DEFAULT_MOCK_TOKEN_DECIMALS,
  DEPLOYED_TOKEN_QUANTITY,
  UNLIMITED_ALLOWANCE_IN_BASE_UNITS,
} from '../constants';
import {
  getWeb3,
} from '../web3Helper';

const web3 = getWeb3();

const StandardTokenMock = artifacts.require('StandardTokenMock');
const WethMock = artifacts.require('WethMock');


export class ERC20Wrapper {
  private _senderAccountAddress: Address;

  constructor(senderAccountAddress: Address) {
    this._senderAccountAddress = senderAccountAddress;
  }

  /* ============ Deployment ============ */

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

  public async deployTokensAsync(
    tokenCount: number,
    initialAccount: Address,
  ): Promise<StandardTokenMockContract[]> {
    const mockTokens: StandardTokenMockContract[] = [];
    const mockTokenPromises = _.times(tokenCount, async index => {
      return await StandardTokenMock.new(
        initialAccount,
        DEPLOYED_TOKEN_QUANTITY,
        `Component ${index}`,
        index.toString(),
        _.random(4, 18),
        { from: this._senderAccountAddress, gas: DEFAULT_GAS },
      );
    });

    await Promise.all(mockTokenPromises).then(tokenMocks => {
      _.each(tokenMocks, standardToken => {
        mockTokens.push(new StandardTokenMockContract(
          new web3.eth.Contract(standardToken.abi, standardToken.address),
          { from: this._senderAccountAddress }
        ));
      });
    });

    return mockTokens;
  }

  public async deployWrappedEtherAsync(
    initialAccount: Address,
    initialTokenAmount: BigNumber = DEPLOYED_TOKEN_QUANTITY,
  ): Promise<WethMockContract> {
    const truffleMockToken = await WethMock.new(
      initialAccount,
      initialTokenAmount,
      { from: this._senderAccountAddress, gas: DEFAULT_GAS },
    );

    return new WethMockContract(
      new web3.eth.Contract(truffleMockToken.abi, truffleMockToken.address),
      { from: this._senderAccountAddress },
    );
  }

  public async approveTransferAsync(
    token: StandardTokenMockContract,
    to: Address,
    from: Address = this._senderAccountAddress,
  ) {
    await this.approveTransfersAsync([token], to, from);
  }

  public async approveTransfersAsync(
    tokens: (StandardTokenMockContract | WethMockContract | SetTokenContract)[],
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
