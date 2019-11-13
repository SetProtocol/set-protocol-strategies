import { Address, Log } from 'set-protocol-utils';

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