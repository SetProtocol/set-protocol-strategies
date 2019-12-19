require('module-alias/register');

import * as _ from 'lodash';
import * as ABIDecoder from 'abi-decoder';
import * as chai from 'chai';
import * as setProtocolUtils from 'set-protocol-utils';

import { Address, Bytes } from 'set-protocol-utils';
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
  SocialAllocatorContract,
} from '@utils/contracts';

import {
  ONE_DAY_IN_SECONDS,
  ONE,
  WBTC_DECIMALS,
  ZERO
} from '@utils/constants';

import { expectRevertError } from '@utils/tokenAssertions';
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
const { SetProtocolUtils: SetUtils, SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;
const setTestUtils = new SetTestUtils(web3);

contract('SocialAllocator', accounts => {
  const [
    deployerAccount,
  ] = accounts;

  let core: CoreContract;
  let factory: SetTokenFactoryContract;
  let whiteList: WhiteListContract;
  let oracleWhiteList: Address;
  let wrappedBTC: StandardTokenMockContract;
  let wrappedETH: WethMockContract;

  let ethMedianizer: MedianContract;
  let ethLegacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let ethOracleProxy: OracleProxyContract;

  let btcMedianizer: MedianContract;
  let btcLegacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let btcOracleProxy: OracleProxyContract;

  let allocator: SocialAllocatorContract;

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

    oracleWhiteList = await protocolHelper.deployOracleWhiteListAsync(
      [wrappedETH.address, wrappedBTC.address],
      [ethOracleProxy.address, btcOracleProxy.address],
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectBaseAsset: Address;
    let subjectQuoteAsset: Address;
    let subjectOracleWhiteList: Address;
    let subjectCore: Address;
    let subjectSetTokenFactory: Address;
    let subjectPricePrecision: BigNumber;
    let subjectCollateralName: Bytes;
    let subjectCollateralSymbol: Bytes;

    beforeEach(async () => {
      subjectBaseAsset = wrappedETH.address;
      subjectQuoteAsset = wrappedBTC.address;
      subjectOracleWhiteList = oracleWhiteList;
      subjectCore = core.address;
      subjectSetTokenFactory = factory.address;
      subjectPricePrecision = new BigNumber(100);
      subjectCollateralName = SetUtils.stringToBytes('CollateralName');
      subjectCollateralSymbol = SetUtils.stringToBytes('COL');
    });

    async function subject(): Promise<SocialAllocatorContract> {
      return managerHelper.deploySocialAllocatorAsync(
        subjectBaseAsset,
        subjectQuoteAsset,
        subjectOracleWhiteList,
        subjectCore,
        subjectSetTokenFactory,
        subjectPricePrecision,
        subjectCollateralName,
        subjectCollateralSymbol
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

    it('sets the correct oracleWhiteList address', async () => {
      allocator = await subject();

      const actualOracleWhiteList = await allocator.oracleWhiteList.callAsync();

      expect(actualOracleWhiteList).to.equal(subjectOracleWhiteList);
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

    it('sets the correct collateral name', async () => {
      allocator = await subject();

      const actualCollateralName = await allocator.collateralName.callAsync();

      expect(actualCollateralName).to.equal(subjectCollateralName);
    });

    it('sets the correct collateral symbol', async () => {
      allocator = await subject();

      const actualCollateralSymbol = await allocator.collateralSymbol.callAsync();

      expect(actualCollateralSymbol).to.equal(subjectCollateralSymbol);
    });
  });

  describe('#determineNewAllocation', async () => {
    let subjectTargetBaseAssetAllocation: BigNumber;

    let baseAsset: Address;
    let quoteAsset: Address;

    const scaleFactor = new BigNumber(10 ** 18);

    beforeEach(async () => {
      baseAsset = wrappedETH.address;
      quoteAsset = wrappedBTC.address;
      allocator = await managerHelper.deploySocialAllocatorAsync(
        baseAsset,
        quoteAsset,
        oracleWhiteList,
        core.address,
        factory.address
      );

      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        ethOracleProxy,
        [allocator.address]
      );

      await oracleHelper.addAuthorizedAddressesToOracleProxy(
        btcOracleProxy,
        [allocator.address]
      );

      subjectTargetBaseAssetAllocation = ether(.75);
    });

    async function subject(): Promise<string> {
      return allocator.determineNewAllocation.sendTransactionAsync(
        subjectTargetBaseAssetAllocation,
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
        subjectTargetBaseAssetAllocation.div(scaleFactor.sub(subjectTargetBaseAssetAllocation)),
        ONE
      );
      const quoteAssetWeight = BigNumber.max(
        scaleFactor.sub(subjectTargetBaseAssetAllocation).div(subjectTargetBaseAssetAllocation),
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

    describe('but new allocation is all base asset', async () => {
      beforeEach(async () => {
        subjectTargetBaseAssetAllocation = ether(1);
      });

      it('new collateral should have correct component array', async () => {
        const txHash = await subject();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const expectedSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);
        const nextSet = await protocolHelper.getSetTokenAsync(expectedSetAddress);

        const actualComponentArray = await nextSet.getComponents.callAsync();
        const expectedComponentArray = [baseAsset];

        expect(JSON.stringify(actualComponentArray)).to.be.eql(JSON.stringify(expectedComponentArray));
      });

      it('new collateral should have correct units array', async () => {
        const txHash = await subject();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const expectedSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);
        const nextSet = await protocolHelper.getSetTokenAsync(expectedSetAddress);

        const actualUnitsArray = await nextSet.getUnits.callAsync();

        const baseAssetWeight = new BigNumber(4);
        const quoteAssetWeight = ZERO;

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

      it('new collateral should have correct collateralName', async () => {
        const txHash = await subject();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const expectedSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);
        const nextSet = await protocolHelper.getSetTokenAsync(expectedSetAddress);

        const actualCollateralName = await nextSet.name.callAsync();
        const expectedCollateralName = 'CollateralName';

        expect(actualCollateralName).to.equal(expectedCollateralName);
      });

      it('new collateral should have correct collateralSymbol', async () => {
        const txHash = await subject();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const expectedSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);
        const nextSet = await protocolHelper.getSetTokenAsync(expectedSetAddress);

        const actualCollateralSymbol = await nextSet.symbol.callAsync();
        const expectedCollateralSymbol = 'COL';

        expect(actualCollateralSymbol).to.equal(expectedCollateralSymbol);
      });
    });

    describe('but new allocation is all quote asset', async () => {
      beforeEach(async () => {
        subjectTargetBaseAssetAllocation = ZERO;
      });

      it('new collateral should have correct component array', async () => {
        const txHash = await subject();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const expectedSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);
        const nextSet = await protocolHelper.getSetTokenAsync(expectedSetAddress);

        const actualComponentArray = await nextSet.getComponents.callAsync();
        const expectedComponentArray = [quoteAsset];

        expect(JSON.stringify(actualComponentArray)).to.be.eql(JSON.stringify(expectedComponentArray));
      });

      it('new collateral should have correct units array', async () => {
        const txHash = await subject();

        const logs = await setTestUtils.getLogsFromTxHash(txHash);
        const expectedSetAddress = extractNewSetTokenAddressFromLogs([logs[0]]);
        const nextSet = await protocolHelper.getSetTokenAsync(expectedSetAddress);

        const actualUnitsArray = await nextSet.getUnits.callAsync();

        const baseAssetWeight = ZERO;
        const quoteAssetWeight = new BigNumber(4);

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

    describe('but new allocation is greater than 100%', async () => {
      beforeEach(async () => {
        subjectTargetBaseAssetAllocation = ether(2);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
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
      allocator = await managerHelper.deploySocialAllocatorAsync(
        wrappedETH.address,
        wrappedBTC.address,
        oracleWhiteList,
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