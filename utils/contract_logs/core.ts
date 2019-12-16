import { BigNumber } from 'bignumber.js';

import { Address, Log } from 'set-protocol-utils';

interface CreateLogArgs {
   _setTokenAddress: Address;
   _factoryAddress: Address;
   _components: Address[];
   _units: BigNumber[];
   _naturalUnit: BigNumber;
   _name: string;
   _symbol: string;
}

/********** Other Log Utilities **********/

export function extractNewSetTokenAddressFromLogs(
  logs: Log[],
  logIndex: number = 1
): Address {
  const createLog = logs[logs.length - logIndex];
  const args: CreateLogArgs = createLog.args;
  return args._setTokenAddress;
}