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
  TwoAssetStrategyManagerMockContract,
  BinaryAllocatorMockContract,
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

contract('BaseTwoAssetStrategyManager', accounts => {
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

  let setManager: TwoAssetStrategyManagerMockContract;
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
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectCoreInstance: Address;
    let subjectAllocatorInstance: Address;
    let subjectAuctionLibraryInstance: Address;
    let subjectBaseAssetAllocation: BigNumber;
    let subjectAllocationPrecision: BigNumber;
    let subjectAuctionStartPercentage: BigNumber;
    let subjectAuctionEndPercentage: BigNumber;
    let subjectAuctionTimeToPivot: BigNumber;
    let subjectCaller: Address;

    beforeEach(async () => {
      subjectCoreInstance = core.address;
      subjectAllocatorInstance = allocator.address;
      subjectAuctionLibraryInstance = linearAuctionPriceCurve.address;
      subjectBaseAssetAllocation = ZERO;
      subjectAllocationPrecision = new BigNumber(100);
      subjectAuctionStartPercentage = new BigNumber(2);
      subjectAuctionEndPercentage = new BigNumber(10);
      subjectAuctionTimeToPivot = ONE_HOUR_IN_SECONDS.mul(4);
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<TwoAssetStrategyManagerMockContract> {
      return managerHelper.deployTwoAssetStrategyManagerMockAsync(
        subjectCoreInstance,
        subjectAllocatorInstance,
        subjectAuctionLibraryInstance,
        subjectBaseAssetAllocation,
        subjectAllocationPrecision,
        subjectAuctionStartPercentage,
        subjectAuctionEndPercentage,
        subjectAuctionTimeToPivot,
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

    it('sets the correct initializerAddress', async () => {
      setManager = await subject();

      const actualInitializerAddress = await setManager.initializerAddress.callAsync();

      expect(actualInitializerAddress).to.equal(subjectCaller);
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
      setManager = await managerHelper.deployTwoAssetStrategyManagerMockAsync(
        core.address,
        allocator.address,
        linearAuctionPriceCurve.address,
        ZERO,
        allocationPrecision,
        auctionStartPercentage,
        auctionEndPercentage,
        auctionTimeToPivot,
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

  describe('#propose', async () => {
    let subjectTimeFastForward: BigNumber;
    let subjectCaller: Address;

    let initialBaseAssetAllocation: BigNumber;
    let finalBaseAssetAllocation: BigNumber;
    let auctionStartPercentage: BigNumber;
    let auctionEndPercentage: BigNumber;
    let auctionTimeToPivot: BigNumber;

    let collateralSetAddress: Address;
    let proposalPeriod: BigNumber;

    before(async () => {
      initialBaseAssetAllocation = new BigNumber(100);
      finalBaseAssetAllocation = ZERO;
    });

    beforeEach(async () => {
      const allocationPrecision = new BigNumber(100);
      auctionStartPercentage = new BigNumber(2);
      auctionEndPercentage = new BigNumber(10);
      auctionTimeToPivot = ONE_HOUR_IN_SECONDS.mul(4);
      setManager = await managerHelper.deployTwoAssetStrategyManagerMockAsync(
        core.address,
        allocator.address,
        linearAuctionPriceCurve.address,
        initialBaseAssetAllocation,
        allocationPrecision,
        auctionStartPercentage,
        auctionEndPercentage,
        auctionTimeToPivot,
      );

      collateralSetAddress = initialBaseAssetAllocation.equals(ZERO) ? quoteAssetCollateral.address
        : baseAssetCollateral.address;

      proposalPeriod = ONE_DAY_IN_SECONDS;
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

      await setManager.setAllocation.sendTransactionAsync(finalBaseAssetAllocation);

      subjectTimeFastForward = ONE_DAY_IN_SECONDS.add(1);
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<string> {
      await blockchain.increaseTimeAsync(subjectTimeFastForward);
      return setManager.propose.sendTransactionAsync(
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    describe('when propose is called from the Default state', async () => {
      describe('and allocating from base asset to quote asset', async () => {
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
            finalBaseAssetAllocation = new BigNumber(100);
          });

          after(async () => {
            finalBaseAssetAllocation = ZERO;
          });

          it('should revert', async () => {
            await expectRevertError(subject());
          });
        });

        describe('but not enough time has passed from last rebalance', async () => {
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
          finalBaseAssetAllocation = new BigNumber(100);
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
            finalBaseAssetAllocation = ZERO;
          });

          after(async () => {
            finalBaseAssetAllocation = new BigNumber(100);
          });

          it('should revert', async () => {
            await expectRevertError(subject());
          });
        });

        describe('but not enough time has passed from last rebalance', async () => {
          beforeEach(async () => {
            subjectTimeFastForward = ZERO;
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
        await setManager.propose.sendTransactionAsync();
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

        await blockchain.increaseTimeAsync(subjectTimeFastForward);
        await setManager.propose.sendTransactionAsync();

        await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS);
        await rebalancingSetToken.startRebalance.sendTransactionAsync();
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#isReadyToRebalance', async () => {
    let subjectTimeFastForward: BigNumber;
    let subjectCaller: Address;

    let initialBaseAssetAllocation: BigNumber;
    let finalBaseAssetAllocation: BigNumber;
    let auctionStartPercentage: BigNumber;
    let auctionEndPercentage: BigNumber;
    let auctionTimeToPivot: BigNumber;

    let collateralSetAddress: Address;
    let proposalPeriod: BigNumber;

    before(async () => {
      initialBaseAssetAllocation = new BigNumber(100);
      finalBaseAssetAllocation = ZERO;
    });

    beforeEach(async () => {
      const allocationPrecision = new BigNumber(100);
      auctionStartPercentage = new BigNumber(2);
      auctionEndPercentage = new BigNumber(10);
      auctionTimeToPivot = ONE_HOUR_IN_SECONDS.mul(4);
      setManager = await managerHelper.deployTwoAssetStrategyManagerMockAsync(
        core.address,
        allocator.address,
        linearAuctionPriceCurve.address,
        initialBaseAssetAllocation,
        allocationPrecision,
        auctionStartPercentage,
        auctionEndPercentage,
        auctionTimeToPivot,
      );

      collateralSetAddress = initialBaseAssetAllocation.equals(ZERO) ? quoteAssetCollateral.address
        : baseAssetCollateral.address;

      proposalPeriod = ONE_DAY_IN_SECONDS;
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

      await setManager.setAllocation.sendTransactionAsync(finalBaseAssetAllocation);

      subjectTimeFastForward = ONE_DAY_IN_SECONDS.add(1);
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<boolean> {
      await blockchain.increaseTimeAsync(subjectTimeFastForward);
      return setManager.isReadyToRebalance.callAsync(
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    describe('when propose is called from the Default state', async () => {
      describe('and allocating from base asset to quote asset', async () => {
        it('should return true', async () => {
          const canInitialTrigger = await subject();

          expect(canInitialTrigger).to.be.true;
        });

        describe('but allocation has not changed', async () => {
          before(async () => {
            finalBaseAssetAllocation = new BigNumber(100);
          });

          after(async () => {
            finalBaseAssetAllocation = ZERO;
          });

          it('return false', async () => {
            const canInitialTrigger = await subject();

            expect(canInitialTrigger).to.be.false;
          });
        });

        describe('but not enough time has passed from last rebalance', async () => {
          beforeEach(async () => {
            subjectTimeFastForward = ZERO;
          });

          it('returns false', async () => {
            const canInitialTrigger = await subject();

            expect(canInitialTrigger).to.be.false;
          });
        });
      });

      describe('and allocating from quote asset to base asset', async () => {
        before(async () => {
          initialBaseAssetAllocation = ZERO;
          finalBaseAssetAllocation = new BigNumber(100);
        });

        it('returns true', async () => {
          const canInitialTrigger = await subject();

          expect(canInitialTrigger).to.be.true;
        });

        describe('but allocation has not changed', async () => {
          before(async () => {
            finalBaseAssetAllocation = ZERO;
          });

          after(async () => {
            finalBaseAssetAllocation = new BigNumber(100);
          });

          it('returns false', async () => {
            const canInitialTrigger = await subject();

            expect(canInitialTrigger).to.be.false;
          });
        });

        describe('returns false', async () => {
          beforeEach(async () => {
            subjectTimeFastForward = ZERO;
          });

          it('should revert', async () => {
            const canInitialTrigger = await subject();

            expect(canInitialTrigger).to.be.false;
          });
        });
      });
    });

    describe('when propose is called and rebalancing set token is in Proposal state', async () => {
      beforeEach(async () => {
        await blockchain.increaseTimeAsync(subjectTimeFastForward);
        await setManager.propose.sendTransactionAsync();
      });

      it('returns false', async () => {
        const canInitialTrigger = await subject();

        expect(canInitialTrigger).to.be.false;
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
        await setManager.propose.sendTransactionAsync();

        await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS);
        await rebalancingSetToken.startRebalance.sendTransactionAsync();
      });

      it('returns false', async () => {
        const canInitialTrigger = await subject();

        expect(canInitialTrigger).to.be.false;
      });
    });
  });
});