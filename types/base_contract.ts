import { BaseContract } from "set-protocol-contracts";

export const CONTRACT_WRAPPER_ERRORS = {
  CONTRACT_NOT_FOUND_ON_NETWORK: (contractName: string, networkId: number) =>
  `Unable to find address for contract ${contractName} on network with id ${networkId}`,
};

export { BaseContract };