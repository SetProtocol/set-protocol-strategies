require('module-alias/register');

import * as _ from 'lodash';
import * as chai from 'chai';

import { Address } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import { Blockchain } from '@utils/blockchain';
import { ether } from '@utils/units';
import {
  ConstantPriceOracleContract,
  CTokenOracleContract,
  USDCMockContract,
} from '@utils/contracts';
import { getWeb3 } from '@utils/web3Helper';

import { ERC20Helper } from '@utils/helpers/erc20Helper';
import { OracleHelper } from '@utils/helpers/oracleHelper';
import { CompoundHelper } from '@utils/helpers/compoundHelper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);

contract('CTokenOracle', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let usdc: USDCMockContract;
  let usdcOracle: ConstantPriceOracleContract;
  let cUSDCAddress: string;
  let cTokenOracle: CTokenOracleContract;

  const usdcPrice = ether(1);
  const oracleName = 'cUSDC Oracle';

  const erc20Helper = new ERC20Helper(deployerAccount);
  const oracleHelper = new OracleHelper(deployerAccount);
  const compoundHelper = new CompoundHelper(deployerAccount);

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    usdc = await erc20Helper.deployUSDCTokenAsync(deployerAccount);
    usdcOracle = await oracleHelper.deployConstantPriceOracleAsync(usdcPrice);
    cUSDCAddress = await compoundHelper.deployMockCUSDC(usdc.address, deployerAccount);
    cTokenOracle = await oracleHelper.deployCTokenOracleAsync(
      cUSDCAddress,
      usdcOracle.address,
      oracleName,
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectCToken: Address;
    let subjectUnderlyingOracle: Address;
    let subjectDataDescription: string;

    beforeEach(async () => {
      subjectCToken = cUSDCAddress;
      subjectUnderlyingOracle = usdcOracle.address;
      subjectDataDescription = 'ETHDailyRSI';
    });

    async function subject(): Promise<CTokenOracleContract> {
      return oracleHelper.deployCTokenOracleAsync(
        subjectCToken,
        subjectUnderlyingOracle,
        subjectDataDescription
      );
    }

    it('sets the correct cToken address', async () => {
      cTokenOracle = await subject();
      const cTokenAddress = await cTokenOracle.cToken.callAsync();
      expect(cTokenAddress).to.equal(subjectCToken);
    });

    it('sets the correct cToken address', async () => {
      cTokenOracle = await subject();
      const underlyingOracleAddress = await cTokenOracle.underlyingOracle.callAsync();
      expect(underlyingOracleAddress).to.equal(subjectUnderlyingOracle);
    });

    it('sets the correct data description', async () => {
      cTokenOracle = await subject();
      const actualDataDescription = await cTokenOracle.dataDescription.callAsync();
      expect(actualDataDescription).to.equal(subjectDataDescription);
    });
  });

  describe('#read', async () => {

    beforeEach(async () => {
    });

    async function subject(): Promise<BigNumber> {
      return cTokenOracle.read.callAsync();
    }

    it('returns the correct cTokenValue', async () => {
      const result = await subject();

      const exchangeRate = await compoundHelper.getExchangeRate(cUSDCAddress);

      // Price USDC / 1 USDC (10 ** 6)
      // USDC / cToken * 10 ** 18
      const expectedResult = ether(1).mul(exchangeRate).div(ether(1));

      expect(result).to.be.bignumber.equal(expectedResult);
    });
  });
});