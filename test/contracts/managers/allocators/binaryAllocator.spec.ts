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
  SetTokenContract,
  SetTokenFactoryContract,
  WethMockContract,
  WhiteListContract,
} from 'set-protocol-contracts';

import {
  ConstantPriceOracleContract,
  LegacyMakerOracleAdapterContract,
  MedianContract,
  OracleProxyContract,
} from 'set-protocol-oracles';

import {
  BinaryAllocatorContract,
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

import { extractNewCollateralFromLogs } from '@utils/contract_logs/binaryAllocator';
import { expectRevertError } from '@utils/tokenAssertions';
import { getWeb3 } from '@utils/web3Helper';

import { ERC20Helper } from '@utils/helpers/erc20Helper';
import { ManagerHelper } from '@utils/helpers/managerHelper';
import { OracleHelper } from '@utils/helpers/oracleHelper';
import { ProtocolHelper } from '@utils/helpers/protocolHelper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const BinaryAllocator = artifacts.require('BinaryAllocator');
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;
const setTestUtils = new SetTestUtils(web3);

contract('BinaryAllocator', accounts => {
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
  let multiAssetCollateral: SetTokenContract;

  let allocator: BinaryAllocatorContract;

  let initialEthPrice: BigNumber;
  let usdcPrice: BigNumber;

  const protocolHelper = new ProtocolHelper(deployerAccount);
  const erc20Helper = new ERC20Helper(deployerAccount);
  const managerHelper = new ManagerHelper(deployerAccount);
  const oracleHelper = new OracleHelper(deployerAccount);

  before(async () => {
    ABIDecoder.addABI(Core.abi);
    ABIDecoder.addABI(BinaryAllocator.abi);
  });

  after(async () => {
    ABIDecoder.removeABI(Core.abi);
    ABIDecoder.removeABI(BinaryAllocator.abi);
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

    multiAssetCollateral = await protocolHelper.createSetTokenAsync(
      core,
      factory.address,
      [usdcMock.address, wrappedETH.address],
      [new BigNumber(2 ** 7), new BigNumber(2 ** 20)],  // 128
      STABLE_COLLATERAL_NATURAL_UNIT,
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectBaseAsset: Address;
    let subjectQuoteAsset: Address;
    let subjectBaseAssetOracle: Address;
    let subjectQuoteAssetOracle: Address;
    let subjectBaseAssetCollateral: Address;
    let subjectQuoteAssetCollateral: Address;
    let subjectCore: Address;
    let subjectSetTokenFactory: Address;

    beforeEach(async () => {
      subjectBaseAsset = wrappedETH.address;
      subjectQuoteAsset = usdcMock.address;
      subjectBaseAssetOracle = oracleProxy.address;
      subjectQuoteAssetOracle = usdcOracle.address;
      subjectBaseAssetCollateral = baseAssetCollateral.address;
      subjectQuoteAssetCollateral = quoteAssetCollateral.address;
      subjectCore = core.address;
      subjectSetTokenFactory = factory.address;
    });

    async function subject(): Promise<BinaryAllocatorContract> {
      return managerHelper.deployBinaryAllocatorAsync(
        subjectBaseAsset,
        subjectQuoteAsset,
        subjectBaseAssetOracle,
        subjectQuoteAssetOracle,
        subjectBaseAssetCollateral,
        subjectQuoteAssetCollateral,
        subjectCore,
        subjectSetTokenFactory
      );
    }

    it('sets the correct base asset address', async () => {
      allocator = await subject();

      const actualBaseAsset = await allocator.baseAsset.callAsync();

      expect(actualBaseAsset).to.equal(subjectBaseAsset);
    });

    it('sets the correct quote asset address', async () => {
      allocator = await subject();

      const actualQuoteAsset = await allocator.quoteAsset.callAsync();

      expect(actualQuoteAsset).to.equal(subjectQuoteAsset);
    });

    it('sets the correct base asset oracle address', async () => {
      allocator = await subject();

      const actualBaseAssetOracle = await allocator.baseAssetOracle.callAsync();

      expect(actualBaseAssetOracle).to.equal(subjectBaseAssetOracle);
    });

    it('sets the correct quote asset oracle address', async () => {
      allocator = await subject();

      const actualQuoteAssetOracle = await allocator.quoteAssetOracle.callAsync();

      expect(actualQuoteAssetOracle).to.equal(subjectQuoteAssetOracle);
    });

    it('adds the correct base collateral address to storedCollateral mapping', async () => {
      allocator = await subject();

      const baseSetUnits = await baseAssetCollateral.getUnits.callAsync();
      const baseSetNaturalUnit = await baseAssetCollateral.naturalUnit.callAsync();
      const baseSetComponents = await baseAssetCollateral.getComponents.callAsync();
      const baseCollateralHash = managerHelper.calculateCollateralSetHash(
        baseSetUnits[0],
        baseSetNaturalUnit,
        baseSetComponents[0],
      );

      const actualStoredBaseAddress = await allocator.storedCollateral.callAsync(baseCollateralHash);

      expect(actualStoredBaseAddress).to.equal(subjectBaseAssetCollateral);
    });

    it('adds the correct quote collateral address to storedCollateral mapping', async () => {
      allocator = await subject();

      const quoteSetUnits = await quoteAssetCollateral.getUnits.callAsync();
      const quoteSetNaturalUnit = await quoteAssetCollateral.naturalUnit.callAsync();
      const quoteSetComponents = await quoteAssetCollateral.getComponents.callAsync();
      const quoteCollateralHash = managerHelper.calculateCollateralSetHash(
        quoteSetUnits[0],
        quoteSetNaturalUnit,
        quoteSetComponents[0],
      );

      const actualStoredQuoteAddress = await allocator.storedCollateral.callAsync(quoteCollateralHash);

      expect(actualStoredQuoteAddress).to.equal(subjectQuoteAssetCollateral);
    });

    it('sets the correct core address', async () => {
      allocator = await subject();

      const actualCoreAddress = await allocator.core.callAsync();

      expect(actualCoreAddress).to.equal(subjectCore);
    });

    it('sets the correct set token factory address', async () => {
      allocator = await subject();

      const actualSetTokenFactory = await allocator.setTokenFactory.callAsync();

      expect(actualSetTokenFactory).to.equal(subjectSetTokenFactory);
    });

    it('sets the correct base asset decimals', async () => {
      allocator = await subject();

      const actualBaseAssetDecimals = await allocator.baseAssetDecimals.callAsync();
      const expectedBaseAssetDecimals = await wrappedETH.decimals.callAsync();

      expect(actualBaseAssetDecimals).to.be.bignumber.equal(expectedBaseAssetDecimals);
    });

    it('sets the correct quote asset decimals', async () => {
      allocator = await subject();

      const actualQuoteAssetDecimals = await allocator.quoteAssetDecimals.callAsync();
      const expectedQuoteAssetDecimals = await usdcMock.decimals.callAsync();

      expect(actualQuoteAssetDecimals).to.be.bignumber.equal(expectedQuoteAssetDecimals);
    });

    describe('but stable asset address does not match stable collateral component', async () => {
      beforeEach(async () => {
        subjectBaseAsset = randomTokenAddress;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('but risk asset address does not match risk collateral component', async () => {
      beforeEach(async () => {
        subjectQuoteAsset = randomTokenAddress;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('but passed baseCollateral has two components', async () => {
      beforeEach(async () => {
        subjectBaseAssetCollateral = multiAssetCollateral.address;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('but passed quoteCollateral has two components', async () => {
      beforeEach(async () => {
        subjectQuoteAssetCollateral = multiAssetCollateral.address;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#determineNewAllocation', async () => {
    let subjectTargetBaseAssetAllocation: BigNumber;
    let subjectAllocationPrecision: BigNumber;
    let subjectCurrentCollateralSet: Address;

    let ethPrice: BigNumber;

    before(async () => {
      ethPrice = ether(140);
    });

    beforeEach(async () => {
      allocator = await managerHelper.deployBinaryAllocatorAsync(
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
        [allocator.address]
      );

      const triggerBlockInfo = await web3.eth.getBlock('latest');
      await oracleHelper.updateMedianizerPriceAsync(
        ethMedianizer,
        ethPrice,
        new BigNumber(triggerBlockInfo.timestamp + 1),
      );

      subjectTargetBaseAssetAllocation = new BigNumber(100);
      subjectAllocationPrecision = new BigNumber(100);
      subjectCurrentCollateralSet = quoteAssetCollateral.address;
    });

    async function subjectCall(): Promise<string> {
      return allocator.determineNewAllocation.callAsync(
        subjectTargetBaseAssetAllocation,
        subjectAllocationPrecision,
        subjectCurrentCollateralSet
      );
    }

    async function subjectTxn(): Promise<string> {
      return allocator.determineNewAllocation.sendTransactionAsync(
        subjectTargetBaseAssetAllocation,
        subjectAllocationPrecision,
        subjectCurrentCollateralSet
      );
    }

    it('returns the correct nextSet address', async () => {
      const actualNextSetAddress = await subjectCall();

      expect(actualNextSetAddress).to.equal(baseAssetCollateral.address);
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

        const actualNextSetAddress = await allocator.storedCollateral.callAsync(expectedHashId);
        expect(actualNextSetAddress).to.equal(expectedNextSetAddress);
      });

      it('updates new baseAsset collateral to the correct naturalUnit', async () => {
        const txHash = await subjectTxn();

        const nextSet = await managerHelper.getNewBinaryAllocatorCollateralFromLogs(
          txHash,
          protocolHelper
        );

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

        const nextSet = await managerHelper.getNewBinaryAllocatorCollateralFromLogs(
          txHash,
          protocolHelper
        );

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

        const nextSet = await managerHelper.getNewBinaryAllocatorCollateralFromLogs(
          txHash,
          protocolHelper
        );

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

        const actualNextSetAddress = await allocator.storedCollateral.callAsync(expectedHashId);
        expect(expectedNextSetAddress).to.equal(actualNextSetAddress);
      });

      it('updates new baseAsset collateral to the correct naturalUnit', async () => {
        const previousNaturalUnit = await baseAssetCollateral.naturalUnit.callAsync();

        const txHash = await subjectTxn();

        const nextSet = await managerHelper.getNewBinaryAllocatorCollateralFromLogs(
          txHash,
          protocolHelper
        );

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

        const nextSet = await managerHelper.getNewBinaryAllocatorCollateralFromLogs(
          txHash,
          protocolHelper
        );

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

        const nextSet = await managerHelper.getNewBinaryAllocatorCollateralFromLogs(
          txHash,
          protocolHelper
        );

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
        const actualNextSetAddress = await subjectCall();

        expect(actualNextSetAddress).to.equal(quoteAssetCollateral.address);
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

        const actualNextSetAddress = await allocator.storedCollateral.callAsync(expectedHashId);
        expect(expectedNextSetAddress).to.equal(actualNextSetAddress);
      });

      it('updates new quoteAsset collateral to the correct naturalUnit', async () => {
        const txHash = await subjectTxn();

        const nextSet = await managerHelper.getNewBinaryAllocatorCollateralFromLogs(
          txHash,
          protocolHelper
        );

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

        const nextSet = await managerHelper.getNewBinaryAllocatorCollateralFromLogs(
          txHash,
          protocolHelper
        );

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

        const nextSet = await managerHelper.getNewBinaryAllocatorCollateralFromLogs(
          txHash,
          protocolHelper
        );

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

        const actualNextSetAddress = await allocator.storedCollateral.callAsync(expectedHashId);
        expect(expectedNextSetAddress).to.equal(actualNextSetAddress);
      });

      it('updates new quoteAsset collateral to the correct naturalUnit', async () => {
        const previousNaturalUnit = await quoteAssetCollateral.naturalUnit.callAsync();

        const txHash = await subjectTxn();

        const nextSet = await managerHelper.getNewBinaryAllocatorCollateralFromLogs(
          txHash,
          protocolHelper
        );

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

        const nextSet = await managerHelper.getNewBinaryAllocatorCollateralFromLogs(
          txHash,
          protocolHelper
        );

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

        const nextSet = await managerHelper.getNewBinaryAllocatorCollateralFromLogs(
          txHash,
          protocolHelper
        );

        const nextSetComponents = await nextSet.getComponents.callAsync();

        const expectedNextSetComponents = [usdcMock.address];
        expect(JSON.stringify(nextSetComponents)).to.be.eql(JSON.stringify(expectedNextSetComponents));
      });
    });

    describe('when the target allocation amount does not equal 0 or allocationPrecision', async () => {
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

  describe('#calculateCollateralSetValue', async () => {
    let subjectCollateralSet: Address;

    let ethPrice: BigNumber;

    before(async () => {
      ethPrice = ether(140);
    });

    beforeEach(async () => {
      allocator = await managerHelper.deployBinaryAllocatorAsync(
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
        [allocator.address]
      );

      const triggerBlockInfo = await web3.eth.getBlock('latest');
      await oracleHelper.updateMedianizerPriceAsync(
        ethMedianizer,
        ethPrice,
        new BigNumber(triggerBlockInfo.timestamp + 1),
      );

      subjectCollateralSet = quoteAssetCollateral.address;
    });

    async function subject(): Promise<BigNumber> {
      return allocator.calculateCollateralSetValue.callAsync(
        subjectCollateralSet
      );
    }

    it('returns the Set value', async () => {
      const actualSetValue = await subject();

      const expectedSetValue = await managerHelper.calculateSetTokenValue(
        quoteAssetCollateral,
        [usdcPrice],
        [USDC_DECIMALS],
      );

      expect(actualSetValue).to.bignumber.equal(expectedSetValue);
    });

    describe('when the set uses the base asset', async () => {
      beforeEach(async () => {
        subjectCollateralSet = baseAssetCollateral.address;
      });

      it('returns the Set value', async () => {
        const actualSetValue = await subject();

        const expectedSetValue = await managerHelper.calculateSetTokenValue(
          baseAssetCollateral,
          [ethPrice],
          [ETH_DECIMALS],
        );

        expect(actualSetValue).to.bignumber.equal(expectedSetValue);
      });
    });

    describe('but passed collateral set has two components', async () => {
      beforeEach(async () => {
        subjectCollateralSet = multiAssetCollateral.address;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });
});