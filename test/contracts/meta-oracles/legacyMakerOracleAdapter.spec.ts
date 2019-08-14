require('module-alias/register');

import * as _ from 'lodash';
import * as chai from 'chai';
import * as setProtocolUtils from 'set-protocol-utils';

import { Address } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import { Blockchain } from '@utils/blockchain';
import { ether } from '@utils/units';

import { MedianContract } from 'set-protocol-contracts';
import {
  LegacyMakerOracleAdapterContract,
} from '@utils/contracts';

import { getWeb3 } from '@utils/web3Helper';

import { OracleWrapper } from '@utils/wrappers/oracleWrapper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);

const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;

contract('LegacyMakerOracleAdapter', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let ethMedianizer: MedianContract;
  let legacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;

  const oracleWrapper = new OracleWrapper(deployerAccount);

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    ethMedianizer = await oracleWrapper.deployMedianizerAsync();
    await oracleWrapper.addPriceFeedOwnerToMedianizer(
      ethMedianizer,
      deployerAccount
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectMedianizerAddress: Address;

    beforeEach(async () => {
      subjectMedianizerAddress = ethMedianizer.address;
    });

    async function subject(): Promise<LegacyMakerOracleAdapterContract> {
      return oracleWrapper.deployLegacyMakerOracleAdapterAsync(
        subjectMedianizerAddress,
      );
    }

    it('sets the correct interpolationThreshold', async () => {
      legacyMakerOracleAdapter = await subject();

      const actualMedianizerAddress = await legacyMakerOracleAdapter.medianizerAddress.callAsync();

      expect(actualMedianizerAddress).to.be.bignumber.equal(subjectMedianizerAddress);
    });
  });

  describe.only('#read', async () => {
    let ethPrice: BigNumber;

    beforeEach(async () => {
      ethPrice = ether(200);
      await oracleWrapper.updateMedianizerPriceAsync(
        ethMedianizer,
        ethPrice,
        SetTestUtils.generateTimestamp(1000)
      );

      legacyMakerOracleAdapter = await oracleWrapper.deployLegacyMakerOracleAdapterAsync(
        ethMedianizer.address,
      );
    });

    async function subject(): Promise<BigNumber> {
      return legacyMakerOracleAdapter.read.callAsync();
    }

    it('sets the correct interpolationThreshold', async () => {
      const actualEthPrice = await subject();
      const rawMedianizer = await ethMedianizer.read.callAsync();

      expect(actualEthPrice).to.be.bignumber.equal(ethPrice);
      expect(rawMedianizer).to.be.a('string');
      expect(actualEthPrice).to.be.an('object');
    });
  });
});