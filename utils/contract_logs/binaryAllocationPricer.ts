
import { Address, Log } from 'set-protocol-utils';

interface NewCollateralArgs {
    _hashId: Address;
    _collateralAddress: Address;
}

/********** Other Log Utilities **********/

export function extractNewCollateralFromLogs(
  logs: Log[],
): [string, Address] {
  const createLog = logs[logs.length - 1];
  const args: NewCollateralArgs = createLog.args;

  return [args._hashId, args._collateralAddress];
}