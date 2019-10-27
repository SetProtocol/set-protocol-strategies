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
  PriceTriggerMockContract,
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
    allocationPricer,
  ] = accounts;

  let core: CoreContract;
  let linearAuctionPriceCurve: LinearAuctionPriceCurveContract;

  let priceTriggerOne: PriceTriggerMockContract;
  let priceTriggerTwo: PriceTriggerMockContract;
  let priceTriggerThree: PriceTriggerMockContract;

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
      priceTriggerOne,
      priceTriggerTwo,
      priceTriggerThree,
    ] = await managerHelper.deployPriceTriggerMocksAsync(
      3,
      [true, false, true]
    );
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectCoreInstance: Address;
    let subjectAllocationPricerInstance: Address;
    let subjectAuctionLibraryInstance: Address;
    let subjectBaseAssetAllocation: BigNumber;
    let subjectAllocationPrecision: BigNumber;
    let subjectAuctionTimeToPivot: BigNumber;
    let subjectAuctionSpeed: BigNumber;
    let subjectPriceTriggers: Address[];
    let subjectTriggerWeights: BigNumber[];
    let subjectCaller: Address;

    beforeEach(async () => {
      subjectCoreInstance = core.address;
      subjectAllocationPricerInstance = allocationPricer;
      subjectAuctionLibraryInstance = linearAuctionPriceCurve.address;
      subjectBaseAssetAllocation = ZERO;
      subjectAllocationPrecision = new BigNumber(100);
      subjectAuctionTimeToPivot = ONE_HOUR_IN_SECONDS.mul(2);
      subjectAuctionSpeed = ONE_HOUR_IN_SECONDS.div(6);
      subjectPriceTriggers = [priceTriggerOne.address, priceTriggerTwo.address, priceTriggerThree.address];
      subjectTriggerWeights = [new BigNumber(34), new BigNumber(33), new BigNumber(33)];
      subjectCaller = deployerAccount;
    });

    async function subject(): Promise<TwoAssetWeightedStrategyManagerContract> {
      return managerHelper.deployTwoAssetWeightedStrategyManagerAsync(
        subjectCoreInstance,
        subjectAllocationPricerInstance,
        subjectAuctionLibraryInstance,
        subjectBaseAssetAllocation,
        subjectAllocationPrecision,
        subjectAuctionTimeToPivot,
        subjectAuctionSpeed,
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
      const auctionTimeToPivot = ONE_HOUR_IN_SECONDS.mul(2);
      const auctionSpeed = ONE_HOUR_IN_SECONDS.div(6);
      const priceTriggers = [priceTriggerOne.address, priceTriggerTwo.address, priceTriggerThree.address];
      const triggerWeights = [new BigNumber(34), new BigNumber(33), new BigNumber(33)];
      setManager = await managerHelper.deployTwoAssetWeightedStrategyManagerAsync(
        core.address,
        allocationPricer,
        linearAuctionPriceCurve.address,
        baseAssetAllocation,
        allocationPrecision,
        auctionTimeToPivot,
        auctionSpeed,
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