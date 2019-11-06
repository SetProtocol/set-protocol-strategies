require('module-alias/register');

import * as _ from 'lodash';
import * as ABIDecoder from 'abi-decoder';
import * as chai from 'chai';

import { Address } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import { Blockchain } from '@utils/blockchain';
import { ether } from '@utils/units';
import {
  Core,
  CoreContract,
  LinearAuctionPriceCurveContract,
  RebalancingSetTokenContract,
  RebalancingSetTokenFactoryContract,
  SetTokenContract,
  SetTokenFactoryContract,
  TransferProxyContract,
  WethMockContract,
  WhiteListContract,
} from 'set-protocol-contracts';
import {
  TwoAssetStrategyManagerContract,
  BinaryAllocatorMockContract,
  TriggerMockContract,
  USDCMockContract,
} from '@utils/contracts';

import {
  DEFAULT_GAS,
  NULL_ADDRESS,
  ONE,
  ONE_DAY_IN_SECONDS,
  ONE_HOUR_IN_SECONDS,
  RISK_COLLATERAL_NATURAL_UNIT,
  STABLE_COLLATERAL_NATURAL_UNIT,
  ZERO
} from '@utils/constants';

import { expectRevertError } from '@utils/tokenAssertions';
import { getWeb3 } from '@utils/web3Helper';

import { ERC20Helper } from '@utils/helpers/erc20Helper';
import { ManagerHelper } from '@utils/helpers/managerHelper';
import { ProtocolHelper } from '@utils/helpers/protocolHelper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);

contract('TwoAssetStrategyManager', accounts => {
  const [
    deployerAccount,
    notDeployerAccount,
  ] = accounts;

  let rebalancingSetToken: RebalancingSetTokenContract;

  let core: CoreContract;
  let transferProxy: TransferProxyContract;
  let factory: SetTokenFactoryContract;
  let rebalancingFactory: RebalancingSetTokenFactoryContract;
  let linearAuctionPriceCurve: LinearAuctionPriceCurveContract;
  let whiteList: WhiteListContract;
  let usdcMock: USDCMockContract;
  let wrappedETH: WethMockContract;

  let allocator: BinaryAllocatorMockContract;
  let trigger: TriggerMockContract;

  let setManager: TwoAssetStrategyManagerContract;
  let quoteAssetCollateral: SetTokenContract;
  let baseAssetCollateral: SetTokenContract;

  const baseAssetCollateralValue = ether(150);
  const quoteAssetCollateralValue = ether(100);

  const protocolHelper = new ProtocolHelper(deployerAccount);
  const erc20Helper = new ERC20Helper(deployerAccount);
  const managerHelper = new ManagerHelper(deployerAccount);

  before(async () => {
    ABIDecoder.addABI(Core.abi);
  });

  after(async () => {
    ABIDecoder.removeABI(Core.abi);
  });

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    transferProxy = await protocolHelper.getDeployedTransferProxyAsync();
    core = await protocolHelper.getDeployedCoreAsync();

    factory = await protocolHelper.getDeployedSetTokenFactoryAsync();
    rebalancingFactory = await protocolHelper.getDeployedRebalancingSetTokenFactoryAsync();
    linearAuctionPriceCurve = await protocolHelper.getDeployedLinearAuctionPriceCurveAsync();
    whiteList = await protocolHelper.getDeployedWhiteList();

    usdcMock = await erc20Helper.deployUSDCTokenAsync(deployerAccount);
    await protocolHelper.addTokenToWhiteList(usdcMock.address, whiteList);
    await blockchain.increaseTimeAsync(ONE);
    await protocolHelper.addTokenToWhiteList(usdcMock.address, whiteList);

    wrappedETH = await protocolHelper.getDeployedWETHAsync();
    await erc20Helper.approveTransfersAsync(
      [usdcMock, wrappedETH],
      transferProxy.address
    );

    quoteAssetCollateral = await protocolHelper.createSetTokenAsync(
      core,
      factory.address,
      [usdcMock.address],
      [new BigNumber(128)],
      STABLE_COLLATERAL_NATURAL_UNIT,
    );

    baseAssetCollateral = await protocolHelper.createSetTokenAsync(
      core,
      factory.address,
      [wrappedETH.address],
      [new BigNumber(1048576)],
      RISK_COLLATERAL_NATURAL_UNIT,
    );

    allocator = await managerHelper.deployBinaryAllocatorMockAsync(
      baseAssetCollateral.address,
      quoteAssetCollateral.address,
      baseAssetCollateralValue,
      quoteAssetCollateralValue,
    );

    [trigger] = await managerHelper.deployTriggerMocksAsync(1, [false]);
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectCoreInstance: Address;
    let subjectAllocatorInstance: Address;
    let subjectTriggerInstance: Address;
    let subjectAuctionLibraryInstance: Address;
    let subjectBaseAssetAllocation: BigNumber;
    let subjectAllocationPrecision: BigNumber;
    let subjectBullishBaseAssetAllocation: BigNumber;
    let subjectAuctionStartPercentage: BigNumber;
    let subjectAuctionEndPercentage: BigNumber;
    let subjectAuctionTimeToPivot: BigNumber;
    let subjectSignalConfirmationMinTime: BigNumber;
    let subjectSignalConfirmationMaxTime: BigNumber;
    let subjectCaller: Address;

    beforeEach(async () => {
      subjectCoreInstance = core.address;
      subjectAllocatorInstance = allocator.address;
      subjectTriggerInstance = trigger.address;
      subjectAuctionLibraryInstance = linearAuctionPriceCurve.address;
      subjectBaseAssetAllocation = ZERO;
      subjectAllocationPrecision = new BigNumber(100);
      subjectBullishBaseAssetAllocation = new BigNumber(100);
      subjectAuctionStartPercentage = new BigNumber(2);
      subjectAuctionEndPercentage = new BigNumber(10);
      subjectAuctionTimeToPivot = ONE_HOUR_IN_SECONDS.mul(4);
      subjectSignalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      subjectSignalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<TwoAssetStrategyManagerContract> {
      return managerHelper.deployTwoAssetStrategyManagerAsync(
        subjectCoreInstance,
        subjectAllocatorInstance,
        subjectTriggerInstance,
        subjectAuctionLibraryInstance,
        subjectBaseAssetAllocation,
        subjectAllocationPrecision,
        subjectBullishBaseAssetAllocation,
        subjectAuctionStartPercentage,
        subjectAuctionEndPercentage,
        subjectAuctionTimeToPivot,
        subjectSignalConfirmationMinTime,
        subjectSignalConfirmationMaxTime,
        subjectCaller,
      );
    }

    it('sets the correct core address', async () => {
      setManager = await subject();

      const actualCoreInstance = await setManager.coreInstance.callAsync();

      expect(actualCoreInstance).to.equal(subjectCoreInstance);
    });

    it('sets the correct allocator address', async () => {
      setManager = await subject();

      const actualAllocatorInstance = await setManager.allocatorInstance.callAsync();

      expect(actualAllocatorInstance).to.equal(subjectAllocatorInstance);
    });

    it('sets the correct trigger address', async () => {
      setManager = await subject();

      const actualTriggerInstance = await setManager.triggerInstance.callAsync();

      expect(actualTriggerInstance).to.equal(subjectTriggerInstance);
    });

    it('sets the correct auctionLibrary address', async () => {
      setManager = await subject();

      const actualAuctionLibraryInstance = await setManager.auctionLibraryInstance.callAsync();

      expect(actualAuctionLibraryInstance).to.equal(subjectAuctionLibraryInstance);
    });

    it('sets the correct baseAssetAllocation', async () => {
      setManager = await subject();

      const actualBaseAssetAllocation = await setManager.baseAssetAllocation.callAsync();

      expect(actualBaseAssetAllocation).to.be.bignumber.equal(subjectBaseAssetAllocation);
    });

    it('sets the correct allocationPrecision', async () => {
      setManager = await subject();

      const actualAllocationPrecision = await setManager.allocationPrecision.callAsync();

      expect(actualAllocationPrecision).to.be.bignumber.equal(subjectAllocationPrecision);
    });

    it('sets the correct bullishBaseAssetAllocation', async () => {
      setManager = await subject();

      const actualBullishBaseAssetAllocation = await setManager.bullishBaseAssetAllocation.callAsync();

      expect(actualBullishBaseAssetAllocation).to.be.bignumber.equal(subjectBullishBaseAssetAllocation);
    });

    it('sets the correct auctionStartPercentage', async () => {
      setManager = await subject();

      const actualAuctionStartPercentage = await setManager.auctionStartPercentage.callAsync();

      expect(actualAuctionStartPercentage).to.be.bignumber.equal(subjectAuctionStartPercentage);
    });

    it('sets the correct auctionEndPercentage', async () => {
      setManager = await subject();

      const actualAuctionEndPercentage = await setManager.auctionEndPercentage.callAsync();

      expect(actualAuctionEndPercentage).to.be.bignumber.equal(subjectAuctionEndPercentage);
    });

    it('sets the correct auctionTimeToPivot', async () => {
      setManager = await subject();

      const actualAuctionTimeToPivot = await setManager.auctionTimeToPivot.callAsync();

      expect(actualAuctionTimeToPivot).to.be.bignumber.equal(subjectAuctionTimeToPivot);
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

    it('sets the correct initializerAddress', async () => {
      setManager = await subject();

      const actualInitializerAddress = await setManager.initializerAddress.callAsync();

      expect(actualInitializerAddress).to.equal(subjectCaller);
    });

    describe('but signalConfirmationMinTime is greater than signalConfirmationMaxTime', async () => {
      beforeEach(async () => {
        subjectSignalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(5);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#initialize', async () => {
    let subjectRebalancingSetToken: Address;
    let subjectCaller: Address;

    let proposalPeriod: BigNumber;

    beforeEach(async () => {
      const auctionStartPercentage = new BigNumber(2);
      const auctionEndPercentage = new BigNumber(10);
      const auctionTimeToPivot = ONE_HOUR_IN_SECONDS.mul(4);
      const allocationPrecision = new BigNumber(100);
      const maxBaseAssetAllocation = new BigNumber(100);
      const signalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      const signalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      setManager = await managerHelper.deployTwoAssetStrategyManagerAsync(
        core.address,
        allocator.address,
        trigger.address,
        linearAuctionPriceCurve.address,
        ZERO,
        allocationPrecision,
        maxBaseAssetAllocation,
        auctionStartPercentage,
        auctionEndPercentage,
        auctionTimeToPivot,
        signalConfirmationMinTime,
        signalConfirmationMaxTime,
        subjectCaller,
      );

      proposalPeriod = ONE_DAY_IN_SECONDS;
      rebalancingSetToken = await protocolHelper.createDefaultRebalancingSetTokenAsync(
        core,
        rebalancingFactory.address,
        setManager.address,
        quoteAssetCollateral.address,
        proposalPeriod
      );

      subjectRebalancingSetToken = rebalancingSetToken.address;
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      return setManager.initialize.sendTransactionAsync(
        subjectRebalancingSetToken,
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    it('sets the rebalancing set token address', async () => {
      await subject();

      const actualRebalancingSetTokenInstance = await setManager.rebalancingSetTokenInstance.callAsync();

      expect(actualRebalancingSetTokenInstance).to.equal(subjectRebalancingSetToken);
    });

    it('sets the intializer address to zero', async () => {
      await subject();

      const actualInitializerAddress = await setManager.initializerAddress.callAsync();

      expect(actualInitializerAddress).to.equal(NULL_ADDRESS);
    });

    describe('but caller is not the contract deployer', async () => {
      beforeEach(async () => {
        subjectCaller = notDeployerAccount;
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('but the passed rebalancing set address was not created by Core', async () => {
      beforeEach(async () => {
        const unTrackedSetToken = await protocolHelper.createDefaultRebalancingSetTokenAsync(
          core,
          rebalancingFactory.address,
          setManager.address,
          baseAssetCollateral.address,
          proposalPeriod,
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
  });

  describe('#initialPropose', async () => {
    let subjectCaller: Address;

    let initialBaseAssetAllocation: BigNumber;
    let timeJump: BigNumber;
    let flipTrigger: boolean;

    before(async () => {
      initialBaseAssetAllocation = new BigNumber(100);
      flipTrigger = false;
      timeJump = ONE_DAY_IN_SECONDS;
    });

    beforeEach(async () => {
      const auctionStartPercentage = new BigNumber(2);
      const auctionEndPercentage = new BigNumber(10);
      const auctionTimeToPivot = ONE_HOUR_IN_SECONDS.mul(4);
      const allocationPrecision = new BigNumber(100);
      const maxBaseAssetAllocation = new BigNumber(100);
      const signalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      const signalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      setManager = await managerHelper.deployTwoAssetStrategyManagerAsync(
        core.address,
        allocator.address,
        trigger.address,
        linearAuctionPriceCurve.address,
        initialBaseAssetAllocation,
        allocationPrecision,
        maxBaseAssetAllocation,
        auctionStartPercentage,
        auctionEndPercentage,
        auctionTimeToPivot,
        signalConfirmationMinTime,
        signalConfirmationMaxTime,
        subjectCaller,
      );

      let collateralSetAddress: Address;
      if (initialBaseAssetAllocation.equals(ZERO)) {
        collateralSetAddress = quoteAssetCollateral.address;
        await trigger.confirmTrigger.sendTransactionAsync();
      } else {
        collateralSetAddress = baseAssetCollateral.address;
      }

      const proposalPeriod = ONE_DAY_IN_SECONDS;
      rebalancingSetToken = await protocolHelper.createDefaultRebalancingSetTokenAsync(
        core,
        rebalancingFactory.address,
        setManager.address,
        collateralSetAddress,
        proposalPeriod
      );

      if (flipTrigger) {
        await trigger.confirmTrigger.sendTransactionAsync();
      }

      await setManager.initialize.sendTransactionAsync(
        rebalancingSetToken.address,
        { from: subjectCaller, gas: DEFAULT_GAS }
      );

      await blockchain.increaseTimeAsync(timeJump);

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

          const actualTimestamp = await setManager.lastInitialTriggerTimestamp.callAsync();
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

      describe('and allocating from quote asset to base asset', async () => {
        before(async () => {
          initialBaseAssetAllocation = ZERO;
        });

        after(async () => {
          initialBaseAssetAllocation = new BigNumber(100);
        });

        it('sets the proposalTimestamp correctly', async () => {
          await subject();

          const block = await web3.eth.getBlock('latest');
          const expectedTimestamp = new BigNumber(block.timestamp);

          const actualTimestamp = await setManager.lastInitialTriggerTimestamp.callAsync();
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

    describe('when propose is called and rebalancing set token is in Proposal state', async () => {
      beforeEach(async () => {
        await setManager.initialPropose.sendTransactionAsync();
        await blockchain.increaseTimeAsync(ONE_HOUR_IN_SECONDS.mul(6));
        await setManager.confirmPropose.sendTransactionAsync();
      });

      it('should revert', async () => {
        await expectRevertError(subject());
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

        await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS);
        await rebalancingSetToken.startRebalance.sendTransactionAsync();
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#confirmPropose', async () => {
    let subjectTimeFastForward: BigNumber;
    let subjectCaller: Address;

    let initialBaseAssetAllocation: BigNumber;
    let flipTrigger: boolean;

    let auctionStartPercentage: BigNumber;
    let auctionEndPercentage: BigNumber;
    let auctionTimeToPivot: BigNumber;

    before(async () => {
      initialBaseAssetAllocation = new BigNumber(100);
      flipTrigger = false;
    });

    beforeEach(async () => {
      auctionStartPercentage = new BigNumber(2);
      auctionEndPercentage = new BigNumber(10);
      auctionTimeToPivot = ONE_HOUR_IN_SECONDS.mul(4);
      const allocationPrecision = new BigNumber(100);
      const maxBaseAssetAllocation = new BigNumber(100);
      const signalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      const signalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      setManager = await managerHelper.deployTwoAssetStrategyManagerAsync(
        core.address,
        allocator.address,
        trigger.address,
        linearAuctionPriceCurve.address,
        initialBaseAssetAllocation,
        allocationPrecision,
        maxBaseAssetAllocation,
        auctionStartPercentage,
        auctionEndPercentage,
        auctionTimeToPivot,
        signalConfirmationMinTime,
        signalConfirmationMaxTime,
        subjectCaller,
      );

      let collateralSetAddress: Address;
      if (initialBaseAssetAllocation.equals(ZERO)) {
        collateralSetAddress = quoteAssetCollateral.address;
        await trigger.confirmTrigger.sendTransactionAsync();
      } else {
        collateralSetAddress = baseAssetCollateral.address;
      }

      const proposalPeriod = ONE_DAY_IN_SECONDS;
      rebalancingSetToken = await protocolHelper.createDefaultRebalancingSetTokenAsync(
        core,
        rebalancingFactory.address,
        setManager.address,
        collateralSetAddress,
        proposalPeriod
      );

      await setManager.initialize.sendTransactionAsync(
        rebalancingSetToken.address,
        { from: subjectCaller, gas: DEFAULT_GAS}
      );

      await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS);

      await setManager.initialPropose.sendTransactionAsync();

      if (flipTrigger) {
        await trigger.confirmTrigger.sendTransactionAsync();
      }

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

        it('updates to the new auction library correctly', async () => {
          await subject();

          const newAuctionLibrary = await rebalancingSetToken.auctionLibrary.callAsync();
          expect(newAuctionLibrary).to.equal(linearAuctionPriceCurve.address);
        });

        it('updates the time to pivot correctly', async () => {
          await subject();

          const auctionPriceParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
          const actualAuctionTimeToPivot = auctionPriceParameters[1];

          expect(actualAuctionTimeToPivot).to.be.bignumber.equal(auctionTimeToPivot);
        });

        it('updates the auction start price correctly', async () => {
          await subject();

          const auctionPriceParameters = await managerHelper.calculateLinearAuctionParameters(
            baseAssetCollateralValue,
            quoteAssetCollateralValue,
            auctionStartPercentage,
            auctionEndPercentage
          );

          const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
          const newAuctionStartPrice = newAuctionParameters[2];

          expect(newAuctionStartPrice).to.be.bignumber.equal(auctionPriceParameters['auctionStartPrice']);
        });

        it('updates the auction pivot price correctly', async () => {
          await subject();

          const auctionPriceParameters = await managerHelper.calculateLinearAuctionParameters(
            baseAssetCollateralValue,
            quoteAssetCollateralValue,
            auctionStartPercentage,
            auctionEndPercentage
          );

          const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
          const newAuctionPivotPrice = newAuctionParameters[3];

          expect(newAuctionPivotPrice).to.be.bignumber.equal(auctionPriceParameters['auctionPivotPrice']);
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
      });

      describe('and allocating from quote asset to base asset', async () => {
        before(async () => {
          initialBaseAssetAllocation = ZERO;
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

        it('updates to the new auction library correctly', async () => {
          await subject();

          const newAuctionLibrary = await rebalancingSetToken.auctionLibrary.callAsync();
          expect(newAuctionLibrary).to.equal(linearAuctionPriceCurve.address);
        });

        it('updates the time to pivot correctly', async () => {
          await subject();

          const auctionPriceParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
          const actualAuctionTimeToPivot = auctionPriceParameters[1];

          expect(actualAuctionTimeToPivot).to.be.bignumber.equal(auctionTimeToPivot);
        });

        it('updates the auction start price correctly', async () => {
          await subject();

          const auctionPriceParameters = await managerHelper.calculateLinearAuctionParameters(
            quoteAssetCollateralValue,
            baseAssetCollateralValue,
            auctionStartPercentage,
            auctionEndPercentage
          );

          const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
          const newAuctionStartPrice = newAuctionParameters[2];

          expect(newAuctionStartPrice).to.be.bignumber.equal(auctionPriceParameters['auctionStartPrice']);
        });

        it('updates the auction pivot price correctly', async () => {
          await subject();

          const auctionPriceParameters = await managerHelper.calculateLinearAuctionParameters(
            quoteAssetCollateralValue,
            baseAssetCollateralValue,
            auctionStartPercentage,
            auctionEndPercentage
          );

          const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
          const newAuctionPivotPrice = newAuctionParameters[3];

          expect(newAuctionPivotPrice).to.be.bignumber.equal(auctionPriceParameters['auctionPivotPrice']);
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

    describe('when propose is called and rebalancing set token is in Proposal state', async () => {
      beforeEach(async () => {
        await blockchain.increaseTimeAsync(subjectTimeFastForward);
        await setManager.confirmPropose.sendTransactionAsync();
      });

      it('should revert', async () => {
        await expectRevertError(subject());
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

        await blockchain.increaseTimeAsync(ONE_HOUR_IN_SECONDS.mul(6));
        await setManager.confirmPropose.sendTransactionAsync();

        await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS);
        await rebalancingSetToken.startRebalance.sendTransactionAsync();
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#canInitialPropose', async () => {
    let subjectCaller: Address;

    let initialBaseAssetAllocation: BigNumber;
    let timeJump: BigNumber;
    let flipTrigger: boolean;

    before(async () => {
      initialBaseAssetAllocation = new BigNumber(100);
      flipTrigger = false;
      timeJump = ONE_DAY_IN_SECONDS;
    });

    beforeEach(async () => {
      const auctionStartPercentage = new BigNumber(2);
      const auctionEndPercentage = new BigNumber(10);
      const auctionTimeToPivot = ONE_HOUR_IN_SECONDS.mul(4);
      const allocationPrecision = new BigNumber(100);
      const maxBaseAssetAllocation = new BigNumber(100);
      const signalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      const signalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      setManager = await managerHelper.deployTwoAssetStrategyManagerAsync(
        core.address,
        allocator.address,
        trigger.address,
        linearAuctionPriceCurve.address,
        initialBaseAssetAllocation,
        allocationPrecision,
        maxBaseAssetAllocation,
        auctionStartPercentage,
        auctionEndPercentage,
        auctionTimeToPivot,
        signalConfirmationMinTime,
        signalConfirmationMaxTime,
        subjectCaller,
      );

      let collateralSetAddress: Address;
      if (initialBaseAssetAllocation.equals(ZERO)) {
        collateralSetAddress = quoteAssetCollateral.address;
        await trigger.confirmTrigger.sendTransactionAsync();
      } else {
        collateralSetAddress = baseAssetCollateral.address;
      }

      const proposalPeriod = ONE_DAY_IN_SECONDS;
      rebalancingSetToken = await protocolHelper.createDefaultRebalancingSetTokenAsync(
        core,
        rebalancingFactory.address,
        setManager.address,
        collateralSetAddress,
        proposalPeriod
      );

      if (flipTrigger) {
        await trigger.confirmTrigger.sendTransactionAsync();
      }

      await setManager.initialize.sendTransactionAsync(
        rebalancingSetToken.address,
        { from: subjectCaller, gas: DEFAULT_GAS }
      );

      await blockchain.increaseTimeAsync(timeJump);

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
      });

      describe('and allocating from quote asset to base asset', async () => {
        before(async () => {
          initialBaseAssetAllocation = ZERO;
        });

        after(async () => {
          initialBaseAssetAllocation = new BigNumber(100);
        });

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
      });

      describe('but not enough time has passed from last initial propose', async () => {
        beforeEach(async () => {
          await setManager.initialPropose.sendTransactionAsync();
        });

        it('returns false', async () => {
          const canConfirmPropose = await subject();

          expect(canConfirmPropose).to.be.false;
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
          const canConfirmPropose = await subject();

          expect(canConfirmPropose).to.be.false;
        });
      });
    });

    describe('when propose is called and rebalancing set token is in Proposal state', async () => {
      beforeEach(async () => {
        await setManager.initialPropose.sendTransactionAsync();
        await blockchain.increaseTimeAsync(ONE_HOUR_IN_SECONDS.mul(6));
        await setManager.confirmPropose.sendTransactionAsync();
      });

      it('returns false', async () => {
        const canConfirmPropose = await subject();

        expect(canConfirmPropose).to.be.false;
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

        await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS);
        await rebalancingSetToken.startRebalance.sendTransactionAsync();
      });

      it('returns false', async () => {
        const canConfirmPropose = await subject();

        expect(canConfirmPropose).to.be.false;
      });
    });
  });

  describe('#canConfirmPropose', async () => {
    let subjectTimeFastForward: BigNumber;
    let subjectCaller: Address;

    let initialBaseAssetAllocation: BigNumber;
    let flipTrigger: boolean;

    before(async () => {
      initialBaseAssetAllocation = new BigNumber(100);
      flipTrigger = false;
    });

    beforeEach(async () => {
      const auctionStartPercentage = new BigNumber(2);
      const auctionEndPercentage = new BigNumber(10);
      const auctionTimeToPivot = ONE_HOUR_IN_SECONDS.mul(4);
      const allocationPrecision = new BigNumber(100);
      const maxBaseAssetAllocation = new BigNumber(100);
      const signalConfirmationMinTime = ONE_HOUR_IN_SECONDS.mul(6);
      const signalConfirmationMaxTime = ONE_HOUR_IN_SECONDS.mul(12);
      setManager = await managerHelper.deployTwoAssetStrategyManagerAsync(
        core.address,
        allocator.address,
        trigger.address,
        linearAuctionPriceCurve.address,
        initialBaseAssetAllocation,
        allocationPrecision,
        maxBaseAssetAllocation,
        auctionStartPercentage,
        auctionEndPercentage,
        auctionTimeToPivot,
        signalConfirmationMinTime,
        signalConfirmationMaxTime,
        subjectCaller,
      );

      let collateralSetAddress: Address;
      if (initialBaseAssetAllocation.equals(ZERO)) {
        collateralSetAddress = quoteAssetCollateral.address;
        await trigger.confirmTrigger.sendTransactionAsync();
      } else {
        collateralSetAddress = baseAssetCollateral.address;
      }

      const proposalPeriod = ONE_DAY_IN_SECONDS;
      rebalancingSetToken = await protocolHelper.createDefaultRebalancingSetTokenAsync(
        core,
        rebalancingFactory.address,
        setManager.address,
        collateralSetAddress,
        proposalPeriod
      );

      await setManager.initialize.sendTransactionAsync(
        rebalancingSetToken.address,
        { from: subjectCaller, gas: DEFAULT_GAS}
      );

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

        describe('but not enough time has passed from initialTrigger', async () => {
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
          initialBaseAssetAllocation = ZERO;
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

        describe('returns false', async () => {
          beforeEach(async () => {
            subjectTimeFastForward = ZERO;
          });

          it('should revert', async () => {
            const canConfirmPropose = await subject();

            expect(canConfirmPropose).to.be.false;
          });
        });
      });
    });

    describe('when propose is called and rebalancing set token is in Proposal state', async () => {
      beforeEach(async () => {
        await blockchain.increaseTimeAsync(subjectTimeFastForward);
        await setManager.confirmPropose.sendTransactionAsync();
      });

      it('returns false', async () => {
        const canConfirmPropose = await subject();

        expect(canConfirmPropose).to.be.false;
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

        await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS);
        await rebalancingSetToken.startRebalance.sendTransactionAsync();
      });

      it('returns false', async () => {
        const canConfirmPropose = await subject();

        expect(canConfirmPropose).to.be.false;
      });
    });
  });
});