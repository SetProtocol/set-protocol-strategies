import { Address, Log } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';

export function LogTradingPoolCreated(
  _trader: Address,
  _allocator: Address,
  _tradingPool: Address,
  _startingAllocation: BigNumber,
  contractAddress: Address,
): Log[] {
  return [{
    event: 'TradingPoolCreated',
    address: contractAddress,
    args: {
      _trader,
      _allocator,
      _tradingPool,
      _startingAllocation,
    },
  }];
}

export function LogAllocationUpdate(
  _tradingPool: Address,
  _oldAllocation: BigNumber,
  _newAllocation: BigNumber,
  contractAddress: Address,
): Log[] {
  return [{
    event: 'AllocationUpdate',
    address: contractAddress,
    args: {
      _tradingPool,
      _oldAllocation,
      _newAllocation,
    },
  }];
}

export function LogNewTrader(
  _tradingPool: Address,
  _oldTrader: Address,
  _newTrader: Address,
  contractAddress: Address,
): Log[] {
  return [{
    event: 'NewTrader',
    address: contractAddress,
    args: {
      _tradingPool,
      _oldTrader,
      _newTrader,
    },
  }];
}