require('module-alias/register');

import * as _ from 'lodash';
import * as ABIDecoder from 'abi-decoder';
import * as chai from 'chai';
import * as setProtocolUtils from 'set-protocol-utils';

import { Address } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import { Blockchain } from '@utils/blockchain';
import { ether } from '@utils/units';
import {
  Core,
  CoreContract,
  MedianContract,
  SetTokenContract,
  SetTokenFactoryContract,
  WethMockContract,
  WhiteListContract,
} from 'set-protocol-contracts';
import {
  BinaryAllocationPricerContract,
  ConstantPriceOracleContract,
  LegacyMakerOracleAdapterContract,
  OracleProxyContract,
  USDCMockContract,
} from '@utils/contracts';

import {
  ETH_DECIMALS,
  ONE_DAY_IN_SECONDS,
  RISK_COLLATERAL_NATURAL_UNIT,
  STABLE_COLLATERAL_NATURAL_UNIT,
  USDC_DECIMALS,
  ZERO
} from '@utils/constants';

import { extractNewSetTokenAddressFromLogs } from '@utils/contract_logs/core';
import { expectRevertError } from '@utils/tokenAssertions';
import { getWeb3 } from '@utils/web3Helper';

import { ERC20Helper } from '@utils/helpers/erc20Helper';
import { ManagerHelper } from '@utils/helpers/managerHelper';
import { OracleHelper } from '@utils/helpers/oracleHelper';
import { ProtocolHelper } from '@utils/helpers/protocolHelper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;
const setTestUtils = new SetTestUtils(web3);

contract('BinaryAllocationPricer', accounts => {
  const [
    deployerAccount,
    randomTokenAddress,
  ] = accounts;

  let core: CoreContract;
  let factory: SetTokenFactoryContract;
  let whiteList: WhiteListContract;
  let usdcMock: USDCMockContract;
  let wrappedETH: WethMockContract;

  let usdcOracle: ConstantPriceOracleContract;
  let ethMedianizer: MedianContract;
  let legacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let oracleProxy: OracleProxyContract;

  let baseAssetCollateral: SetTokenContract;
  let quoteAssetCollateral: SetTokenContract;

  let allocationPricer: BinaryAllocationPricerContract;

  let initialEthPrice: BigNumber;
  let usdcPrice: BigNumber;

  const protocolHelper = new ProtocolHelper(deployerAccount);
  const erc20Helper = new ERC20Helper(deployerAccount);
  const managerHelper = new ManagerHelper(deployerAccount);
  const oracleHelper = new OracleHelper(deployerAccount);

  before(async () => {
    ABIDecoder.addABI(Core.abi);
  });

  after(async () => {
    ABIDecoder.removeABI(Core.abi);
  });

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    core = await protocolHelper.getDeployedCoreAsync();

    factory = await protocolHelper.getDeployedSetTokenFactoryAsync();
    whiteList = await protocolHelper.getDeployedWhiteList();

    ethMedianizer = await protocolHelper.getDeployedWETHMedianizerAsync();
    await oracleHelper.addPriceFeedOwnerToMedianizer(ethMedianizer, deployerAccount);

    initialEthPrice = ether(150);
    await oracleHelper.updateMedianizerPriceAsync(
      ethMedianizer,
      initialEthPrice,
      SetTestUtils.generateTimestamp(1000),
    );

    usdcMock = await erc20Helper.deployUSDCTokenAsync(deployerAccount);
    await protocolHelper.addTokenToWhiteList(usdcMock.address, whiteList);
    await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS.mul(7));
    await protocolHelper.addTokenToWhiteList(usdcMock.address, whiteList);

    wrappedETH = await protocolHelper.getDeployedWETHAsync();

    legacyMakerOracleAdapter = await oracleHelper.deployLegacyMakerOracleAdapterAsync(
      ethMedianizer.address,
    );

    oracleProxy = await oracleHelper.deployOracleProxyAsync(
      legacyMakerOracleAdapter.address,
    );

    usdcPrice = ether(1);
    usdcOracle = await oracleHelper.deployConstantPriceOracleAsync(usdcPrice);

    baseAssetCollateral = await protocolHelper.createSetTokenAsync(
      core,
      factory.address,
      [wrappedETH.address],
      [new BigNumber(10 ** 6)],
      RISK_COLLATERAL_NATURAL_UNIT,
    );

    quoteAssetCollateral = await protocolHelper.createSetTokenAsync(
      core,
      factory.address,
      [usdcMock.address],
      [new BigNumber(100)],
      STABLE_COLLATERAL_NATURAL_UNIT,
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectBaseAssetInstance: Address;
    let subjectQuoteAssetInstance: Address;
    let subjectBaseAssetOracleInstance: Address;
    let subjectQuoteAssetOracleInstance: Address;
    let subjectBaseAssetCollateralInstance: Address;
    let subjectQuoteAssetCollateralInstance: Address;
    let subjectCoreInstance: Address;
    let subjectSetTokenFactoryAddress: Address;

    beforeEach(async () => {
      subjectBaseAssetInstance = wrappedETH.address;
      subjectQuoteAssetInstance = usdcMock.address;
      subjectBaseAssetOracleInstance = oracleProxy.address;
      subjectQuoteAssetOracleInstance = usdcOracle.address;
      subjectBaseAssetCollateralInstance = baseAssetCollateral.address;
      subjectQuoteAssetCollateralInstance = quoteAssetCollateral.address;
      subjectCoreInstance = core.address;
      subjectSetTokenFactoryAddress = factory.address;
    });

    async function subject(): Promise<BinaryAllocationPricerContract> {
      return managerHelper.deployBinaryAllocationPricerAsync(
        subjectBaseAssetInstance,
        subjectQuoteAssetInstance,
        subjectBaseAssetOracleInstance,
        subjectQuoteAssetOracleInstance,
        subjectBaseAssetCollateralInstance,
        subjectQuoteAssetCollateralInstance,
        subjectCoreInstance,
        subjectSetTokenFactoryAddress
      );
    }

    it('sets the correct base asset address', async () => {
      allocationPricer = await subject();

      const actualBaseAssetInstance = await allocationPricer.baseAssetInstance.callAsync();

      expect(actualBaseAssetInstance).to.equal(subjectBaseAssetInstance);
    });

    it('sets the correct quote asset address', async () => {
      allocationPricer = await subject();

      const actualQuoteAssetInstance = await allocationPricer.quoteAssetInstance.callAsync();

      expect(actualQuoteAssetInstance).to.equal(subjectQuoteAssetInstance);
    });

    it('sets the correct base asset oracle address', async () => {
      allocationPricer = await subject();

      const actualBaseAssetOracleInstance = await allocationPricer.baseAssetOracleInstance.callAsync();

      expect(actualBaseAssetOracleInstance).to.equal(subjectBaseAssetOracleInstance);
    });

    it('sets the correct quote asset oracle address', async () => {
      allocationPricer = await subject();

      const actualQuoteAssetOracleInstance = await allocationPricer.quoteAssetOracleInstance.callAsync();

      expect(actualQuoteAssetOracleInstance).to.equal(subjectQuoteAssetOracleInstance);
    });

    it('sets the correct base collateral address', async () => {
      allocationPricer = await subject();

      const actualBaseAssetCollateralInstance = await allocationPricer.baseAssetCollateralInstance.callAsync();

      expect(actualBaseAssetCollateralInstance).to.equal(subjectBaseAssetCollateralInstance);
    });

    it('sets the correct quote collateral address', async () => {
      allocationPricer = await subject();

      const actualQuoteAssetCollateralInstance = await allocationPricer.quoteAssetCollateralInstance.callAsync();

      expect(actualQuoteAssetCollateralInstance).to.equal(subjectQuoteAssetCollateralInstance);
    });

    it('sets the correct core address', async () => {
      allocationPricer = await subject();

      const actualCoreAddress = await allocationPricer.coreInstance.callAsync();

      expect(actualCoreAddress).to.equal(subjectCoreInstance);
    });

    it('sets the correct set token factory address', async () => {
      allocationPricer = await subject();

      const actualSetTokenFactoryAddress = await allocationPricer.setTokenFactoryAddress.callAsync();

      expect(actualSetTokenFactoryAddress).to.equal(subjectSetTokenFactoryAddress);
    });

    it('sets the correct base asset decimals', async () => {
      allocationPricer = await subject();

      const actualBaseAssetDecimals = await allocationPricer.baseAssetDecimals.callAsync();
      const expectedBaseAssetDecimals = await wrappedETH.decimals.callAsync();

      expect(actualBaseAssetDecimals).to.be.bignumber.equal(expectedBaseAssetDecimals);
    });

    it('sets the correct quote asset decimals', async () => {
      allocationPricer = await subject();

      const actualQuoteAssetDecimals = await allocationPricer.quoteAssetDecimals.callAsync();
      const expectedQuoteAssetDecimals = await usdcMock.decimals.callAsync();

      expect(actualQuoteAssetDecimals).to.be.bignumber.equal(expectedQuoteAssetDecimals);
    });

    describe('but stable asset address does not match stable collateral component', async () => {
      beforeEach(async () => {
        subjectBaseAssetInstance = randomTokenAddress;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('but risk asset address does not match risk collateral component', async () => {
      beforeEach(async () => {
        subjectQuoteAssetInstance = randomTokenAddress;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#determineNewAllocation', async () => {
    let subjectTargetBaseAssetAllocation: BigNumber;
    let subjectCurrentCollateralSet: Address;

    let ethPrice: BigNumber;

    before(async () => {
      ethPrice = ether(140);
    });

    beforeEach(async () => {
      allocationPricer = await managerHelper.deployBinaryAllocationPricerAsync(
        wrappedETH.address,
        usdcMock.address,
        oracleProxy.address,
        usdcOracle.address,
        baseAssetCollateral.address,
        quoteAssetCollateral.address,
        core.address,
        factory.address
      );

      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        oracleProxy,
        [allocationPricer.address]
      );

      const triggerBlockInfo = await web3.eth.getBlock('latest');
      await oracleHelper.updateMedianizerPriceAsync(
        ethMedianizer,
        ethPrice,
        new BigNumber(triggerBlockInfo.timestamp + 1),
      );

      subjectTargetBaseAssetAllocation = new BigNumber(100);
      subjectCurrentCollateralSet = quoteAssetCollateral.address;
    });

    async function subjectCall(): Promise<[string, BigNumber, BigNumber]> {
      return allocationPricer.determineNewAllocation.callAsync(
        subjectTargetBaseAssetAllocation,
        subjectCurrentCollateralSet
      );
    }

    async function subjectTxn(): Promise<string> {
      return allocationPricer.determineNewAllocation.sendTransactionAsync(
        subjectTargetBaseAssetAllocation,
        subjectCurrentCollateralSet
      );
    }

    it('returns the correct nextSet address', async () => {
      const [actualNextSetAddress, , ] = await subjectCall();

      expect(actualNextSetAddress).to.equal(baseAssetCollateral.address);
    });

    it('returns the correct currentSet value', async () => {
      const [, actualCurrentSetValue, ] = await subjectCall();

      const expectedCurrentSetValue = await managerHelper.calculateSetTokenValue(
        quoteAssetCollateral,
        [usdcPrice],
        [USDC_DECIMALS]
      );
      expect(actualCurrentSetValue).to.be.bignumber.equal(expectedCurrentSetValue);
    });

    it('returns the correct nextSet value', async () => {
      const [, , actualNextSetValue] = await subjectCall();

      const expectedNextSetValue = await managerHelper.calculateSetTokenValue(
        baseAssetCollateral,
        [ethPrice],
        [ETH_DECIMALS]
      );
      expect(actualNextSetValue).to.be.bignumber.equal(expectedNextSetValue);
    });

    describe('when next allocation should be the quote asset', async () => {
      beforeEach(async () => {
        subjectTargetBaseAssetAllocation = ZERO;
        subjectCurrentCollateralSet = baseAssetCollateral.address;
      });

      it('returns the correct nextSet address', async () => {
        const [actualNextSetAddress, , ] = await subjectCall();

        expect(actualNextSetAddress).to.equal(quoteAssetCollateral.address);
      });

      it('returns the correct currentSet value', async () => {
        const [, actualCurrentSetValue, ] = await subjectCall();

        const expectedCurrentSetValue = await managerHelper.calculateSetTokenValue(
          baseAssetCollateral,
          [ethPrice],
          [ETH_DECIMALS]
        );
        expect(actualCurrentSetValue).to.be.bignumber.equal(expectedCurrentSetValue);
      });

      it('returns the correct nextSet value', async () => {
        const [, , actualNextSetValue] = await subjectCall();

        const expectedNextSetValue = await managerHelper.calculateSetTokenValue(
          quoteAssetCollateral,
          [usdcPrice],
          [USDC_DECIMALS]
        );
        expect(actualNextSetValue).to.be.bignumber.equal(expectedNextSetValue);
      });
    });

    describe('but collateral is 4x different in price', async () => {
      before(async () => {
        ethPrice = ether(25);
      });

      it('should set new baseAsset collateral address', async () => {
        const txHash = await subjectTxn();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const expectedNextSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);

        const actualNextSetAddress = await allocationPricer.baseAssetCollateralInstance.callAsync();
        expect(expectedNextSetAddress).to.equal(actualNextSetAddress);
      });

      it('updates new baseAsset collateral to the correct naturalUnit', async () => {
        await subjectTxn();

        const nextSetAddress = await allocationPricer.baseAssetCollateralInstance.callAsync();
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
        const nextSetNaturalUnit = await nextSet.naturalUnit.callAsync();

        const currentAssetPrice = await usdcOracle.read.callAsync();
        const nextAssetPrice = await legacyMakerOracleAdapter.read.callAsync();
        const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParamsetersAsync(
          quoteAssetCollateral,
          baseAssetCollateral,
          subjectTargetBaseAssetAllocation,
          currentAssetPrice,
          nextAssetPrice,
          USDC_DECIMALS,
          ETH_DECIMALS
        );
        expect(nextSetNaturalUnit).to.be.bignumber.equal(expectedNextSetParams['naturalUnit']);
      });

      it('updates new baseAsset collateral to the correct units', async () => {
        await subjectTxn();

        const nextSetAddress = await allocationPricer.baseAssetCollateralInstance.callAsync();
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
        const nextSetUnits = await nextSet.getUnits.callAsync();

        const currentAssetPrice = await usdcOracle.read.callAsync();
        const nextAssetPrice = await legacyMakerOracleAdapter.read.callAsync();
        const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParamsetersAsync(
          quoteAssetCollateral,
          baseAssetCollateral,
          subjectTargetBaseAssetAllocation,
          currentAssetPrice,
          nextAssetPrice,
          USDC_DECIMALS,
          ETH_DECIMALS
        );
        expect(JSON.stringify(nextSetUnits)).to.be.eql(JSON.stringify(expectedNextSetParams['units']));
      });

      it('updates new baseAsset collateral to the correct components', async () => {
        await subjectTxn();

        const nextSetAddress = await allocationPricer.baseAssetCollateralInstance.callAsync();
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
        const nextSetComponents = await nextSet.getComponents.callAsync();

        const expectedNextSetComponents = [wrappedETH.address];
        expect(JSON.stringify(nextSetComponents)).to.be.eql(JSON.stringify(expectedNextSetComponents));
      });
    });

    describe('but new baseAsset collateral requires bump in natural unit', async () => {
      before(async () => {
        ethPrice = ether(4 * 10 ** 8);
      });

      it('should set new baseAsset collateral address', async () => {
        const txHash = await subjectTxn();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const expectedNextSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);

        const actualNextSetAddress = await allocationPricer.baseAssetCollateralInstance.callAsync();
        expect(expectedNextSetAddress).to.equal(actualNextSetAddress);
      });

      it('updates new baseAsset collateral to the correct naturalUnit', async () => {
        await subjectTxn();

        const nextSetAddress = await allocationPricer.baseAssetCollateralInstance.callAsync();
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
        const nextSetNaturalUnit = await nextSet.naturalUnit.callAsync();

        const currentAssetPrice = await usdcOracle.read.callAsync();
        const nextAssetPrice = await legacyMakerOracleAdapter.read.callAsync();
        const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParamsetersAsync(
          quoteAssetCollateral,
          baseAssetCollateral,
          subjectTargetBaseAssetAllocation,
          currentAssetPrice,
          nextAssetPrice,
          USDC_DECIMALS,
          ETH_DECIMALS
        );

        expect(nextSetNaturalUnit).to.be.bignumber.equal(expectedNextSetParams['naturalUnit']);
      });

      it('updates new baseAsset collateral to the correct units', async () => {
        await subjectTxn();

        const nextSetAddress = await allocationPricer.baseAssetCollateralInstance.callAsync();
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
        const nextSetUnits = await nextSet.getUnits.callAsync();

        const currentAssetPrice = await usdcOracle.read.callAsync();
        const nextAssetPrice = await legacyMakerOracleAdapter.read.callAsync();
        const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParamsetersAsync(
          quoteAssetCollateral,
          baseAssetCollateral,
          subjectTargetBaseAssetAllocation,
          currentAssetPrice,
          nextAssetPrice,
          USDC_DECIMALS,
          ETH_DECIMALS
        );

        expect(JSON.stringify(nextSetUnits)).to.be.eql(JSON.stringify(expectedNextSetParams['units']));
      });

      it('updates new baseAsset collateral to the correct components', async () => {
        await subjectTxn();

        const nextSetAddress = await allocationPricer.baseAssetCollateralInstance.callAsync();
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
        const nextSetComponents = await nextSet.getComponents.callAsync();

        const expectedNextSetComponents = [wrappedETH.address];
        expect(JSON.stringify(nextSetComponents)).to.be.eql(JSON.stringify(expectedNextSetComponents));
      });
    });

    describe('when next allocation should be the quote asset and collateral is 4x different in price', async () => {
      before(async () => {
        ethPrice = ether(400);
      });

      beforeEach(async () => {
        subjectTargetBaseAssetAllocation = ZERO;
        subjectCurrentCollateralSet = baseAssetCollateral.address;
      });

      it('should set new quoteAsset collateral address', async () => {
        const txHash = await subjectTxn();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const expectedNextSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);

        const actualNextSetAddress = await allocationPricer.quoteAssetCollateralInstance.callAsync();
        expect(expectedNextSetAddress).to.equal(actualNextSetAddress);
      });

      it('updates new quoteAsset collateral to the correct naturalUnit', async () => {
        await subjectTxn();

        const nextSetAddress = await allocationPricer.quoteAssetCollateralInstance.callAsync();
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
        const nextSetNaturalUnit = await nextSet.naturalUnit.callAsync();

        const currentAssetPrice = await legacyMakerOracleAdapter.read.callAsync();
        const nextAssetPrice = await usdcOracle.read.callAsync();
        const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParamsetersAsync(
          baseAssetCollateral,
          quoteAssetCollateral,
          subjectTargetBaseAssetAllocation,
          currentAssetPrice,
          nextAssetPrice,
          ETH_DECIMALS,
          USDC_DECIMALS,
        );

        expect(nextSetNaturalUnit).to.be.bignumber.equal(expectedNextSetParams['naturalUnit']);
      });

      it('updates new quoteAsset collateral to the correct units', async () => {
        await subjectTxn();

        const nextSetAddress = await allocationPricer.quoteAssetCollateralInstance.callAsync();
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
        const nextSetUnits = await nextSet.getUnits.callAsync();

        const currentAssetPrice = await legacyMakerOracleAdapter.read.callAsync();
        const nextAssetPrice = await usdcOracle.read.callAsync();
        const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParamsetersAsync(
          baseAssetCollateral,
          quoteAssetCollateral,
          subjectTargetBaseAssetAllocation,
          currentAssetPrice,
          nextAssetPrice,
          ETH_DECIMALS,
          USDC_DECIMALS,
        );
        expect(JSON.stringify(nextSetUnits)).to.be.eql(JSON.stringify(expectedNextSetParams['units']));
      });

      it('updates new quoteAsset collateral to the correct components', async () => {
        await subjectTxn();

        const nextSetAddress = await allocationPricer.quoteAssetCollateralInstance.callAsync();
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
        const nextSetComponents = await nextSet.getComponents.callAsync();

        const expectedNextSetComponents = [usdcMock.address];
        expect(JSON.stringify(nextSetComponents)).to.be.eql(JSON.stringify(expectedNextSetComponents));
      });
    });

    describe('but new quoteAsset collateral requires bump in natural unit', async () => {
      before(async () => {
        ethPrice = ether(.4);
      });

      beforeEach(async () => {
        subjectTargetBaseAssetAllocation = ZERO;
        subjectCurrentCollateralSet = baseAssetCollateral.address;
      });

      it('should set new quoteAsset collateral address', async () => {
        const txHash = await subjectTxn();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const expectedNextSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);

        const actualNextSetAddress = await allocationPricer.quoteAssetCollateralInstance.callAsync();
        expect(expectedNextSetAddress).to.equal(actualNextSetAddress);
      });

      it('updates new quoteAsset collateral to the correct naturalUnit', async () => {
        await subjectTxn();

        const nextSetAddress = await allocationPricer.quoteAssetCollateralInstance.callAsync();
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
        const nextSetNaturalUnit = await nextSet.naturalUnit.callAsync();

        const currentAssetPrice = await legacyMakerOracleAdapter.read.callAsync();
        const nextAssetPrice = await usdcOracle.read.callAsync();
        const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParamsetersAsync(
          baseAssetCollateral,
          quoteAssetCollateral,
          subjectTargetBaseAssetAllocation,
          currentAssetPrice,
          nextAssetPrice,
          ETH_DECIMALS,
          USDC_DECIMALS,
        );
        expect(nextSetNaturalUnit).to.be.bignumber.equal(expectedNextSetParams['naturalUnit']);
      });

      it('updates new quoteAsset collateral to the correct units', async () => {
        await subjectTxn();

        const nextSetAddress = await allocationPricer.quoteAssetCollateralInstance.callAsync();
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
        const nextSetUnits = await nextSet.getUnits.callAsync();

        const currentAssetPrice = await legacyMakerOracleAdapter.read.callAsync();
        const nextAssetPrice = await usdcOracle.read.callAsync();
        const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParamsetersAsync(
          baseAssetCollateral,
          quoteAssetCollateral,
          subjectTargetBaseAssetAllocation,
          currentAssetPrice,
          nextAssetPrice,
          ETH_DECIMALS,
          USDC_DECIMALS,
        );
        expect(JSON.stringify(nextSetUnits)).to.be.eql(JSON.stringify(expectedNextSetParams['units']));
      });

      it('updates new quoteAsset collateral to the correct components', async () => {
        await subjectTxn();

        const nextSetAddress = await allocationPricer.quoteAssetCollateralInstance.callAsync();
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
        const nextSetComponents = await nextSet.getComponents.callAsync();

        const expectedNextSetComponents = [usdcMock.address];
        expect(JSON.stringify(nextSetComponents)).to.be.eql(JSON.stringify(expectedNextSetComponents));
      });
    });
  });
});