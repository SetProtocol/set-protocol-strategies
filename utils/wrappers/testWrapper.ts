import * as _ from 'lodash';
import { Address } from 'set-protocol-utils';

import { HelloWorldContract } from '../contracts';
import { getWeb3 } from '../web3Helper';

const web3 = getWeb3();
const HelloWorld = artifacts.require('HelloWorld');

export class TestWrapper {
  private _contractOwnerAddress: Address;

  constructor(contractOwnerAddress: Address) {
    this._contractOwnerAddress = contractOwnerAddress;
  }

  /* ============ Deployment ============ */

  public async deployHelloWorld(
    from: Address = this._contractOwnerAddress
  ): Promise<HelloWorldContract> {
    const helloWorld = await HelloWorld.new(
      { from },
    );

    return new HelloWorldContract(
      new web3.eth.Contract(helloWorld.abi, helloWorld.address),
      { from },
    );
  }
}
