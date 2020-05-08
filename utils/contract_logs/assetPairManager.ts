import { Address, Bytes, Log } from 'set-protocol-utils';

export function LogInitialProposeCalled(
  rebalancingSetToken: Address,
  contractAddress: Address,
): Log[] {
  return [{
    event: 'InitialProposeCalled',
    address: contractAddress,
    args: {
      rebalancingSetToken,
    },
  }];
}

export function LogNewLiquidatorDataAdded(
  newLiquidatorData: Bytes,
  oldLiquidatorData: Bytes,
  contractAddress: Address,
): Log[] {
  return [{
    event: 'NewLiquidatorDataAdded',
    address: contractAddress,
    args: {
      newLiquidatorData,
      oldLiquidatorData,
    },
  }];
}