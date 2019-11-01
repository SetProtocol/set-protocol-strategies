import { BigNumber } from 'bignumber.js';
import { Address, Log } from 'set-protocol-utils';

export function LogTriggerFlipped(
  _flipTo: boolean,
  _triggerFlippedIndex: BigNumber,
  _timestamp: BigNumber,
  _contractAddress: Address,
): Log[] {
  return [{
    event: 'TriggerFlipped',
    address: _contractAddress,
    args: {
      _flipTo,
      _triggerFlippedIndex,
      _timestamp,
    },
  }];
}