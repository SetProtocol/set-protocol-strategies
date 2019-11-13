import { Address, Log } from 'set-protocol-utils';

interface NewCollateralArgs {
    _hash: Address;
    _collateralAddress: Address;
}

/********** Other Log Utilities **********/

export function extractNewCollateralFromLogs(
  logs: Log[],
): [string, Address] {
  const createLog = logs[logs.length - 1];
  const args: NewCollateralArgs = createLog.args;

  return [args._hash, args._collateralAddress];
}

export function LogNewCollateralTracked(
  _hash: string,
  _collateralAddress: Address,
  _contractAddress: Address,
): Log[] {
  return [{
    event: 'NewCollateralTracked',
    address: _contractAddress,
    args: {
      _hash,
      _collateralAddress,
    },
  }];
}