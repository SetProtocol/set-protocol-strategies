import { Address, Log } from 'set-protocol-utils';

 export function LogOracleUpdated(
  newOracleAddress: Address,
  contractAddress: Address
): Log[] {
  return [{
    event: 'LogOracleUpdated',
    address: contractAddress,
    args: {
      newOracleAddress,
    },
  }];
}