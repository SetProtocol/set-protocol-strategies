require('module-alias/register');

import * as _ from 'lodash';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import { Blockchain } from '@utils/blockchain';
// import { expectRevertError } from '@utils/tokenAssertions';
import { getWeb3 } from '@utils/web3Helper';


BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const blockchain = new Blockchain(web3);

contract('DailyPriceDataBank', accounts => {

  before(async () => {
  });

  after(async () => {
  });

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {

    beforeEach(async () => {
    });

    async function subject(): Promise<void> {
    }

    it('sets dai address', async () => {
      await subject();
    });
  });
});