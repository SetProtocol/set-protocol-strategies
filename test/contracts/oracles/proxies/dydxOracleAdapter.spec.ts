require('module-alias/register');

import * as _ from 'lodash';
import * as chai from 'chai';

import { Address } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import { Blockchain } from '@utils/blockchain';

import {
  DydxConstantPriceOracleMockContract,
  DydxOracleAdapterContract,
  USDCMockContract,
} from '@utils/contracts';

import { getWeb3 } from '@utils/web3Helper';

import { OracleHelper } from '@utils/helpers/oracleHelper';
import { ERC20Helper } from '@utils/helpers/erc20Helper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);

contract('dydxOracleAdapter', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let customOracleValue: BigNumber;
  let dydxConstantPriceOracleMock: DydxConstantPriceOracleMockContract;
  let customErc20Token: USDCMockContract;

  let dydxOracleAdapter: DydxOracleAdapterContract;


  const oracleHelper = new OracleHelper(deployerAccount);
  const erc20Helper = new ERC20Helper(deployerAccount);

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    // Deploy custom oracle that conforms to dYdX interface
    customOracleValue = new BigNumber(10 ** 6);
    dydxConstantPriceOracleMock = await oracleHelper.deployDydxConstantPriceOracleMockAsync(
      customOracleValue
    );

    customErc20Token = await erc20Helper.deployUSDCTokenAsync(deployerAccount);
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectDydxOracleAddress: Address;
    let subjectCustomTokenAddress: Address;

    beforeEach(async () => {
      subjectDydxOracleAddress = dydxConstantPriceOracleMock.address;
      subjectCustomTokenAddress = customErc20Token.address;
    });

    async function subject(): Promise<DydxOracleAdapterContract> {
      return oracleHelper.deployDydxOracleAdapterAsync(
        subjectDydxOracleAddress,
        subjectCustomTokenAddress,
      );
    }

    it('sets the correct dYdX Oracle Address', async () => {
      dydxOracleAdapter = await subject();

      const actualDydxOracleAddress = await dydxOracleAdapter.dYdXOracleInstance.callAsync();

      expect(actualDydxOracleAddress).to.be.bignumber.equal(subjectDydxOracleAddress);
    });

    it('sets the correct underlying ERC20 Token Address', async () => {
      dydxOracleAdapter = await subject();

      const actualTokenAddress = await dydxOracleAdapter.erc20TokenAddress.callAsync();

      expect(actualTokenAddress).to.be.bignumber.equal(subjectCustomTokenAddress);
    });
  });

  describe('#read', async () => {
    let subjectTokenPrice: BigNumber;

    beforeEach(async () => {
      subjectTokenPrice = customOracleValue;
      dydxOracleAdapter = await oracleHelper.deployDydxOracleAdapterAsync(
        dydxConstantPriceOracleMock.address,
        customErc20Token.address,
      );
    });

    async function subject(): Promise<BigNumber> {
      return dydxOracleAdapter.read.callAsync();
    }

    it('returns the correct price in uint256', async () => {
      const actualTokenPrice = await subject();
      expect(actualTokenPrice).to.be.bignumber.equal(subjectTokenPrice);
      expect(actualTokenPrice).to.be.an('object');
    });
  });
});