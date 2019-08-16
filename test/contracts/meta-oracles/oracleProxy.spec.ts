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
  OracleProxyCallerContract,
  OracleProxyContract,
} from '@utils/contracts';
import { DEFAULT_GAS } from '@utils/constants';
import { expectRevertError } from '@utils/tokenAssertions';

import { getWeb3 } from '@utils/web3Helper';

import { OracleWrapper } from '@utils/wrappers/oracleWrapper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);

const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;

contract('OracleProxy', accounts => {
  const [
    deployerAccount,
    newOracleAccount,
    unAuthorizedAccount,
  ] = accounts;

  let ethMedianizer: MedianContract;
  let legacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let oracleProxy: OracleProxyContract;

  const oracleWrapper = new OracleWrapper(deployerAccount);

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    ethMedianizer = await oracleWrapper.deployMedianizerAsync();
    await oracleWrapper.addPriceFeedOwnerToMedianizer(
      ethMedianizer,
      deployerAccount
    );

    // Use adapter to convert medianizer output to uint256
    legacyMakerOracleAdapter = await  oracleWrapper.deployLegacyMakerOracleAdapterAsync(
      ethMedianizer.address,
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectOracleAddress: Address;

    beforeEach(async () => {
      subjectOracleAddress = legacyMakerOracleAdapter.address;
    });

    async function subject(): Promise<OracleProxyContract> {
      return oracleWrapper.deployOracleProxyAsync(
        subjectOracleAddress,
      );
    }

    it('sets the correct interpolationThreshold', async () => {
      oracleProxy = await subject();

      const actualOracleAddress = await oracleProxy.oracleInstance.callAsync();

      expect(actualOracleAddress).to.be.bignumber.equal(subjectOracleAddress);
    });
  });

  describe('#read', async () => {
    let ethPrice: BigNumber;
    let oracleProxyCaller: OracleProxyCallerContract;

    beforeEach(async () => {
      ethPrice = ether(200);
      await oracleWrapper.updateMedianizerPriceAsync(
        ethMedianizer,
        ethPrice,
        SetTestUtils.generateTimestamp(1000)
      );

      oracleProxy = await oracleWrapper.deployOracleProxyAsync(
        legacyMakerOracleAdapter.address,
      );

      oracleProxyCaller = await oracleWrapper.deployOracleProxyCallerAsync(
        oracleProxy.address,
      );

      await oracleWrapper.addAuthorizedAddressesToOracleProxy(
        oracleProxy,
        [oracleProxyCaller.address]
      );
    });

    async function subject(): Promise<BigNumber> {
      return oracleProxyCaller.read.callAsync();
    }

    it('returns the correct price', async () => {
      const actualEthPrice = await subject();

      expect(actualEthPrice).to.be.bignumber.equal(ethPrice);
    });

    describe('when unauthorized address is caller', async () => {
      beforeEach(async () => {
        await oracleProxy.removeAuthorizedAddress.sendTransactionAsync(
          oracleProxyCaller.address,
          { from: deployerAccount, gas: DEFAULT_GAS },
        );
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#changeOracleAddress', async () => {
    let subjectNewOracleAddress: Address;
    let subjectCaller: Address;

    beforeEach(async () => {
      legacyMakerOracleAdapter = await oracleWrapper.deployLegacyMakerOracleAdapterAsync(
        ethMedianizer.address,
      );

      oracleProxy = await oracleWrapper.deployOracleProxyAsync(
        legacyMakerOracleAdapter.address,
      );

      subjectNewOracleAddress = newOracleAccount;
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      return oracleProxy.changeOracleAddress.sendTransactionAsync(
        subjectNewOracleAddress,
        { from: subjectCaller },
      );
    }

    it('returns the correct new oracle address', async () => {
      await subject();

      const actualOracleAddress = await oracleProxy.oracleInstance.callAsync();

      expect(actualOracleAddress).to.be.bignumber.equal(subjectNewOracleAddress);
    });

    describe('when unauthorized address is caller', async () => {
      beforeEach(async () => {
        subjectCaller = unAuthorizedAccount;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('when same address passed in', async () => {
      beforeEach(async () => {
        subjectNewOracleAddress = legacyMakerOracleAdapter.address;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });
});