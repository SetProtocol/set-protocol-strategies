import { Address, Log } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';

export function LogManagerProposal(
  ethPrice: BigNumber,
  movingAveragePrice: BigNumber,
  contractAddress: Address,
): Log[] {
  return [{
    event: 'LogManagerProposal',
    address: contractAddress,
    args: {
      ethPrice,
      movingAveragePrice,
    },
  }];
}