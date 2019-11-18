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
  SetTokenFactoryContract,
  StandardTokenMockContract,
  WethMockContract,
  WhiteListContract,
} from 'set-protocol-contracts';
import {
  LegacyMakerOracleAdapterContract,
  OracleProxyContract,
  WeightedAllocatorContract,
} from '@utils/contracts';

import {
  ONE_DAY_IN_SECONDS,
  ONE,
  WBTC_DECIMALS
} from '@utils/constants';

import { extractNewSetTokenAddressFromLogs } from '@utils/contract_logs/core';
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

contract('WeightedAllocator', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let core: CoreContract;
  let factory: SetTokenFactoryContract;
  let whiteList: WhiteListContract;
  let wrappedBTC: StandardTokenMockContract;
  let wrappedETH: WethMockContract;

  let ethMedianizer: MedianContract;
  let ethLegacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let ethOracleProxy: OracleProxyContract;

  let btcMedianizer: MedianContract;
  let btcLegacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let btcOracleProxy: OracleProxyContract;

  let allocator: WeightedAllocatorContract;

  let initialEthPrice: BigNumber;
  let initialBtcPrice: BigNumber;

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

    btcMedianizer = await oracleHelper.deployMedianizerAsync();
    await oracleHelper.addPriceFeedOwnerToMedianizer(btcMedianizer, deployerAccount);

    initialEthPrice = ether(180);
    await oracleHelper.updateMedianizerPriceAsync(
      ethMedianizer,
      initialEthPrice,
      SetTestUtils.generateTimestamp(1000),
    );

    initialBtcPrice = ether(9000);
    await oracleHelper.updateMedianizerPriceAsync(
      btcMedianizer,
      initialBtcPrice,
      SetTestUtils.generateTimestamp(1000),
    );

    wrappedBTC = await erc20Helper.deployTokenAsync(deployerAccount, WBTC_DECIMALS);
    await protocolHelper.addTokenToWhiteList(wrappedBTC.address, whiteList);
    await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS.mul(7));
    await protocolHelper.addTokenToWhiteList(wrappedBTC.address, whiteList);

    wrappedETH = await protocolHelper.getDeployedWETHAsync();

    ethLegacyMakerOracleAdapter = await oracleHelper.deployLegacyMakerOracleAdapterAsync(
      ethMedianizer.address,
    );

    ethOracleProxy = await oracleHelper.deployOracleProxyAsync(
      ethLegacyMakerOracleAdapter.address,
    );

    btcLegacyMakerOracleAdapter = await oracleHelper.deployLegacyMakerOracleAdapterAsync(
      btcMedianizer.address,
    );

    btcOracleProxy = await oracleHelper.deployOracleProxyAsync(
      btcLegacyMakerOracleAdapter.address,
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe.only('#constructor', async () => {
    let subjectBaseAsset: Address;
    let subjectQuoteAsset: Address;
    let subjectBaseAssetOracle: Address;
    let subjectQuoteAssetOracle: Address;
    let subjectCore: Address;
    let subjectSetTokenFactory: Address;
    let subjectPricePrecision: BigNumber;

    beforeEach(async () => {
      subjectBaseAsset = wrappedETH.address;
      subjectQuoteAsset = wrappedBTC.address;
      subjectBaseAssetOracle = ethOracleProxy.address;
      subjectQuoteAssetOracle = btcOracleProxy.address;
      subjectCore = core.address;
      subjectSetTokenFactory = factory.address;
      subjectPricePrecision = new BigNumber(100);
    });

    async function subject(): Promise<WeightedAllocatorContract> {
      return managerHelper.deployWeightedAllocatorAsync(
        subjectBaseAsset,
        subjectQuoteAsset,
        subjectBaseAssetOracle,
        subjectQuoteAssetOracle,
        subjectCore,
        subjectSetTokenFactory,
        subjectPricePrecision,
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

    it('sets the correct price precision', async () => {
      allocator = await subject();

      const actualPricePrecision = await allocator.pricePrecision.callAsync();

      expect(actualPricePrecision).to.be.bignumber.equal(subjectPricePrecision);
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
      const expectedQuoteAssetDecimals = await wrappedBTC.decimals.callAsync();

      expect(actualQuoteAssetDecimals).to.be.bignumber.equal(expectedQuoteAssetDecimals);
    });
  });

  describe.only('#determineNewAllocation', async () => {
    let subjectTargetBaseAssetAllocation: BigNumber;
    let subjectAllocationPrecision: BigNumber;
    let subjectCollateralSet: Address;

    let baseAsset: Address;
    let quoteAsset: Address;

    beforeEach(async () => {
      baseAsset = wrappedETH.address;
      quoteAsset = wrappedBTC.address;
      allocator = await managerHelper.deployWeightedAllocatorAsync(
        baseAsset,
        quoteAsset,
        ethOracleProxy.address,
        btcOracleProxy.address,
        core.address,
        factory.address
      );
      const units = [new BigNumber(4.5 * 10 ** 10), new BigNumber(1)];
      const naturalUnit = new BigNumber(10 ** 10);
      const setToken = await protocolHelper.createSetTokenAsync(
        core,
        factory.address,
        [wrappedETH.address, wrappedBTC.address],
        units,
        naturalUnit
      );

      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        ethOracleProxy,
        [allocator.address]
      );

      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        btcOracleProxy,
        [allocator.address]
      );

      subjectCollateralSet = setToken.address;
      subjectTargetBaseAssetAllocation = new BigNumber(75);
      subjectAllocationPrecision = new BigNumber(100);
    });

    async function subject(): Promise<string> {
      return allocator.determineNewAllocation.sendTransactionAsync(
        subjectTargetBaseAssetAllocation,
        subjectAllocationPrecision,
        subjectCollateralSet
      );
    }

    it('new collateral should have correct component array', async () => {
      const txHash = await subject();

      const logs = await setTestUtils.getLogsFromTxHash(txHash);
      const expectedSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);
      const nextSet = await protocolHelper.getSetTokenAsync(expectedSetAddress);

      const actualComponentArray = await nextSet.getComponents.callAsync();
      const expectedComponentArray = [baseAsset, quoteAsset];

      expect(JSON.stringify(actualComponentArray)).to.be.eql(JSON.stringify(expectedComponentArray));
    });

    it('new collateral should have correct units array', async () => {
      const txHash = await subject();

      const logs = await setTestUtils.getLogsFromTxHash(txHash);
      const expectedSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);
      const nextSet = await protocolHelper.getSetTokenAsync(expectedSetAddress);

      const actualUnitsArray = await nextSet.getUnits.callAsync();

      const baseAssetWeight = BigNumber.max(
        subjectTargetBaseAssetAllocation.div(subjectAllocationPrecision.sub(subjectTargetBaseAssetAllocation)),
        ONE
      );
      const quoteAssetWeight = BigNumber.max(
        subjectAllocationPrecision.sub(subjectTargetBaseAssetAllocation).div(subjectTargetBaseAssetAllocation),
        ONE
      );

      const expectedParams = managerHelper.getExpectedGeneralNextSetParameters(
        initialEthPrice,
        initialBtcPrice,
        baseAssetWeight,
        quoteAssetWeight,
        new BigNumber(10 ** 10),
        new BigNumber(100)
      );

      expect(JSON.stringify(actualUnitsArray)).to.be.eql(JSON.stringify(expectedParams['units']));
    });

    it('new collateral should have correct naturalUnit', async () => {
      const txHash = await subject();

      const logs = await setTestUtils.getLogsFromTxHash(txHash);
      const expectedSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);
      const nextSet = await protocolHelper.getSetTokenAsync(expectedSetAddress);

      const actualNaturalUnit = await nextSet.naturalUnit.callAsync();
      const expectedNaturalUnit = new BigNumber(10 ** 12);

      expect(actualNaturalUnit).to.be.bignumber.equal(expectedNaturalUnit);
    });

    describe('but collateral is 4x different in price', async () => {
      beforeEach(async () => {
        subjectTargetBaseAssetAllocation = new BigNumber(25);
      });

      it('new collateral should have correct component array', async () => {
        const txHash = await subject();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const expectedSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);
        const nextSet = await protocolHelper.getSetTokenAsync(expectedSetAddress);

        const actualComponentArray = await nextSet.getComponents.callAsync();
        const expectedComponentArray = [baseAsset, quoteAsset];

        expect(JSON.stringify(actualComponentArray)).to.be.eql(JSON.stringify(expectedComponentArray));
      });

      it('new collateral should have correct units array', async () => {
        const txHash = await subject();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const expectedSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);
        const nextSet = await protocolHelper.getSetTokenAsync(expectedSetAddress);

        const actualUnitsArray = await nextSet.getUnits.callAsync();

        const baseAssetWeight = BigNumber.max(
          subjectTargetBaseAssetAllocation.div(subjectAllocationPrecision.sub(subjectTargetBaseAssetAllocation)),
          ONE
        );
        const quoteAssetWeight = BigNumber.max(
          subjectAllocationPrecision.sub(subjectTargetBaseAssetAllocation).div(subjectTargetBaseAssetAllocation),
          ONE
        );

        const expectedParams = managerHelper.getExpectedGeneralNextSetParameters(
          initialEthPrice,
          initialBtcPrice,
          baseAssetWeight,
          quoteAssetWeight,
          new BigNumber(10 ** 10),
          new BigNumber(100)
        );

        expect(JSON.stringify(actualUnitsArray)).to.be.eql(JSON.stringify(expectedParams['units']));
      });

      it('new collateral should have correct naturalUnit', async () => {
        const txHash = await subject();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const expectedSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);
        const nextSet = await protocolHelper.getSetTokenAsync(expectedSetAddress);

        const actualNaturalUnit = await nextSet.naturalUnit.callAsync();
        const expectedNaturalUnit = new BigNumber(10 ** 12);

        expect(actualNaturalUnit).to.be.bignumber.equal(expectedNaturalUnit);
      });
    });
  });

  describe('#calculateCollateralSetValue', async () => {
    let subjectCollateralSet: Address;

    let units: BigNumber[];
    let components: Address[];

    before(async () => {
      units = [new BigNumber(4.5 * 10 ** 10), new BigNumber(1)];
      components = [wrappedETH.address, wrappedBTC.address];
    });

    beforeEach(async () => {
      allocator = await managerHelper.deployWeightedAllocatorAsync(
        wrappedETH.address,
        wrappedBTC.address,
        ethOracleProxy.address,
        btcOracleProxy.address,
        core.address,
        factory.address
      );

      const naturalUnit = new BigNumber(10 ** 10);
      const setToken = await protocolHelper.createSetTokenAsync(
        core,
        factory.address,
        components,
        units,
        naturalUnit
      );

      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        ethOracleProxy,
        [allocator.address]
      );

      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        btcOracleProxy,
        [allocator.address]
      );

      subjectCollateralSet = setToken.address;
    });

    async function subject(): Promise<BigNumber> {
      return allocator.calculateCollateralSetValue.callAsync(
        subjectCollateralSet
      );
    }

    it('sets the correct base asset address', async () => {
      const actualValue = await subject();

      const expectedValue = initialEthPrice.mul(4.5).add(initialBtcPrice);

      expect(actualValue).to.be.bignumber.equal(expectedValue);
    });

    describe('but quote asset is first in array', async () => {
      before(async () => {
        units = [new BigNumber(1), new BigNumber(4.5 * 10 ** 10)];
        components = [wrappedBTC.address, wrappedETH.address];
      });

      after(async () => {
        units = [new BigNumber(4.5 * 10 ** 10), new BigNumber(1)];
        components = [wrappedETH.address, wrappedBTC.address];
      });

      it('sets the correct base asset address', async () => {
        const actualValue = await subject();

        const expectedValue = initialEthPrice.mul(4.5).add(initialBtcPrice);

        expect(actualValue).to.be.bignumber.equal(expectedValue);
      });
    });
  });
});