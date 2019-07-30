import { Address, Log } from 'set-protocol-utils';

 export function LogMedianizerUpdated(
  newMedianizerAddress: Address,
  contractAddress: Address
): Log[] {
  return [{
    event: 'LogMedianizerUpdated',
    address: contractAddress,
    args: {
      newMedianizerAddress,
    },
  }];
} 