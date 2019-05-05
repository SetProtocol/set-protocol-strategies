import { DeployedAddresses } from 'set-protocol-contracts';
const snapshotNetwork = '50-production-snapshot';

export const getDeployedAddress = contractName => {
  return DeployedAddresses[snapshotNetwork]['addresses'][contractName];
};