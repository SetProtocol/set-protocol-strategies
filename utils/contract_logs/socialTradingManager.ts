import { Address, Log } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';

export function LogTradingPoolCreated(
  trader: Address,
  allocator: Address,
  tradingPool: Address,
  startingAllocation: BigNumber,
  contractAddress: Address,
): Log[] {
  return [{
    event: 'TradingPoolCreated',
    address: contractAddress,
    args: {
      trader,
      allocator,
      tradingPool,
      startingAllocation,
    },
  }];
}

export function LogAllocationUpdate(
  tradingPool: Address,
  oldAllocation: BigNumber,
  newAllocation: BigNumber,
  contractAddress: Address,
): Log[] {
  return [{
    event: 'AllocationUpdate',
    address: contractAddress,
    args: {
      tradingPool,
      oldAllocation,
      newAllocation,
    },
  }];
}

export function LogNewTrader(
  tradingPool: Address,
  oldTrader: Address,
  newTrader: Address,
  contractAddress: Address,
): Log[] {
  return [{
    event: 'NewTrader',
    address: contractAddress,
    args: {
      tradingPool,
      oldTrader,
      newTrader,
    },
  }];
}