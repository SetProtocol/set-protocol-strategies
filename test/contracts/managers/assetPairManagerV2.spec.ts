require('module-alias/register');

import * as _ from 'lodash';
import * as ABIDecoder from 'abi-decoder';
import * as chai from 'chai';
import * as setProtocolUtils from 'set-protocol-utils';

import { Address, Bytes } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import { Blockchain } from 'set-protocol-contracts';
import { ether } from '@utils/units';
import {
  CoreContract,
  LinearAuctionLiquidatorContract,
  OracleWhiteListContract,
  PerformanceFeeCalculatorContract,
  RebalancingSetTokenV3Contract,
  RebalancingSetTokenV3FactoryContract,
  SetTokenContract,
  SetTokenFactoryContract,
  StandardTokenMockContract,
  TransferProxyContract,
  WethMockContract,
  WhiteListContract,
} from 'set-protocol-contracts';
import {
  LegacyMakerOracleAdapterContract,
  MedianContract,
  OracleProxyContract,
} from 'set-protocol-oracles';
import {
  AssetPairManagerV2Contract,
  BinaryAllocatorMockContract,
  TriggerMockContract,
} from '@utils/contracts';

import {
  DEFAULT_GAS,
  NON_ZERO_BYTES,
  ONE_DAY_IN_SECONDS,
  ONE_HOUR_IN_SECONDS,
  WBTC_DECIMALS,
  ZERO,
  ZERO_BYTES
} from '@utils/constants';

import { expectRevertError } from '@utils/tokenAssertions';
import { LogInitialProposeCalled } from '@utils/contract_logs/assetPairManager';
import { getWeb3, blankTxn } from '@utils/web3Helper';

import { OracleHelper } from 'set-protocol-oracles';
import { ERC20Helper } from '@utils/helpers/erc20Helper';
import { ManagerHelper } from '@utils/helpers/managerHelper';
import { ProtocolHelper } from '@utils/helpers/protocolHelper';
import {
  CoreHelper,
  ERC20Helper as ERC20Contracts,
  FeeCalculatorHelper,
  LiquidatorHelper,
  ValuationHelper
} from 'set-protocol-contracts';

const Core = require('set-protocol-contracts/dist/artifacts/ts/Core').Core;

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const AssetPairManagerV2 = artifacts.require('AssetPairManagerV2');
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;
const setTestUtils = new SetTestUtils(web3);

contract('AssetPairManagerV2', accounts => {
  const [
    deployerAccount,
    feeRecipient,
    newLiquidator,
    attackerAccount,
  ] = accounts;

  let rebalancingSetToken: RebalancingSetTokenV3Contract;

  let core: CoreContract;
  let transferProxy: TransferProxyContract;
  let factory: SetTokenFactoryContract;
  let rebalancingComponentWhiteList: WhiteListContract;
  let wrappedBTC: StandardTokenMockContract;
  let wrappedETH: WethMockContract;

  let liquidator: LinearAuctionLiquidatorContract;
  let feeCalculator: PerformanceFeeCalculatorContract;
  let rebalancingFactory: RebalancingSetTokenV3FactoryContract;
  let oracleWhiteList: OracleWhiteListContract;
  let liquidatorWhiteList: WhiteListContract;
  let feeCalculatorWhiteList: WhiteListContract;

  let ethMedianizer: MedianContract;
  let ethLegacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let ethOracleProxy: OracleProxyContract;

  let btcMedianizer: MedianContract;
  let btcLegacyMakerOracleAdapter: LegacyMakerOracleAdapterContract;
  let btcOracleProxy: OracleProxyContract;

  let allocator: BinaryAllocatorMockContract;
  let trigger: TriggerMockContract;

  let initialEthPrice: BigNumber;
  let initialBtcPrice: BigNumber;

  let setManager: AssetPairManagerV2Contract;
  let quoteAssetCollateral: SetTokenContract;
  let baseAssetCollateral: SetTokenContract;

  const baseAssetCollateralValue = ether(150);
  const quoteAssetCollateralValue = ether(100);

  const protocolHelper = new ProtocolHelper(deployerAccount);
  const erc20Helper = new ERC20Helper(deployerAccount);
  const managerHelper = new ManagerHelper(deployerAccount);
  const oracleHelper = new OracleHelper(deployerAccount);

  const coreHelper = new CoreHelper(deployerAccount, deployerAccount);
  const feeCalculatorHelper = new FeeCalculatorHelper(deployerAccount);
  const ercContracts = new ERC20Contracts(deployerAccount);
  const valuationHelper = new ValuationHelper(deployerAccount, coreHelper, ercContracts, oracleHelper);
  const liquidatorHelper = new LiquidatorHelper(deployerAccount, ercContracts, valuationHelper);

  before(async () => {
    ABIDecoder.addABI(Core.abi);
    ABIDecoder.addABI(AssetPairManagerV2.abi);
  });

  after(async () => {
    ABIDecoder.removeABI(Core.abi);
    ABIDecoder.removeABI(AssetPairManagerV2.abi);
  });

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    transferProxy = await protocolHelper.getDeployedTransferProxyAsync();
    core = await protocolHelper.getDeployedCoreAsync();

    factory = await protocolHelper.getDeployedSetTokenFactoryAsync();
    rebalancingComponentWhiteList = await protocolHelper.getDeployedWhiteList();

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

    wrappedETH = await protocolHelper.getDeployedWETHAsync();
    wrappedBTC = await erc20Helper.deployTokenAsync(deployerAccount, WBTC_DECIMALS);
    await protocolHelper.addTokenToWhiteList(wrappedBTC.address, rebalancingComponentWhiteList);
    await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS.mul(7));
    await protocolHelper.addTokenToWhiteList(wrappedBTC.address, rebalancingComponentWhiteList);

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

    oracleWhiteList = await coreHelper.deployOracleWhiteListAsync(
      [wrappedETH.address, wrappedBTC.address],
      [ethOracleProxy.address, btcOracleProxy.address],
    );

    liquidator = await liquidatorHelper.deployLinearAuctionLiquidatorAsync(
      core.address,
      oracleWhiteList.address,
      ONE_HOUR_IN_SECONDS.mul(4),
      new BigNumber(3),
      new BigNumber(21),
      'LinearAuctionLiquidator'
    );
    liquidatorWhiteList = await coreHelper.deployWhiteListAsync([liquidator.address, newLiquidator]);

    feeCalculator = await feeCalculatorHelper.deployPerformanceFeeCalculatorAsync(
      core.address,
      oracleWhiteList.address,
      ether(.4),
      ether(.05)
    );
    feeCalculatorWhiteList = await coreHelper.deployWhiteListAsync([feeCalculator.address]);

    rebalancingFactory = await coreHelper.deployRebalancingSetTokenV3FactoryAsync(
      core.address,
      rebalancingComponentWhiteList.address,
      liquidatorWhiteList.address,
      feeCalculatorWhiteList.address,
    );

    await core.addFactory.sendTransactionAsync(rebalancingFactory.address, { from: deployerAccount });
    await blockchain.increaseTimeAsync(new BigNumber(2));
    await core.addFactory.sendTransactionAsync(rebalancingFactory.address, { from: deployerAccount });
    await erc20Helper.approveTransfersAsync(
      [wrappedBTC, wrappedETH],
      transferProxy.address
    );

    quoteAssetCollateral = await protocolHelper.createSetTokenAsync(
      core,
      factory.address,
      [wrappedBTC.address],
      [new BigNumber(1)],
      new BigNumber(10 ** 10),
    );

    baseAssetCollateral = await protocolHelper.createSetTokenAsync(
      core,
      factory.address,
      [wrappedETH.address],
      [new BigNumber(33554432)],
      new BigNumber(10 ** 6),
    );

    allocator = await managerHelper.deployBinaryAllocatorMockAsync(
      baseAssetCollateral.address,
      quoteAssetCollateral.address,
      baseAssetCollateralValue,
      quoteAssetCollateralValue,
    );

    [trigger] = await managerHelper.deployTriggerMocksAsync(1, [false]);

    await oracleHelper.addAuthorizedAddressesToOracleProxy(
      ethOracleProxy,
      [allocator.address, liquidator.address, feeCalculator.address]
    );

    await oracleHelper.addAuthorizedAddressesToOracleProxy(
      btcOracleProxy,
      [allocator.address, liquidator.address, feeCalculator.address]
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectCore: Address;
    let subjectAllocator: Address;
    let subjectTrigger: Address;
    let subjectUseBullishAllocation: boolean;
    let subjectAllocationDenominator: BigNumber;
    let subjectBullishBaseAssetAllocation: BigNumber;
    let subjectSignalConfirmationMinTime: BigNumber;
    let subjectSignalConfirmationMaxTime: BigNumber;
    let subjectLiquidatorData: Bytes;
    let subjectCaller: Address;

    beforeEach(async () => {
      subjectCore = core.address;
      subjectAllocator = allocator.address;
      subjectTrigger = trigger.address;
      subjectUseBullishAllocation = true;
      subjectAllocationDenominator = new BigNumber(100);
      subjectBullishBaseAssetAllocation = new BigNumber(100);
      subjectSignalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      subjectSignalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      subjectLiquidatorData = NON_ZERO_BYTES;
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<AssetPairManagerV2Contract> {
      return managerHelper.deployAssetPairManagerV2Async(
        subjectCore,
        subjectAllocator,
        subjectTrigger,
        subjectUseBullishAllocation,
        subjectAllocationDenominator,
        subjectBullishBaseAssetAllocation,
        subjectSignalConfirmationMinTime,
        subjectSignalConfirmationMaxTime,
        subjectLiquidatorData,
        subjectCaller,
      );
    }

    it('sets the correct core address', async () => {
      setManager = await subject();

      const actualCore = await setManager.core.callAsync();

      expect(actualCore).to.equal(subjectCore);
    });

    it('sets the correct allocator address', async () => {
      setManager = await subject();

      const actualAllocator = await setManager.allocator.callAsync();

      expect(actualAllocator).to.equal(subjectAllocator);
    });

    it('sets the correct trigger address', async () => {
      setManager = await subject();

      const actualTrigger = await setManager.trigger.callAsync();

      expect(actualTrigger).to.equal(subjectTrigger);
    });

    it('sets the correct baseAssetAllocation', async () => {
      setManager = await subject();

      const actualBaseAssetAllocation = await setManager.baseAssetAllocation.callAsync();

      expect(actualBaseAssetAllocation).to.be.bignumber.equal(subjectBullishBaseAssetAllocation);
    });

    it('sets the correct allocationDenominator', async () => {
      setManager = await subject();

      const actualAllocationDenominator = await setManager.allocationDenominator.callAsync();

      expect(actualAllocationDenominator).to.be.bignumber.equal(subjectAllocationDenominator);
    });

    it('sets the correct bullishBaseAssetAllocation', async () => {
      setManager = await subject();

      const actualBullishBaseAssetAllocation = await setManager.bullishBaseAssetAllocation.callAsync();

      expect(actualBullishBaseAssetAllocation).to.be.bignumber.equal(subjectBullishBaseAssetAllocation);
    });

    it('sets the correct bearishBaseAssetAllocation', async () => {
      setManager = await subject();

      const actualBearishBaseAssetAllocation = await setManager.bearishBaseAssetAllocation.callAsync();
      const expectedBearishBaseAssetAllocation = subjectAllocationDenominator.sub(subjectBullishBaseAssetAllocation);
      expect(actualBearishBaseAssetAllocation).to.be.bignumber.equal(expectedBearishBaseAssetAllocation);
    });

    it('sets the correct signalConfirmationMinTime', async () => {
      setManager = await subject();

      const actualSignalConfirmationMinTime = await setManager.signalConfirmationMinTime.callAsync();

      expect(actualSignalConfirmationMinTime).to.be.bignumber.equal(subjectSignalConfirmationMinTime);
    });

    it('sets the correct signalConfirmationMaxTime', async () => {
      setManager = await subject();

      const actualSignalConfirmationMaxTime = await setManager.signalConfirmationMaxTime.callAsync();

      expect(actualSignalConfirmationMaxTime).to.be.bignumber.equal(subjectSignalConfirmationMaxTime);
    });

    it('sets the correct liquidatorData', async () => {
      setManager = await subject();

      const actualLiquidatorData = await setManager.liquidatorData.callAsync();

      expect(actualLiquidatorData).to.be.bignumber.equal(subjectLiquidatorData);
    });

    describe('when useBullishAllocation is false', async () => {
      beforeEach(async () => {
        subjectUseBullishAllocation = false;
      });

      it('should set the correct baseAssetAllocation', async () => {
        setManager = await subject();

        const actualBaseAssetAllocation = await setManager.baseAssetAllocation.callAsync();

        expect(actualBaseAssetAllocation).to.be.bignumber.equal(ZERO);
      });
    });

    describe('but signalConfirmationMinTime is greater than signalConfirmationMaxTime', async () => {
      beforeEach(async () => {
        subjectSignalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(5);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('but bullishBaseAssetAllocation exceeds than allocationDenominator', async () => {
      beforeEach(async () => {
        subjectBullishBaseAssetAllocation = subjectAllocationDenominator.add(1);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#initialize', async () => {
    let subjectRebalancingSetToken: Address;
    let subjectCaller: Address;

    beforeEach(async () => {
      const useBullishAllocation = false;
      const allocationDenominator = new BigNumber(100);
      const maxBaseAssetAllocation = new BigNumber(100);
      const signalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      const signalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      const liquidatorData = NON_ZERO_BYTES;
      subjectCaller = deployerAccount;
      setManager = await managerHelper.deployAssetPairManagerV2Async(
        core.address,
        allocator.address,
        trigger.address,
        useBullishAllocation,
        allocationDenominator,
        maxBaseAssetAllocation,
        signalConfirmationMinTime,
        signalConfirmationMaxTime,
        liquidatorData,
        subjectCaller
      );

      rebalancingSetToken = await protocolHelper.createDefaultRebalancingSetTokenV3Async(
        core,
        rebalancingFactory.address,
        setManager.address,
        liquidator.address,
        feeRecipient,
        feeCalculator.address,
        quoteAssetCollateral.address,
        ONE_DAY_IN_SECONDS,
        undefined,
      );
      subjectRebalancingSetToken = rebalancingSetToken.address;
    });

    async function subject(): Promise<string> {
      return setManager.initialize.sendTransactionAsync(
        subjectRebalancingSetToken,
        { from: subjectCaller, gas: DEFAULT_GAS }
      );
    }

    it('sets the rebalancing set token address', async () => {
      await subject();

      const actualRebalancingSetToken = await setManager.rebalancingSetToken.callAsync();

      expect(actualRebalancingSetToken).to.equal(subjectRebalancingSetToken);
    });

    describe('but caller is not the contract deployer', async () => {
      beforeEach(async () => {
        subjectCaller = feeRecipient;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('but the passed rebalancing set address was not created by Core', async () => {
      beforeEach(async () => {
        const unTrackedSetToken = await protocolHelper.createDefaultRebalancingSetTokenV3Async(
          core,
          rebalancingFactory.address,
          setManager.address,
          liquidator.address,
          feeRecipient,
          feeCalculator.address,
          quoteAssetCollateral.address,
          ONE_DAY_IN_SECONDS,
          undefined,
          ZERO,
          ZERO,
        );

        await core.disableSet.sendTransactionAsync(
          unTrackedSetToken.address,
          { from: deployerAccount, gas: DEFAULT_GAS },
        );

        subjectRebalancingSetToken = unTrackedSetToken.address;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('but a rebalancing set has already been initialized', async () => {
      beforeEach(async () => {
        // Initialize the first time
        await subject();
      });

      it('should revert', async () => {
        // Attempt to initialize again
        await expectRevertError(subject());
      });
    });
  });

  describe('#initialPropose', async () => {
    let subjectCaller: Address;

    let useBullishAllocation: boolean;
    let timeJump: BigNumber;
    let flipTrigger: boolean;
    let shouldInitialize: boolean;

    before(async () => {
      useBullishAllocation = true;
      flipTrigger = false;
      timeJump = ONE_DAY_IN_SECONDS;
      shouldInitialize = true;
    });

    beforeEach(async () => {
      const allocationDenominator = new BigNumber(100);
      const maxBaseAssetAllocation = new BigNumber(100);
      const signalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      const signalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      const liquidatorData = NON_ZERO_BYTES;
      subjectCaller = deployerAccount;
      setManager = await managerHelper.deployAssetPairManagerV2Async(
        core.address,
        allocator.address,
        trigger.address,
        useBullishAllocation,
        allocationDenominator,
        maxBaseAssetAllocation,
        signalConfirmationMinTime,
        signalConfirmationMaxTime,
        liquidatorData,
        subjectCaller
      );

      let collateralSetAddress: Address;
      if (!useBullishAllocation) {
        collateralSetAddress = quoteAssetCollateral.address;
        await trigger.confirmTrigger.sendTransactionAsync();
      } else {
        collateralSetAddress = baseAssetCollateral.address;
      }

      const lastBlock = await web3.eth.getBlock('latest');
      rebalancingSetToken = await protocolHelper.createDefaultRebalancingSetTokenV3Async(
        core,
        rebalancingFactory.address,
        setManager.address,
        liquidator.address,
        feeRecipient,
        feeCalculator.address,
        collateralSetAddress,
        ONE_DAY_IN_SECONDS,
        new BigNumber(lastBlock.timestamp),
      );

      if (flipTrigger) {
        await trigger.confirmTrigger.sendTransactionAsync();
      }

      if (shouldInitialize) {
        await setManager.initialize.sendTransactionAsync(
          rebalancingSetToken.address,
          { from: subjectCaller, gas: DEFAULT_GAS }
        );
      }

      await blockchain.increaseTimeAsync(timeJump);
      await blankTxn(deployerAccount);

      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      return setManager.initialPropose.sendTransactionAsync(
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    describe('when propose is called from the Default state', async () => {
      describe('and allocating from base asset to quote asset', async () => {
        it('sets the proposalTimestamp correctly', async () => {
          await subject();

          const block = await web3.eth.getBlock('latest');
          const expectedTimestamp = new BigNumber(block.timestamp);

          const actualTimestamp = await setManager.recentInitialProposeTimestamp.callAsync();
          expect(actualTimestamp).to.be.bignumber.equal(expectedTimestamp);
        });

        it('it emits InitialProposeCalled event', async () => {
          const txHash = await subject();

          const formattedLogs = await setTestUtils.getLogsFromTxHash(txHash);
          const expectedLogs = LogInitialProposeCalled(
            rebalancingSetToken.address,
            setManager.address
          );

          await SetTestUtils.assertLogEquivalence(formattedLogs, expectedLogs);
        });

        describe('but allocation has not changed', async () => {
          before(async () => {
            flipTrigger = true;
          });

          after(async () => {
            flipTrigger = false;
          });

          it('should revert', async () => {
            await expectRevertError(subject());
          });
        });

        describe('but manager not initialized', async () => {
          before(async () => {
            shouldInitialize = false;
          });

          after(async () => {
            shouldInitialize = true;
          });

          it('should revert', async () => {
            await expectRevertError(subject());
          });
        });
      });

      describe('and allocating from quote asset to base asset', async () => {
        before(async () => {
          useBullishAllocation = false;
        });

        after(async () => {
          useBullishAllocation = true;
        });

        it('sets the proposalTimestamp correctly', async () => {
          await subject();

          const block = await web3.eth.getBlock('latest');
          const expectedTimestamp = new BigNumber(block.timestamp);

          const actualTimestamp = await setManager.recentInitialProposeTimestamp.callAsync();
          expect(actualTimestamp).to.be.bignumber.equal(expectedTimestamp);
        });

        describe('but allocation has not changed', async () => {
          before(async () => {
            flipTrigger = true;
          });

          after(async () => {
            flipTrigger = false;
          });

          it('should revert', async () => {
            await expectRevertError(subject());
          });
        });
      });

      describe('but not enough time has passed from last initial propose', async () => {
        beforeEach(async () => {
          await setManager.initialPropose.sendTransactionAsync();
        });

        it('should revert', async () => {
          await expectRevertError(subject());
        });
      });

      describe('but rebalance interval has not elapsed', async () => {
        before(async () => {
          timeJump = ZERO;
        });

        after(async () => {
          timeJump = ONE_DAY_IN_SECONDS;
        });

        it('should revert', async () => {
          await expectRevertError(subject());
        });
      });
    });

    describe('when propose is called and rebalancing set token is in Rebalance state', async () => {
      beforeEach(async () => {
        // Issue currentSetToken
        const initialAllocationTokenAddress = await rebalancingSetToken.currentSet.callAsync();
        const initialAllocationToken = await protocolHelper.getSetTokenAsync(initialAllocationTokenAddress);
        await core.issue.sendTransactionAsync(
          initialAllocationToken.address,
          ether(9),
          {from: deployerAccount, gas: DEFAULT_GAS},
        );
        await erc20Helper.approveTransfersAsync([initialAllocationToken], transferProxy.address);

        // Use issued currentSetToken to issue rebalancingSetToken
        await core.issue.sendTransactionAsync(
          rebalancingSetToken.address,
          ether(7),
          { from: deployerAccount, gas: DEFAULT_GAS }
        );

        await setManager.initialPropose.sendTransactionAsync();
        await blockchain.increaseTimeAsync(ONE_HOUR_IN_SECONDS.mul(6));
        await setManager.confirmPropose.sendTransactionAsync();
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#confirmPropose', async () => {
    let subjectTimeFastForward: BigNumber;
    let subjectCaller: Address;

    let useBullishAllocation: boolean;
    let flipTrigger: boolean;
    let shouldInitialize: boolean;

    before(async () => {
      shouldInitialize = true;
      useBullishAllocation = true;
      flipTrigger = false;
    });

    beforeEach(async () => {
      const allocationDenominator = new BigNumber(100);
      const maxBaseAssetAllocation = new BigNumber(100);
      const signalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      const signalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      const liquidatorData = NON_ZERO_BYTES;
      subjectCaller = deployerAccount;
      setManager = await managerHelper.deployAssetPairManagerV2Async(
        core.address,
        allocator.address,
        trigger.address,
        useBullishAllocation,
        allocationDenominator,
        maxBaseAssetAllocation,
        signalConfirmationMinTime,
        signalConfirmationMaxTime,
        liquidatorData,
        subjectCaller
      );

      let collateralSetAddress: Address;
      if (!useBullishAllocation) {
        collateralSetAddress = quoteAssetCollateral.address;
        await trigger.confirmTrigger.sendTransactionAsync();
      } else {
        collateralSetAddress = baseAssetCollateral.address;
      }

      const lastBlock = await web3.eth.getBlock('latest');
      rebalancingSetToken = await protocolHelper.createDefaultRebalancingSetTokenV3Async(
        core,
        rebalancingFactory.address,
        setManager.address,
        liquidator.address,
        feeRecipient,
        feeCalculator.address,
        collateralSetAddress,
        ONE_DAY_IN_SECONDS,
        new BigNumber(lastBlock.timestamp),
      );

      if (shouldInitialize) {
        await setManager.initialize.sendTransactionAsync(
          rebalancingSetToken.address,
          { from: subjectCaller, gas: DEFAULT_GAS}
        );

        await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS);

        await setManager.initialPropose.sendTransactionAsync();
      }

      if (flipTrigger) {
        await trigger.confirmTrigger.sendTransactionAsync();
      }

      // Issue currentSetToken
      const initialAllocationToken = await protocolHelper.getSetTokenAsync(collateralSetAddress);
      await core.issue.sendTransactionAsync(
        initialAllocationToken.address,
        ether(9),
        {from: deployerAccount, gas: DEFAULT_GAS},
      );
      await erc20Helper.approveTransfersAsync([initialAllocationToken], transferProxy.address);

      // Use issued currentSetToken to issue rebalancingSetToken
      await core.issue.sendTransactionAsync(
        rebalancingSetToken.address,
        ether(7),
        { from: deployerAccount, gas: DEFAULT_GAS }
      );

      subjectTimeFastForward = ONE_HOUR_IN_SECONDS.mul(7);
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      await blockchain.increaseTimeAsync(subjectTimeFastForward);
      return setManager.confirmPropose.sendTransactionAsync(
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    describe('when propose is called from the Default state', async () => {
      describe('and allocating from base asset to quote asset', async () => {
        it('transitions to Rebalance', async () => {
          await subject();

          const rebalanceState = await rebalancingSetToken.rebalanceState.callAsync();
          expect(rebalanceState).to.be.bignumber.equal(2);
        });

        it('updates the baseAssetAllocation correctly', async () => {
          await subject();

          const actualBaseAssetAllocation = await setManager.baseAssetAllocation.callAsync();
          expect(actualBaseAssetAllocation).to.be.bignumber.equal(ZERO);
        });

        it('updates to the next set correctly', async () => {
          await subject();

          const actualNextSet = await rebalancingSetToken.nextSet.callAsync();
          expect(actualNextSet).to.equal(quoteAssetCollateral.address);
        });

        describe('but allocation has not changed', async () => {
          before(async () => {
            flipTrigger = true;
          });

          after(async () => {
            flipTrigger = false;
          });

          it('should revert', async () => {
            await expectRevertError(subject());
          });
        });

        describe('but not enough time has passed from initialTrigger', async () => {
          beforeEach(async () => {
            subjectTimeFastForward = ZERO;
          });

          it('should revert', async () => {
            await expectRevertError(subject());
          });
        });

        describe('but manager not initialized', async () => {
          before(async () => {
            shouldInitialize = false;
          });

          after(async () => {
            shouldInitialize = true;
          });

          it('should revert', async () => {
            await expectRevertError(subject());
          });
        });
      });

      describe('and allocating from quote asset to base asset', async () => {
        before(async () => {
          useBullishAllocation = false;
        });

        it('transitions to Rebalance', async () => {
          await subject();

          const rebalanceState = await rebalancingSetToken.rebalanceState.callAsync();
          expect(rebalanceState).to.be.bignumber.equal(2);
        });

        it('updates the baseAssetAllocation correctly', async () => {
          await subject();

          const actualBaseAssetAllocation = await setManager.baseAssetAllocation.callAsync();
          expect(actualBaseAssetAllocation).to.be.bignumber.equal(new BigNumber(100));
        });

        it('updates to the next set correctly', async () => {
          await subject();

          const actualNextSet = await rebalancingSetToken.nextSet.callAsync();
          expect(actualNextSet).to.equal(baseAssetCollateral.address);
        });

        describe('but allocation has not changed', async () => {
          before(async () => {
            flipTrigger = true;
          });

          after(async () => {
            flipTrigger = false;
          });

          it('should revert', async () => {
            await expectRevertError(subject());
          });
        });
      });
    });

    describe('when propose is called and rebalancing set token is in Rebalance state', async () => {
      beforeEach(async () => {
        await blockchain.increaseTimeAsync(ONE_HOUR_IN_SECONDS.mul(6));
        await setManager.confirmPropose.sendTransactionAsync();
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#setLiquidator', async () => {
    let subjectCaller: Address;
    let subjectNewLiquidator: Address;

    beforeEach(async () => {
      const allocationDenominator = new BigNumber(100);
      const maxBaseAssetAllocation = new BigNumber(100);
      const signalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      const signalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      const liquidatorData = NON_ZERO_BYTES;
      subjectCaller = deployerAccount;
      setManager = await managerHelper.deployAssetPairManagerV2Async(
        core.address,
        allocator.address,
        trigger.address,
        false,
        allocationDenominator,
        maxBaseAssetAllocation,
        signalConfirmationMinTime,
        signalConfirmationMaxTime,
        liquidatorData,
        subjectCaller
      );

      const lastBlock = await web3.eth.getBlock('latest');
      rebalancingSetToken = await protocolHelper.createDefaultRebalancingSetTokenV3Async(
        core,
        rebalancingFactory.address,
        setManager.address,
        liquidator.address,
        feeRecipient,
        feeCalculator.address,
        quoteAssetCollateral.address,
        ONE_DAY_IN_SECONDS,
        new BigNumber(lastBlock.timestamp),
      );

      await setManager.initialize.sendTransactionAsync(
        rebalancingSetToken.address,
        { from: subjectCaller, gas: DEFAULT_GAS}
      );

      subjectCaller = deployerAccount;
      subjectNewLiquidator = newLiquidator;
    });

    async function subject(): Promise<string> {
      return setManager.setLiquidator.sendTransactionAsync(
        subjectNewLiquidator,
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    it('sets the new liquidator correctly', async () => {
      await subject();

      const actualLiquidator = await rebalancingSetToken.liquidator.callAsync();

      expect(actualLiquidator).to.equal(subjectNewLiquidator);
    });

    describe('but caller is not owner', async () => {
      beforeEach(async () => {
        subjectCaller = attackerAccount;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#setLiquidatorData', async () => {
    let subjectCaller: Address;
    let subjectLiquidatorData: Bytes;

    beforeEach(async () => {
      const allocationDenominator = new BigNumber(100);
      const maxBaseAssetAllocation = new BigNumber(100);
      const signalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      const signalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      const liquidatorData = NON_ZERO_BYTES;
      subjectCaller = deployerAccount;
      setManager = await managerHelper.deployAssetPairManagerV2Async(
        core.address,
        allocator.address,
        trigger.address,
        false,
        allocationDenominator,
        maxBaseAssetAllocation,
        signalConfirmationMinTime,
        signalConfirmationMaxTime,
        liquidatorData,
        subjectCaller
      );

      const lastBlock = await web3.eth.getBlock('latest');
      rebalancingSetToken = await protocolHelper.createDefaultRebalancingSetTokenV3Async(
        core,
        rebalancingFactory.address,
        setManager.address,
        liquidator.address,
        feeRecipient,
        feeCalculator.address,
        quoteAssetCollateral.address,
        ONE_DAY_IN_SECONDS,
        new BigNumber(lastBlock.timestamp),
      );

      await setManager.initialize.sendTransactionAsync(
        rebalancingSetToken.address,
        { from: subjectCaller, gas: DEFAULT_GAS}
      );

      subjectCaller = deployerAccount;
      subjectLiquidatorData = ZERO_BYTES;
    });

    async function subject(): Promise<string> {
      return setManager.setLiquidatorData.sendTransactionAsync(
        subjectLiquidatorData,
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    it('sets the new liquidator data correctly', async () => {
      await subject();

      const actualLiquidatorData = await setManager.liquidatorData.callAsync();

      expect(actualLiquidatorData).to.equal(subjectLiquidatorData);
    });

    describe('but caller is not owner', async () => {
      beforeEach(async () => {
        subjectCaller = attackerAccount;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#adjustFee', async () => {
    let subjectNewFeeCallData: string;
    let subjectCaller: Address;

    let feeType: BigNumber;
    let newFeePercentage: BigNumber;

    before(async () => {
      feeType = ZERO;
      newFeePercentage = ether(.03);
    });

    beforeEach(async () => {
      const allocationDenominator = new BigNumber(100);
      const maxBaseAssetAllocation = new BigNumber(100);
      const signalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      const signalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      const liquidatorData = NON_ZERO_BYTES;
      subjectCaller = deployerAccount;

      setManager = await managerHelper.deployAssetPairManagerV2Async(
        core.address,
        allocator.address,
        trigger.address,
        false,
        allocationDenominator,
        maxBaseAssetAllocation,
        signalConfirmationMinTime,
        signalConfirmationMaxTime,
        liquidatorData,
        subjectCaller
      );

      await setManager.setTimeLockPeriod.sendTransactionAsync(ONE_DAY_IN_SECONDS, { from: deployerAccount });

      const lastBlock = await web3.eth.getBlock('latest');
      rebalancingSetToken = await protocolHelper.createDefaultRebalancingSetTokenV3Async(
        core,
        rebalancingFactory.address,
        setManager.address,
        liquidator.address,
        feeRecipient,
        feeCalculator.address,
        quoteAssetCollateral.address,
        ONE_DAY_IN_SECONDS,
        new BigNumber(lastBlock.timestamp),
      );

      await setManager.initialize.sendTransactionAsync(
        rebalancingSetToken.address,
        { from: subjectCaller, gas: DEFAULT_GAS}
      );

      subjectNewFeeCallData = feeCalculatorHelper.generateAdjustFeeCallData(feeType, newFeePercentage);
      subjectCaller = deployerAccount;

      // Issue currentSetToken
      const initialAllocationToken = await protocolHelper.getSetTokenAsync(quoteAssetCollateral.address);
      await core.issue.sendTransactionAsync(
        initialAllocationToken.address,
        ether(9),
        {from: deployerAccount, gas: DEFAULT_GAS},
      );
      await erc20Helper.approveTransfersAsync([initialAllocationToken], transferProxy.address);

      // Use issued currentSetToken to issue rebalancingSetToken
      await core.issue.sendTransactionAsync(
        rebalancingSetToken.address,
        ether(7),
        { from: deployerAccount, gas: DEFAULT_GAS }
      );
    });

    async function subject(): Promise<string> {
      return setManager.adjustFee.sendTransactionAsync(
        subjectNewFeeCallData,
        { from: subjectCaller }
      );
    }

    it('sets the upgradeHash', async () => {
      const txHash = await subject();
      const { blockHash, input } = await web3.eth.getTransaction(txHash);
      const { timestamp } = await web3.eth.getBlock(blockHash);

      const upgradeHash = web3.utils.soliditySha3(input);
      const actualTimestamp = await setManager.timeLockedUpgrades.callAsync(upgradeHash);
      expect(actualTimestamp).to.bignumber.equal(timestamp);
    });

    describe('when called to confirm set streaming fee txn', async () => {
      beforeEach(async () => {
        await subject();

        await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS);
        await blockchain.mineBlockAsync();
      });

      it('sets the streaming fee percentage correctly', async () => {
        await subject();

        const feeState: any = await feeCalculator.feeState.callAsync(rebalancingSetToken.address);
        expect(feeState.streamingFeePercentage).to.be.bignumber.equal(newFeePercentage);
      });
    });

    describe('when called to confirm set profit fee txn', async () => {
      before(async () => {
        feeType = new BigNumber(1);
        newFeePercentage = ether(.25);
      });

      after(async () => {
        feeType = ZERO;
        newFeePercentage = ether(.03);
      });

      beforeEach(async () => {
        await subject();

        await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS);
        await blockchain.mineBlockAsync();
      });

      it('sets the profit fee percentage correctly', async () => {
        await subject();

        const feeState: any = await feeCalculator.feeState.callAsync(rebalancingSetToken.address);
        expect(feeState.profitFeePercentage).to.be.bignumber.equal(newFeePercentage);
      });
    });

    describe('when time lock period has not elapsed', async () => {
      beforeEach(async () => {
        await subject();
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('when caller is not owner', async () => {
      beforeEach(async () => {
        subjectCaller = attackerAccount;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#removeRegisteredUpgrade', async () => {
    let subjectUpgradeHash: string;
    let subjectCaller: Address;

    let feeType: BigNumber;
    let newFeePercentage: BigNumber;

    before(async () => {
      feeType = ZERO;
      newFeePercentage = ether(.03);
    });

    beforeEach(async () => {
      const allocationDenominator = new BigNumber(100);
      const maxBaseAssetAllocation = new BigNumber(100);
      const signalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      const signalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      const liquidatorData = NON_ZERO_BYTES;
      subjectCaller = deployerAccount;

      setManager = await managerHelper.deployAssetPairManagerV2Async(
        core.address,
        allocator.address,
        trigger.address,
        false,
        allocationDenominator,
        maxBaseAssetAllocation,
        signalConfirmationMinTime,
        signalConfirmationMaxTime,
        liquidatorData,
        subjectCaller
      );

      await setManager.setTimeLockPeriod.sendTransactionAsync(ONE_DAY_IN_SECONDS, { from: deployerAccount });

      const lastBlock = await web3.eth.getBlock('latest');
      rebalancingSetToken = await protocolHelper.createDefaultRebalancingSetTokenV3Async(
        core,
        rebalancingFactory.address,
        setManager.address,
        liquidator.address,
        feeRecipient,
        feeCalculator.address,
        quoteAssetCollateral.address,
        ONE_DAY_IN_SECONDS,
        new BigNumber(lastBlock.timestamp),
      );

      await setManager.initialize.sendTransactionAsync(
        rebalancingSetToken.address,
        { from: subjectCaller, gas: DEFAULT_GAS}
      );

      const newFeeCallData = feeCalculatorHelper.generateAdjustFeeCallData(feeType, newFeePercentage);
      subjectCaller = deployerAccount;

      // Issue currentSetToken
      const initialAllocationToken = await protocolHelper.getSetTokenAsync(quoteAssetCollateral.address);
      await core.issue.sendTransactionAsync(
        initialAllocationToken.address,
        ether(9),
        {from: deployerAccount, gas: DEFAULT_GAS},
      );
      await erc20Helper.approveTransfersAsync([initialAllocationToken], transferProxy.address);

      // Use issued currentSetToken to issue rebalancingSetToken
      await core.issue.sendTransactionAsync(
        rebalancingSetToken.address,
        ether(7),
        { from: deployerAccount, gas: DEFAULT_GAS }
      );

      const adjustTxHash = await setManager.adjustFee.sendTransactionAsync(
        newFeeCallData,
        { from: subjectCaller }
      );

      const { input } = await web3.eth.getTransaction(adjustTxHash);

      subjectUpgradeHash = web3.utils.soliditySha3(input);
    });

    async function subject(): Promise<string> {
      return setManager.removeRegisteredUpgrade.sendTransactionAsync(
        subjectUpgradeHash,
        { from: subjectCaller }
      );
    }

    it('sets the upgradeHash to 0', async () => {
      await subject();

      const actualTimestamp = await setManager.timeLockedUpgrades.callAsync(subjectUpgradeHash);
      expect(actualTimestamp).to.bignumber.equal(ZERO);
    });

    describe('when the hash specified is not registered', async () => {
      beforeEach(async () => {
        subjectUpgradeHash = web3.utils.soliditySha3(5);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('when caller is not owner', async () => {
      beforeEach(async () => {
        subjectCaller = attackerAccount;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#setFeeRecipient', async () => {
    let subjectNewFeeRecipient: Address;
    let subjectCaller: Address;

    beforeEach(async () => {
      const allocationDenominator = new BigNumber(100);
      const maxBaseAssetAllocation = new BigNumber(100);
      const signalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      const signalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      const liquidatorData = NON_ZERO_BYTES;
      subjectCaller = deployerAccount;
      setManager = await managerHelper.deployAssetPairManagerV2Async(
        core.address,
        allocator.address,
        trigger.address,
        false,
        allocationDenominator,
        maxBaseAssetAllocation,
        signalConfirmationMinTime,
        signalConfirmationMaxTime,
        liquidatorData,
        subjectCaller
      );

      const lastBlock = await web3.eth.getBlock('latest');
      rebalancingSetToken = await protocolHelper.createDefaultRebalancingSetTokenV3Async(
        core,
        rebalancingFactory.address,
        setManager.address,
        liquidator.address,
        feeRecipient,
        feeCalculator.address,
        quoteAssetCollateral.address,
        ONE_DAY_IN_SECONDS,
        new BigNumber(lastBlock.timestamp),
      );

      await setManager.initialize.sendTransactionAsync(
        rebalancingSetToken.address,
        { from: subjectCaller, gas: DEFAULT_GAS}
      );

      subjectNewFeeRecipient = attackerAccount;
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      return setManager.setFeeRecipient.sendTransactionAsync(
        subjectNewFeeRecipient,
        { from: subjectCaller }
      );
    }

    it('sets the new fee recipient correctly', async () => {
      await subject();

      const actualFeeRecipient = await rebalancingSetToken.feeRecipient.callAsync();

      expect(actualFeeRecipient).to.equal(subjectNewFeeRecipient);
    });

    describe('but caller is not owner', async () => {
      beforeEach(async () => {
        subjectCaller = attackerAccount;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#canInitialPropose', async () => {
    let subjectCaller: Address;

    let useBullishAllocation: boolean;
    let timeJump: BigNumber;
    let flipTrigger: boolean;
    let shouldInitialize: boolean;

    before(async () => {
      useBullishAllocation = true;
      flipTrigger = false;
      timeJump = ONE_DAY_IN_SECONDS;
      shouldInitialize = true;
    });

    beforeEach(async () => {
      const allocationDenominator = new BigNumber(100);
      const maxBaseAssetAllocation = new BigNumber(100);
      const signalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      const signalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      const liquidatorData = NON_ZERO_BYTES;
      subjectCaller = deployerAccount;
      setManager = await managerHelper.deployAssetPairManagerV2Async(
        core.address,
        allocator.address,
        trigger.address,
        useBullishAllocation,
        allocationDenominator,
        maxBaseAssetAllocation,
        signalConfirmationMinTime,
        signalConfirmationMaxTime,
        liquidatorData,
        subjectCaller
      );

      let collateralSetAddress: Address;
      if (!useBullishAllocation) {
        collateralSetAddress = quoteAssetCollateral.address;
        await trigger.confirmTrigger.sendTransactionAsync();
      } else {
        collateralSetAddress = baseAssetCollateral.address;
      }

      const lastBlock = await web3.eth.getBlock('latest');
      rebalancingSetToken = await protocolHelper.createDefaultRebalancingSetTokenV3Async(
        core,
        rebalancingFactory.address,
        setManager.address,
        liquidator.address,
        feeRecipient,
        feeCalculator.address,
        collateralSetAddress,
        ONE_DAY_IN_SECONDS,
        new BigNumber(lastBlock.timestamp),
      );

      if (flipTrigger) {
        await trigger.confirmTrigger.sendTransactionAsync();
      }

      if (shouldInitialize) {
        await setManager.initialize.sendTransactionAsync(
          rebalancingSetToken.address,
          { from: subjectCaller, gas: DEFAULT_GAS }
        );
      }

      await blockchain.increaseTimeAsync(timeJump);
      await blankTxn(deployerAccount);

      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<boolean> {
      return setManager.canInitialPropose.callAsync(
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    describe('when propose is called from the Default state', async () => {
      describe('and allocating from base asset to quote asset', async () => {
        it('should return true', async () => {
          const canInitialPropose = await subject();

          expect(canInitialPropose).to.be.true;
        });

        describe('but allocation has not changed', async () => {
          before(async () => {
            flipTrigger = true;
          });

          after(async () => {
            flipTrigger = false;
          });

          it('return false', async () => {
            const canInitialPropose = await subject();

            expect(canInitialPropose).to.be.false;
          });
        });
      });

      describe('and allocating from quote asset to base asset', async () => {
        before(async () => {
          useBullishAllocation = false;
        });

        after(async () => {
          useBullishAllocation = true;
        });

        it('should return true', async () => {
          const canInitialPropose = await subject();

          expect(canInitialPropose).to.be.true;
        });

        describe('but allocation has not changed', async () => {
          before(async () => {
            flipTrigger = true;
          });

          after(async () => {
            flipTrigger = false;
          });

          it('return false', async () => {
            const canInitialPropose = await subject();

            expect(canInitialPropose).to.be.false;
          });
        });
      });

      describe('but not enough time has passed from last initial propose', async () => {
        beforeEach(async () => {
          await setManager.initialPropose.sendTransactionAsync();
        });

        it('returns false', async () => {
          const canInitialPropose = await subject();

          expect(canInitialPropose).to.be.false;
        });
      });

      describe('but rebalance interval has not elapsed', async () => {
        before(async () => {
          timeJump = ZERO;
        });

        after(async () => {
          timeJump = ONE_DAY_IN_SECONDS;
        });

        it('returns false', async () => {
          const canInitialPropose = await subject();

          expect(canInitialPropose).to.be.false;
        });
      });

      describe('but manager not initialized', async () => {
        before(async () => {
          shouldInitialize = false;
        });

        after(async () => {
          shouldInitialize = true;
        });

        it('should revert', async () => {
          await expectRevertError(subject());
        });
      });
    });

    describe('when propose is called and rebalancing set token is in Rebalance state', async () => {
      beforeEach(async () => {
        // Issue currentSetToken
        const initialAllocationTokenAddress = await rebalancingSetToken.currentSet.callAsync();
        const initialAllocationToken = await protocolHelper.getSetTokenAsync(initialAllocationTokenAddress);
        await core.issue.sendTransactionAsync(
          initialAllocationToken.address,
          ether(9),
          {from: deployerAccount, gas: DEFAULT_GAS},
        );
        await erc20Helper.approveTransfersAsync([initialAllocationToken], transferProxy.address);

        // Use issued currentSetToken to issue rebalancingSetToken
        await core.issue.sendTransactionAsync(
          rebalancingSetToken.address,
          ether(7),
          { from: deployerAccount, gas: DEFAULT_GAS }
        );

        await setManager.initialPropose.sendTransactionAsync();
        await blockchain.increaseTimeAsync(ONE_HOUR_IN_SECONDS.mul(6));
        await setManager.confirmPropose.sendTransactionAsync();
      });

      it('returns false', async () => {
        const canInitialPropose = await subject();

        expect(canInitialPropose).to.be.false;
      });
    });
  });

  describe('#canConfirmPropose', async () => {
    let subjectTimeFastForward: BigNumber;
    let subjectCaller: Address;

    let useBullishAllocation: boolean;
    let flipTrigger: boolean;
    let shouldInitialize: boolean;

    before(async () => {
      useBullishAllocation = false;
      flipTrigger = false;
      shouldInitialize = true;
    });

    beforeEach(async () => {
      const allocationDenominator = new BigNumber(100);
      const maxBaseAssetAllocation = new BigNumber(100);
      const signalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      const signalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      const liquidatorData = NON_ZERO_BYTES;
      subjectCaller = deployerAccount;
      setManager = await managerHelper.deployAssetPairManagerV2Async(
        core.address,
        allocator.address,
        trigger.address,
        useBullishAllocation,
        allocationDenominator,
        maxBaseAssetAllocation,
        signalConfirmationMinTime,
        signalConfirmationMaxTime,
        liquidatorData,
        subjectCaller
      );

      let collateralSetAddress: Address;
      if (!useBullishAllocation) {
        collateralSetAddress = quoteAssetCollateral.address;
        await trigger.confirmTrigger.sendTransactionAsync();
      } else {
        collateralSetAddress = baseAssetCollateral.address;
      }

      const lastBlock = await web3.eth.getBlock('latest');
      rebalancingSetToken = await protocolHelper.createDefaultRebalancingSetTokenV3Async(
        core,
        rebalancingFactory.address,
        setManager.address,
        liquidator.address,
        feeRecipient,
        feeCalculator.address,
        collateralSetAddress,
        ONE_DAY_IN_SECONDS,
        new BigNumber(lastBlock.timestamp),
      );

      if (shouldInitialize) {
        await setManager.initialize.sendTransactionAsync(
          rebalancingSetToken.address,
          { from: subjectCaller, gas: DEFAULT_GAS }
        );
      }

      await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS);

      await setManager.initialPropose.sendTransactionAsync();

      if (flipTrigger) {
        await trigger.confirmTrigger.sendTransactionAsync();
      }

      subjectTimeFastForward = ONE_HOUR_IN_SECONDS.mul(7);
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<boolean> {
      await blockchain.increaseTimeAsync(subjectTimeFastForward);
      await blankTxn(subjectCaller);
      return setManager.canConfirmPropose.callAsync(
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    describe('when propose is called from the Default state', async () => {
      describe('and allocating from base asset to quote asset', async () => {
        it('should return true', async () => {
          const canConfirmPropose = await subject();

          expect(canConfirmPropose).to.be.true;
        });

        describe('but allocation has not changed', async () => {
          before(async () => {
            flipTrigger = true;
          });

          after(async () => {
            flipTrigger = false;
          });

          it('return false', async () => {
            const canConfirmPropose = await subject();

            expect(canConfirmPropose).to.be.false;
          });
        });

        describe('but not in confirmation window', async () => {
          beforeEach(async () => {
            subjectTimeFastForward = ZERO;
          });

          it('returns false', async () => {
            const canConfirmPropose = await subject();

            expect(canConfirmPropose).to.be.false;
          });
        });
      });

      describe('and allocating from quote asset to base asset', async () => {
        before(async () => {
          useBullishAllocation = false;
        });

        it('returns true', async () => {
          const canConfirmPropose = await subject();

          expect(canConfirmPropose).to.be.true;
        });

        describe('but allocation has not changed', async () => {
          before(async () => {
            flipTrigger = true;
          });

          after(async () => {
            flipTrigger = false;
          });

          it('returns false', async () => {
            const canConfirmPropose = await subject();

            expect(canConfirmPropose).to.be.false;
          });
        });

        describe('but not in confirmation window', async () => {
          beforeEach(async () => {
            subjectTimeFastForward = ZERO;
          });

          it('returns false', async () => {
            const canConfirmPropose = await subject();

            expect(canConfirmPropose).to.be.false;
          });
        });
      });
    });

    describe('when propose is called and rebalancing set token is in Rebalance state', async () => {
      beforeEach(async () => {
        // Issue currentSetToken
        const initialAllocationTokenAddress = await rebalancingSetToken.currentSet.callAsync();
        const initialAllocationToken = await protocolHelper.getSetTokenAsync(initialAllocationTokenAddress);
        await core.issue.sendTransactionAsync(
          initialAllocationToken.address,
          ether(9),
          {from: deployerAccount, gas: DEFAULT_GAS},
        );
        await erc20Helper.approveTransfersAsync([initialAllocationToken], transferProxy.address);

        // Use issued currentSetToken to issue rebalancingSetToken
        await core.issue.sendTransactionAsync(
          rebalancingSetToken.address,
          ether(7),
          { from: deployerAccount, gas: DEFAULT_GAS }
        );

        await blockchain.increaseTimeAsync(subjectTimeFastForward);
        await setManager.confirmPropose.sendTransactionAsync();
      });

      it('returns false', async () => {
        const canConfirmPropose = await subject();

        expect(canConfirmPropose).to.be.false;
      });
    });
  });
});
