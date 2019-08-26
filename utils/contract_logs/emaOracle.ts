import { Address, Log } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';

 export function FeedAdded(
  newFeedAddress: Address,
  emaDays: BigNumber,
  contractAddress: Address
): Log[] {
  return [{
    event: 'FeedAdded',
    address: contractAddress,
    args: {
      newFeedAddress,
      emaDays,
    },
  }];
}

export function FeedRemoved(
  removedFeedAddress: Address,
  emaDays: BigNumber,
  contractAddress: Address
): Log[] {
  return [{
    event: 'FeedRemoved',
    address: contractAddress,
    args: {
      removedFeedAddress,
      emaDays,
    },
  }];
}