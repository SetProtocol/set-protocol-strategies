require('module-alias/register');

import * as _ from 'lodash';
import * as ABIDecoder from 'abi-decoder';
import * as chai from 'chai';

import { Address } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import { Blockchain } from '@utils/blockchain';
import {
  Core,
  CoreContract,
  LinearAuctionPriceCurveContract,
} from 'set-protocol-contracts';
import {
  TriggerMockContract,
  TwoAssetWeightedStrategyManagerContract,
} from '@utils/contracts';

import {
  ONE_HOUR_IN_SECONDS,
  ZERO
} from '@utils/constants';

import { expectRevertError } from '@utils/tokenAssertions';
import { getWeb3 } from '@utils/web3Helper';

import { ManagerHelper } from '@utils/helpers/managerHelper';
import { ProtocolHelper } from '@utils/helpers/protocolHelper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const { expect } = chai;
const blockchain = new Blockchain(web3);

contract('TwoAssetWeightedStrategyManager', accounts => {
  const [
    deployerAccount,
    allocator,
  ] = accounts;

  let core: CoreContract;
  let linearAuctionPriceCurve: LinearAuctionPriceCurveContract;

  let triggerOne: TriggerMockContract;
  let triggerTwo: TriggerMockContract;
  let triggerThree: TriggerMockContract;

  let setManager: TwoAssetWeightedStrategyManagerContract;

  const protocolHelper = new ProtocolHelper(deployerAccount);
  const managerHelper = new ManagerHelper(deployerAccount);

  before(async () => {
    ABIDecoder.addABI(Core.abi);
  });

  after(async () => {
    ABIDecoder.removeABI(Core.abi);
  });

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    core = await protocolHelper.getDeployedCoreAsync();
    linearAuctionPriceCurve = await protocolHelper.getDeployedLinearAuctionPriceCurveAsync();

    [
      triggerOne,
      triggerTwo,
      triggerThree,
    ] = await managerHelper.deployTriggerMocksAsync(
      3,
      [true, false, true]
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
    let subjectPriceTriggers: Address[];
    let subjectTriggerWeights: BigNumber[];
    let subjectCaller: Address;

    beforeEach(async () => {
      subjectCoreInstance = core.address;
      subjectAllocatorInstance = allocator;
      subjectAuctionLibraryInstance = linearAuctionPriceCurve.address;
      subjectBaseAssetAllocation = ZERO;
      subjectAllocationPrecision = new BigNumber(100);
      subjectAuctionStartPercentage = new BigNumber(2);
      subjectAuctionEndPercentage = new BigNumber(10);
      subjectAuctionTimeToPivot = ONE_HOUR_IN_SECONDS.mul(4);
      subjectPriceTriggers = [triggerOne.address, triggerTwo.address, triggerThree.address];
      subjectTriggerWeights = [new BigNumber(34), new BigNumber(33), new BigNumber(33)];
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<TwoAssetWeightedStrategyManagerContract> {
      return managerHelper.deployTwoAssetWeightedStrategyManagerAsync(
        subjectCoreInstance,
        subjectAllocatorInstance,
        subjectAuctionLibraryInstance,
        subjectBaseAssetAllocation,
        subjectAllocationPrecision,
        subjectAuctionStartPercentage,
        subjectAuctionEndPercentage,
        subjectAuctionTimeToPivot,
        subjectPriceTriggers,
        subjectTriggerWeights,
        subjectCaller,
      );
    }

    it('sets the correct priceTriggers array', async () => {
      setManager = await subject();

      const actualPriceTriggers = await setManager.getPriceTriggers.callAsync();

      expect(actualPriceTriggers).to.be.deep.equal(subjectPriceTriggers);
    });

    it('sets the correct triggerWeights array', async () => {
      setManager = await subject();

      const actualTriggerWeights = await setManager.getTriggerWeights.callAsync();

      expect(actualTriggerWeights).to.be.deep.equal(subjectTriggerWeights);
    });

    describe("but priceTriggers and triggerWeights length don't match", async () => {
      beforeEach(async () => {
        subjectTriggerWeights = [new BigNumber(50), new BigNumber(50)];
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe("but triggerWeights don't add to 100", async () => {
      beforeEach(async () => {
        subjectTriggerWeights = [new BigNumber(33), new BigNumber(33), new BigNumber(33)];
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#calculateBaseAssetAllocation', async () => {
    beforeEach(async () => {
      const baseAssetAllocation = ZERO;
      const allocationPrecision = new BigNumber(100);
      const auctionStartPercentage = new BigNumber(2);
      const auctionEndPercentage = new BigNumber(10);
      const auctionTimeToPivot = ONE_HOUR_IN_SECONDS.mul(4);
      const priceTriggers = [triggerOne.address, triggerTwo.address, triggerThree.address];
      const triggerWeights = [new BigNumber(34), new BigNumber(33), new BigNumber(33)];
      setManager = await managerHelper.deployTwoAssetWeightedStrategyManagerAsync(
        core.address,
        allocator,
        linearAuctionPriceCurve.address,
        baseAssetAllocation,
        allocationPrecision,
        auctionStartPercentage,
        auctionEndPercentage,
        auctionTimeToPivot,
        priceTriggers,
        triggerWeights,
      );
    });

    async function subject(): Promise<BigNumber> {
      return setManager.calculateBaseAssetAllocation.callAsync();
    }

    it('calculates the correct allocation amount', async () => {
      const actualBaseAssetAllocation = await subject();

      const expectedBaseAssetAllocation = new BigNumber(33 + 34);

      expect(actualBaseAssetAllocation).to.be.bignumber.equal(expectedBaseAssetAllocation);
    });
  });
});