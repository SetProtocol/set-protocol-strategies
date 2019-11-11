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
  TwoAssetRatioOracleContract
} from '@utils/contracts';
import { getWeb3 } from '@utils/web3Helper';

import { OracleHelper } from '@utils/helpers/oracleHelper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;

contract('TwoAssetRatioOracle', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let ethMedianizer: MedianContract;
  let btcMedianizer: MedianContract;

  let ethPrice: BigNumber;
  let btcPrice: BigNumber;

  let twoAssetRatioOracle: TwoAssetRatioOracleContract;

  const oracleHelper = new OracleHelper(deployerAccount);

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    ethMedianizer = await oracleHelper.deployMedianizerAsync();
    btcMedianizer = await oracleHelper.deployMedianizerAsync();

    await oracleHelper.addPriceFeedOwnerToMedianizer(ethMedianizer, deployerAccount);
    await oracleHelper.addPriceFeedOwnerToMedianizer(btcMedianizer, deployerAccount);

    ethPrice = ether(150.125);
    btcPrice = ether(8200.567);

    await oracleHelper.updateMedianizerPriceAsync(
      ethMedianizer,
      ethPrice,
      SetTestUtils.generateTimestamp(1000),
    );
    await oracleHelper.updateMedianizerPriceAsync(
      btcMedianizer,
      btcPrice,
      SetTestUtils.generateTimestamp(1000),
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectBaseOracleAddress: Address;
    let subjectQuoteOracleAddress: Address;
    let subjectDataDescription: string;

    beforeEach(async () => {
      subjectBaseOracleAddress = ethMedianizer.address;
      subjectQuoteOracleAddress = btcMedianizer.address;
      subjectDataDescription = 'ETHBTCRatio';
    });

    async function subject(): Promise<TwoAssetRatioOracleContract> {
      return oracleHelper.deployTwoAssetRatioOracleAsync(
        subjectBaseOracleAddress,
        subjectQuoteOracleAddress,
        subjectDataDescription
      );
    }

    it('sets the correct base asset oracle address', async () => {
      twoAssetRatioOracle = await subject();

      const actualOracleAddress = await twoAssetRatioOracle.baseOracleInstance.callAsync();

      expect(actualOracleAddress).to.equal(subjectBaseOracleAddress);
    });

    it('sets the correct base quote oracle address', async () => {
      twoAssetRatioOracle = await subject();

      const actualOracleAddress = await twoAssetRatioOracle.quoteOracleInstance.callAsync();

      expect(actualOracleAddress).to.equal(subjectQuoteOracleAddress);
    });

    it('sets the correct data description', async () => {
      twoAssetRatioOracle = await subject();

      const actualDataDescription = await twoAssetRatioOracle.dataDescription.callAsync();

      expect(actualDataDescription).to.equal(subjectDataDescription);
    });
  });

  describe('#read', async () => {
    beforeEach(async () => {
      const dataDescription = 'ETHBTCRatio';

      return oracleHelper.deployTwoAssetRatioOracleAsync(
        ethMedianizer.address,
        btcMedianizer.address,
        dataDescription
      );
    });

    async function subject(): Promise<BigNumber> {
      return twoAssetRatioOracle.read.callAsync();
    }

    it('returns the correct most recent price on the feed', async () => {
      const actualCurrentPriceRatio = await subject();

      const expectedCurrentPriceRatio = ethPrice.mul(10 ** 18).div(btcPrice).round(0, BigNumber.ROUND_DOWN);

      expect(actualCurrentPriceRatio).to.be.bignumber.equal(expectedCurrentPriceRatio);
    });
  });
});