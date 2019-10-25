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

import { extractNewCollateralFromLogs } from '@utils/contract_logs/binaryAllocationPricer';
import { expectRevertError } from '@utils/tokenAssertions';
import { getWeb3 } from '@utils/web3Helper';

import { ERC20Helper } from '@utils/helpers/erc20Helper';
import { ManagerHelper } from '@utils/helpers/managerHelper';
import { OracleHelper } from '@utils/helpers/oracleHelper';
import { ProtocolHelper } from '@utils/helpers/protocolHelper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const BinaryAllocationPricer = artifacts.require('BinaryAllocationPricer');
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
    ABIDecoder.addABI(BinaryAllocationPricer.abi);
  });

  after(async () => {
    ABIDecoder.removeABI(Core.abi);
    ABIDecoder.removeABI(BinaryAllocationPricer.abi);
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
      [new BigNumber(2 ** 20)],  // 1048576
      RISK_COLLATERAL_NATURAL_UNIT,
    );

    quoteAssetCollateral = await protocolHelper.createSetTokenAsync(
      core,
      factory.address,
      [usdcMock.address],
      [new BigNumber(2 ** 7)],  // 128
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

    it('adds the correct base collateral address to storedCollateral mapping', async () => {
      allocationPricer = await subject();

      const baseSetUnits = await baseAssetCollateral.getUnits.callAsync();
      const baseSetNaturalUnit = await baseAssetCollateral.naturalUnit.callAsync();
      const baseSetComponents = await baseAssetCollateral.getComponents.callAsync();
      const baseCollateralHash = managerHelper.calculateCollateralSetHash(
        baseSetUnits[0],
        baseSetNaturalUnit,
        baseSetComponents[0],
      );

      const actualStoredBaseAddress = await allocationPricer.storedCollateral.callAsync(baseCollateralHash);

      expect(actualStoredBaseAddress).to.equal(subjectBaseAssetCollateralInstance);
    });

    it('adds the correct quote collateral address to storedCollateral mapping', async () => {
      allocationPricer = await subject();

      const quoteSetUnits = await quoteAssetCollateral.getUnits.callAsync();
      const quoteSetNaturalUnit = await quoteAssetCollateral.naturalUnit.callAsync();
      const quoteSetComponents = await quoteAssetCollateral.getComponents.callAsync();
      const quoteCollateralHash = managerHelper.calculateCollateralSetHash(
        quoteSetUnits[0],
        quoteSetNaturalUnit,
        quoteSetComponents[0],
      );

      const actualStoredQuoteAddress = await allocationPricer.storedCollateral.callAsync(quoteCollateralHash);

      expect(actualStoredQuoteAddress).to.equal(subjectQuoteAssetCollateralInstance);
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

    describe('but collateral is 4x different in price', async () => {
      before(async () => {
        ethPrice = ether(25);
      });

      after(async () => {
        ethPrice = ether(140);
      });

      it('should set new baseAsset collateral address', async () => {
        const txHash = await subjectTxn();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const [expectedHashId, expectedNextSetAddress] = extractNewCollateralFromLogs([logs[1]]);

        const actualNextSetAddress = await allocationPricer.storedCollateral.callAsync(expectedHashId);
        expect(actualNextSetAddress).to.equal(expectedNextSetAddress);
      });

      it('updates new baseAsset collateral to the correct naturalUnit', async () => {
        const txHash = await subjectTxn();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const [, nextSetAddress] = extractNewCollateralFromLogs([logs[1]]);
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);

        const nextSetNaturalUnit = await nextSet.naturalUnit.callAsync();

        const currentAssetPrice = await usdcOracle.read.callAsync();
        const nextAssetPrice = await legacyMakerOracleAdapter.read.callAsync();
        const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParametersAsync(
          quoteAssetCollateral,
          currentAssetPrice,
          nextAssetPrice,
          USDC_DECIMALS,
          ETH_DECIMALS
        );
        expect(nextSetNaturalUnit).to.be.bignumber.equal(expectedNextSetParams['naturalUnit']);
      });

      it('updates new baseAsset collateral to the correct units', async () => {
        const txHash = await subjectTxn();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const [, nextSetAddress] = extractNewCollateralFromLogs([logs[1]]);
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);

        const nextSetUnits = await nextSet.getUnits.callAsync();

        const currentAssetPrice = await usdcOracle.read.callAsync();
        const nextAssetPrice = await legacyMakerOracleAdapter.read.callAsync();
        const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParametersAsync(
          quoteAssetCollateral,
          currentAssetPrice,
          nextAssetPrice,
          USDC_DECIMALS,
          ETH_DECIMALS
        );
        expect(JSON.stringify(nextSetUnits)).to.be.eql(JSON.stringify(expectedNextSetParams['units']));
      });

      it('updates new baseAsset collateral to the correct components', async () => {
        const txHash = await subjectTxn();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const [, nextSetAddress] = extractNewCollateralFromLogs([logs[1]]);
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

      after(async () => {
        ethPrice = ether(140);
      });

      it('should set new baseAsset collateral address', async () => {
        const txHash = await subjectTxn();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const [expectedHashId, expectedNextSetAddress] = extractNewCollateralFromLogs([logs[1]]);

        const actualNextSetAddress = await allocationPricer.storedCollateral.callAsync(expectedHashId);
        expect(expectedNextSetAddress).to.equal(actualNextSetAddress);
      });

      it('updates new baseAsset collateral to the correct naturalUnit', async () => {
        const previousNaturalUnit = await baseAssetCollateral.naturalUnit.callAsync();

        const txHash = await subjectTxn();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const [, nextSetAddress] = extractNewCollateralFromLogs([logs[1]]);
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);

        const nextSetNaturalUnit = await nextSet.naturalUnit.callAsync();

        const currentAssetPrice = await usdcOracle.read.callAsync();
        const nextAssetPrice = await legacyMakerOracleAdapter.read.callAsync();
        const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParametersAsync(
          quoteAssetCollateral,
          currentAssetPrice,
          nextAssetPrice,
          USDC_DECIMALS,
          ETH_DECIMALS
        );

        expect(previousNaturalUnit).to.be.bignumber.not.equal(nextSetNaturalUnit);
        expect(nextSetNaturalUnit).to.be.bignumber.equal(expectedNextSetParams['naturalUnit']);
      });

      it('updates new baseAsset collateral to the correct units', async () => {
        const txHash = await subjectTxn();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const [, nextSetAddress] = extractNewCollateralFromLogs([logs[1]]);
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);

        const nextSetUnits = await nextSet.getUnits.callAsync();

        const currentAssetPrice = await usdcOracle.read.callAsync();
        const nextAssetPrice = await legacyMakerOracleAdapter.read.callAsync();
        const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParametersAsync(
          quoteAssetCollateral,
          currentAssetPrice,
          nextAssetPrice,
          USDC_DECIMALS,
          ETH_DECIMALS
        );

        expect(JSON.stringify(nextSetUnits)).to.be.eql(JSON.stringify(expectedNextSetParams['units']));
      });

      it('updates new baseAsset collateral to the correct components', async () => {
        const txHash = await subjectTxn();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const [, nextSetAddress] = extractNewCollateralFromLogs([logs[1]]);
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);

        const nextSetComponents = await nextSet.getComponents.callAsync();

        const expectedNextSetComponents = [wrappedETH.address];
        expect(JSON.stringify(nextSetComponents)).to.be.eql(JSON.stringify(expectedNextSetComponents));
      });
    });

    describe('when the current collateral set component is not the quoteAsset', async () => {
      beforeEach(async () => {
        subjectCurrentCollateralSet = baseAssetCollateral.address;
      });

      it('should revert', async () => {
        await expectRevertError(subjectCall());
      });
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

      describe('when the current collateral set component is not the baseAsset', async () => {
        beforeEach(async () => {
          subjectCurrentCollateralSet = quoteAssetCollateral.address;
        });

        it('should revert', async () => {
          await expectRevertError(subjectCall());
        });
      });
    });

    describe('when next allocation should be the quote asset and collateral is 4x different in price', async () => {
      before(async () => {
        ethPrice = ether(400);
      });

      after(async () => {
        ethPrice = ether(140);
      });

      beforeEach(async () => {
        subjectTargetBaseAssetAllocation = ZERO;
        subjectCurrentCollateralSet = baseAssetCollateral.address;
      });

      it('should set new quoteAsset collateral address', async () => {
        const txHash = await subjectTxn();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const [expectedHashId, expectedNextSetAddress] = extractNewCollateralFromLogs([logs[1]]);

        const actualNextSetAddress = await allocationPricer.storedCollateral.callAsync(expectedHashId);
        expect(expectedNextSetAddress).to.equal(actualNextSetAddress);
      });

      it('updates new quoteAsset collateral to the correct naturalUnit', async () => {
        const txHash = await subjectTxn();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const [, nextSetAddress] = extractNewCollateralFromLogs([logs[1]]);
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);

        const nextSetNaturalUnit = await nextSet.naturalUnit.callAsync();

        const currentAssetPrice = await legacyMakerOracleAdapter.read.callAsync();
        const nextAssetPrice = await usdcOracle.read.callAsync();
        const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParametersAsync(
          baseAssetCollateral,
          currentAssetPrice,
          nextAssetPrice,
          ETH_DECIMALS,
          USDC_DECIMALS,
        );

        expect(nextSetNaturalUnit).to.be.bignumber.equal(expectedNextSetParams['naturalUnit']);
      });

      it('updates new quoteAsset collateral to the correct units', async () => {
        const txHash = await subjectTxn();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const [, nextSetAddress] = extractNewCollateralFromLogs([logs[1]]);
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);

        const nextSetUnits = await nextSet.getUnits.callAsync();

        const currentAssetPrice = await legacyMakerOracleAdapter.read.callAsync();
        const nextAssetPrice = await usdcOracle.read.callAsync();
        const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParametersAsync(
          baseAssetCollateral,
          currentAssetPrice,
          nextAssetPrice,
          ETH_DECIMALS,
          USDC_DECIMALS,
        );
        expect(JSON.stringify(nextSetUnits)).to.be.eql(JSON.stringify(expectedNextSetParams['units']));
      });

      it('updates new quoteAsset collateral to the correct components', async () => {
        const txHash = await subjectTxn();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const [, nextSetAddress] = extractNewCollateralFromLogs([logs[1]]);
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);

        const nextSetComponents = await nextSet.getComponents.callAsync();

        const expectedNextSetComponents = [usdcMock.address];
        expect(JSON.stringify(nextSetComponents)).to.be.eql(JSON.stringify(expectedNextSetComponents));
      });
    });

    describe('but new quoteAsset collateral requires bump in natural unit', async () => {
      before(async () => {
        ethPrice = ether(.1);
      });

      after(async () => {
        ethPrice = ether(140);
      });

      beforeEach(async () => {
        subjectTargetBaseAssetAllocation = ZERO;
        subjectCurrentCollateralSet = baseAssetCollateral.address;
      });

      it('should set new quoteAsset collateral address', async () => {
        const txHash = await subjectTxn();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const [expectedHashId, expectedNextSetAddress] = extractNewCollateralFromLogs([logs[1]]);

        const actualNextSetAddress = await allocationPricer.storedCollateral.callAsync(expectedHashId);
        expect(expectedNextSetAddress).to.equal(actualNextSetAddress);
      });

      it('updates new quoteAsset collateral to the correct naturalUnit', async () => {
        const previousNaturalUnit = await quoteAssetCollateral.naturalUnit.callAsync();

        const txHash = await subjectTxn();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const [, nextSetAddress] = extractNewCollateralFromLogs([logs[1]]);
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);

        const nextSetNaturalUnit = await nextSet.naturalUnit.callAsync();

        const currentAssetPrice = await legacyMakerOracleAdapter.read.callAsync();
        const nextAssetPrice = await usdcOracle.read.callAsync();
        const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParametersAsync(
          baseAssetCollateral,
          currentAssetPrice,
          nextAssetPrice,
          ETH_DECIMALS,
          USDC_DECIMALS,
        );

        expect(previousNaturalUnit).to.be.bignumber.not.equal(nextSetNaturalUnit);
        expect(nextSetNaturalUnit).to.be.bignumber.equal(expectedNextSetParams['naturalUnit']);
      });

      it('updates new quoteAsset collateral to the correct units', async () => {
        const txHash = await subjectTxn();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const [, nextSetAddress] = extractNewCollateralFromLogs([logs[1]]);
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);

        const nextSetUnits = await nextSet.getUnits.callAsync();

        const currentAssetPrice = await legacyMakerOracleAdapter.read.callAsync();
        const nextAssetPrice = await usdcOracle.read.callAsync();
        const expectedNextSetParams = await managerHelper.getExpectedNewBinaryAllocationParametersAsync(
          baseAssetCollateral,
          currentAssetPrice,
          nextAssetPrice,
          ETH_DECIMALS,
          USDC_DECIMALS,
        );
        expect(JSON.stringify(nextSetUnits)).to.be.eql(JSON.stringify(expectedNextSetParams['units']));
      });

      it('updates new quoteAsset collateral to the correct components', async () => {
        const txHash = await subjectTxn();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const [, nextSetAddress] = extractNewCollateralFromLogs([logs[1]]);
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);

        const nextSetComponents = await nextSet.getComponents.callAsync();

        const expectedNextSetComponents = [usdcMock.address];
        expect(JSON.stringify(nextSetComponents)).to.be.eql(JSON.stringify(expectedNextSetComponents));
      });
    });

    describe('when the target allocation amount does not equal 0 or 100', async () => {
      beforeEach(async () => {
        subjectTargetBaseAssetAllocation = new BigNumber(1);
      });

      it('should revert', async () => {
        await expectRevertError(subjectCall());
      });
    });

    describe('when the current collateral set is not enabled in Core', async () => {
      beforeEach(async () => {
        subjectCurrentCollateralSet = randomTokenAddress;
      });

      it('should revert', async () => {
        await expectRevertError(subjectCall());
      });
    });

    describe('when the current collateral set components has more than one component', async () => {
      beforeEach(async () => {
        const twoAssetCollateral = await protocolHelper.createSetTokenAsync(
          core,
          factory.address,
          [usdcMock.address, wrappedETH.address],
          [new BigNumber(100), new BigNumber(100)],
          STABLE_COLLATERAL_NATURAL_UNIT,
        );

        subjectCurrentCollateralSet = twoAssetCollateral.address;
      });

      it('should revert', async () => {
        await expectRevertError(subjectCall());
      });
    });
  });
});