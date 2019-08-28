require('module-alias/register');

import * as _ from 'lodash';
import * as ABIDecoder from 'abi-decoder';
import * as chai from 'chai';
import * as setProtocolUtils from 'set-protocol-utils';
import { Address } from 'set-protocol-utils';
import { BigNumber } from 'bignumber.js';

import ChaiSetup from '@utils/chaiSetup';
import { BigNumberSetup } from '@utils/bigNumberSetup';
import {
  Core,
  CoreContract,
  LinearAuctionPriceCurveContract,
  MedianContract,
  SetTokenContract,
  RebalanceAuctionModuleContract,
  RebalancingSetTokenContract,
  RebalancingSetTokenFactoryContract,
  SetTokenFactoryContract,
  StandardTokenMockContract,
  TransferProxyContract,
  WethMockContract,
} from 'set-protocol-contracts';

import {
  BTCETHRebalancingManagerContract,
} from '@utils/contracts';

import { Blockchain } from '@utils/blockchain';
import { ether } from '@utils/units';
import {
  DEFAULT_GAS,
  ONE_DAY_IN_SECONDS
} from '@utils/constants';
import { expectRevertError } from '@utils/tokenAssertions';
import { getDeployedAddress } from '@utils/snapshotUtils';
import { getWeb3 } from '@utils/web3Helper';
import { LogManagerProposal } from '@utils/contract_logs/btcEthRebalancingManager';

import { ProtocolHelper } from '@utils/helpers/protocolHelper';
import { ERC20Helper } from '@utils/helpers/erc20Helper';
import { OracleHelper } from '@utils/helpers/oracleHelper';
import { ManagerHelper } from '@utils/helpers/managerHelper';

BigNumberSetup.configure();
ChaiSetup.configure();
const web3 = getWeb3();
const BTCETHRebalancingManager = artifacts.require('BTCETHRebalancingManager');
const { expect } = chai;
const blockchain = new Blockchain(web3);
const { SetProtocolTestUtils: SetTestUtils } = setProtocolUtils;
const setTestUtils = new SetTestUtils(web3);

contract('BTCETHRebalancingManager', accounts => {
  const [
    deployerAccount,
    otherAccount,
  ] = accounts;

  let rebalancingSetToken: RebalancingSetTokenContract;

  let core: CoreContract;
  let transferProxy: TransferProxyContract;
  let rebalanceAuctionModule: RebalanceAuctionModuleContract;
  let factory: SetTokenFactoryContract;
  let rebalancingFactory: RebalancingSetTokenFactoryContract;
  let linearAuctionPriceCurve: LinearAuctionPriceCurveContract;
  let btcethRebalancingManager: BTCETHRebalancingManagerContract;
  let btcMedianizer: MedianContract;
  let ethMedianizer: MedianContract;
  let wrappedBTC: StandardTokenMockContract;
  let wrappedETH: WethMockContract;

  const protocolHelper = new ProtocolHelper(deployerAccount);
  const erc20Helper = new ERC20Helper(deployerAccount);
  const managerHelper = new ManagerHelper(deployerAccount);
  const oracleHelper = new OracleHelper(deployerAccount);

  before(async () => {
    ABIDecoder.addABI(Core.abi);
    ABIDecoder.addABI(BTCETHRebalancingManager.abi);
  });

  after(async () => {
    ABIDecoder.removeABI(Core.abi);
    ABIDecoder.removeABI(BTCETHRebalancingManager.abi);
  });

  beforeEach(async () => {
    blockchain.saveSnapshotAsync();

    core = await protocolHelper.getDeployedCoreAsync();
    transferProxy = await protocolHelper.getDeployedTransferProxyAsync();
    wrappedBTC = await protocolHelper.getDeployedWBTCAsync();
    wrappedETH = await protocolHelper.getDeployedWETHAsync();
    factory = await protocolHelper.getDeployedSetTokenFactoryAsync();
    rebalancingFactory = await protocolHelper.getDeployedRebalancingSetTokenFactoryAsync();
    rebalanceAuctionModule = await protocolHelper.getDeployedRebalanceAuctionModuleAsync();

    linearAuctionPriceCurve = await protocolHelper.getDeployedLinearAuctionPriceCurveAsync();

    ethMedianizer = await protocolHelper.getDeployedWETHMedianizerAsync();
    btcMedianizer = await protocolHelper.getDeployedWBTCMedianizerAsync();
  });

  afterEach(async () => {
    blockchain.revertAsync();
  });

  describe('#constructor', async () => {
    let subjectCoreAddress: Address;
    let subjectBtcPriceFeedAddress: Address;
    let subjectEthPriceFeedAddress: Address;
    let subjectBtcAddress: Address;
    let subjectEthAddress: Address;
    let subjectSetTokenFactory: Address;
    let subjectAuctionLibrary: Address;
    let subjectAuctionTimeToPivot: BigNumber;
    let subjectBtcMultiplier: BigNumber;
    let subjectEthMultiplier: BigNumber;
    let subjectLowerAllocationBound: BigNumber;
    let subjectUpperAllocationBound: BigNumber;

    beforeEach(async () => {
      subjectCoreAddress = getDeployedAddress(Core.contractName);
      subjectBtcPriceFeedAddress = getDeployedAddress('WBTC_MEDIANIZER');
      subjectEthPriceFeedAddress = getDeployedAddress('WETH_MEDIANIZER');
      subjectBtcAddress = getDeployedAddress('WBTC');
      subjectEthAddress = getDeployedAddress('WETH');
      subjectSetTokenFactory = getDeployedAddress('SetTokenFactory');
      subjectAuctionLibrary = getDeployedAddress('LinearAuctionPriceCurve');
      subjectAuctionTimeToPivot = ONE_DAY_IN_SECONDS;
      subjectBtcMultiplier = new BigNumber(1);
      subjectEthMultiplier = new BigNumber(1);
      subjectLowerAllocationBound = new BigNumber(48);
      subjectUpperAllocationBound = new BigNumber(52);
    });

    async function subject(): Promise<BTCETHRebalancingManagerContract> {
      return managerHelper.deployBTCETHRebalancingManagerAsync(
        subjectCoreAddress,
        subjectBtcPriceFeedAddress,
        subjectEthPriceFeedAddress,
        subjectBtcAddress,
        subjectEthAddress,
        subjectSetTokenFactory,
        subjectAuctionLibrary,
        subjectAuctionTimeToPivot,
        [subjectBtcMultiplier, subjectEthMultiplier],
        [subjectLowerAllocationBound, subjectUpperAllocationBound]
      );
    }

    it('sets wbtc address', async () => {
      const rebalancingManager = await subject();

      const actualBtcAddress = await rebalancingManager.btcAddress.callAsync();

      expect(actualBtcAddress).to.be.equal(subjectBtcAddress);
    });

    it('sets weth address', async () => {
      const rebalancingManager = await subject();

      const actualEthAddress = await rebalancingManager.ethAddress.callAsync();

      expect(actualEthAddress).to.be.equal(subjectEthAddress);
    });

    it('sets set token factory', async () => {
      const rebalancingManager = await subject();

      const actualSetTokenFactory = await rebalancingManager.setTokenFactory.callAsync();

      expect(actualSetTokenFactory).to.be.equal(subjectSetTokenFactory);
    });

    it('sets auction library', async () => {
      const rebalancingManager = await subject();

      const actualAuctionLibrary = await rebalancingManager.auctionLibrary.callAsync();

      expect(actualAuctionLibrary).to.be.equal(subjectAuctionLibrary);
    });

    it('sets correct auctionTimeToPivot', async () => {
      const rebalancingManager = await subject();

      const actualAuctionTimeToPivot = await rebalancingManager.auctionTimeToPivot.callAsync();

      expect(actualAuctionTimeToPivot).to.be.bignumber.eql(subjectAuctionTimeToPivot);
    });

    it('sets correct btcMultiplier', async () => {
      const rebalancingManager = await subject();

      const actualBtcMultiplier = await rebalancingManager.btcMultiplier.callAsync();

      expect(actualBtcMultiplier).to.be.bignumber.eql(subjectBtcMultiplier);
    });

    it('sets correct ethMultiplier', async () => {
      const rebalancingManager = await subject();

      const actualEthMultiplier = await rebalancingManager.ethMultiplier.callAsync();

      expect(actualEthMultiplier).to.be.bignumber.eql(subjectEthMultiplier);
    });

    it('sets correct btcPriceFeed', async () => {
      const rebalancingManager = await subject();

      const btcPriceFeed = await rebalancingManager.btcPriceFeed.callAsync();

      expect(btcPriceFeed).to.be.bignumber.eql(subjectBtcPriceFeedAddress);
    });

    it('sets correct ethPriceFeed', async () => {
      const rebalancingManager = await subject();

      const ethPriceFeed = await rebalancingManager.ethPriceFeed.callAsync();

      expect(ethPriceFeed).to.be.bignumber.eql(subjectEthPriceFeedAddress);
    });

    it('sets correct maximumLowerThreshold', async () => {
      const rebalancingManager = await subject();

      const maximumLowerThreshold = await rebalancingManager.maximumLowerThreshold.callAsync();

      expect(maximumLowerThreshold).to.be.bignumber.eql(subjectLowerAllocationBound);
    });

    it('sets correct minimumUpperThreshold', async () => {
      const rebalancingManager = await subject();

      const minimumUpperThreshold = await rebalancingManager.minimumUpperThreshold.callAsync();

      expect(minimumUpperThreshold).to.be.bignumber.eql(subjectUpperAllocationBound);
    });

    describe('when lower allocation bound is greater than upper', async () => {
      beforeEach(async () => {
        subjectLowerAllocationBound = new BigNumber(52);
        subjectUpperAllocationBound = new BigNumber(48);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });

  describe('#propose', async () => {
    let subjectRebalancingSetToken: Address;
    let subjectCaller: Address;
    let subjectTimeFastForward: BigNumber;

    let proposalPeriod: BigNumber;
    let btcMultiplier: BigNumber;
    let ethMultiplier: BigNumber;
    let lowerAllocationBound: BigNumber;
    let upperAllocationBound: BigNumber;
    let btcPrice: BigNumber;
    let ethPrice: BigNumber;
    let ethUnit: BigNumber;

    let initialAllocationToken: SetTokenContract;

    before(async () => {
      btcMultiplier = new BigNumber(1);
      ethMultiplier = new BigNumber(1);

      btcPrice = new BigNumber(4082 * 10 ** 18);
      ethPrice = new BigNumber(128 * 10 ** 18);
      ethUnit = new BigNumber(28.999 * 10 ** 10);
    });

    beforeEach(async () => {
      lowerAllocationBound = new BigNumber(48);
      upperAllocationBound = new BigNumber(52);
      btcethRebalancingManager = await managerHelper.deployBTCETHRebalancingManagerAsync(
        core.address,
        btcMedianizer.address,
        ethMedianizer.address,
        wrappedBTC.address,
        wrappedETH.address,
        factory.address,
        linearAuctionPriceCurve.address,
        ONE_DAY_IN_SECONDS,
        [btcMultiplier, ethMultiplier],
        [lowerAllocationBound, upperAllocationBound]
      );

      initialAllocationToken = await protocolHelper.createSetTokenAsync(
        core,
        factory.address,
        [wrappedBTC.address, wrappedETH.address],
        [new BigNumber(1).mul(btcMultiplier), ethUnit.mul(ethMultiplier)],
        new BigNumber(10 ** 10),
      );

      proposalPeriod = ONE_DAY_IN_SECONDS;
      rebalancingSetToken = await protocolHelper.createDefaultRebalancingSetTokenAsync(
        core,
        rebalancingFactory.address,
        btcethRebalancingManager.address,
        initialAllocationToken.address,
        proposalPeriod
      );

      subjectRebalancingSetToken = rebalancingSetToken.address;
      subjectCaller = otherAccount;
      subjectTimeFastForward = ONE_DAY_IN_SECONDS.add(1);

      await oracleHelper.addPriceFeedOwnerToMedianizer(btcMedianizer, deployerAccount);
      await oracleHelper.updateMedianizerPriceAsync(
        btcMedianizer,
        btcPrice,
        SetTestUtils.generateTimestamp(1000),
      );

      await oracleHelper.addPriceFeedOwnerToMedianizer(ethMedianizer, deployerAccount);
      await oracleHelper.updateMedianizerPriceAsync(
        ethMedianizer,
        ethPrice,
        SetTestUtils.generateTimestamp(1000),
      );

      await erc20Helper.approveTransfersAsync([wrappedBTC, wrappedETH], transferProxy.address);

      // Issue currentSetToken
      await core.issue.sendTransactionAsync(
        initialAllocationToken.address,
        ether(9),
        {from: deployerAccount, gas: DEFAULT_GAS},
      );

      await erc20Helper.approveTransfersAsync([initialAllocationToken], transferProxy.address);

      // Use issued currentSetToken to issue rebalancingSetToken
      await core.issue.sendTransactionAsync(rebalancingSetToken.address, ether(7), {
        from: deployerAccount, gas: DEFAULT_GAS,
      });
    });

    async function subject(): Promise<string> {
      await blockchain.increaseTimeAsync(subjectTimeFastForward);
      return btcethRebalancingManager.propose.sendTransactionAsync(
        subjectRebalancingSetToken,
        { from: subjectCaller, gas: DEFAULT_GAS}
      );
    }

    describe('when proposeNewRebalance is called from the Default state', async () => {
      it('updates new set token to the correct naturalUnit', async () => {
        await subject();

        const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
        const nextSetNaturalUnit = await nextSet.naturalUnit.callAsync();

        const expectedNextSetParams = managerHelper.getExpectedBtcEthNextSetParameters(
          btcPrice,
          ethPrice,
          btcMultiplier,
          ethMultiplier
        );
        expect(nextSetNaturalUnit).to.be.bignumber.equal(expectedNextSetParams['naturalUnit']);
      });

      it('updates new set token to the correct units', async () => {
        await subject();

        const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
        const nextSetUnits = await nextSet.getUnits.callAsync();

        const expectedNextSetParams = managerHelper.getExpectedBtcEthNextSetParameters(
          btcPrice,
          ethPrice,
          btcMultiplier,
          ethMultiplier
        );
        expect(JSON.stringify(nextSetUnits)).to.be.eql(JSON.stringify(expectedNextSetParams['units']));
      });

      it('updates new set token to the correct components', async () => {
        await subject();

        const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
        const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
        const nextSetComponents = await nextSet.getComponents.callAsync();

        const expectedNextSetComponents = [wrappedBTC.address, wrappedETH.address];
        expect(JSON.stringify(nextSetComponents)).to.be.eql(JSON.stringify(expectedNextSetComponents));
      });

      it('updates to the new auction library correctly', async () => {
        await subject();

        const newAuctionLibrary = await rebalancingSetToken.auctionLibrary.callAsync();
        expect(newAuctionLibrary).to.equal(linearAuctionPriceCurve.address);
      });

      it('updates the time to pivot correctly', async () => {
        await subject();

        const auctionPriceParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
        const newAuctionTimeToPivot = auctionPriceParameters[1];
        expect(newAuctionTimeToPivot).to.be.bignumber.equal(ONE_DAY_IN_SECONDS);
      });

      it('updates the auction start price correctly', async () => {
        await subject();

        const auctionPriceParameters = await managerHelper.getExpectedBtcEthAuctionParameters(
          btcPrice,
          ethPrice,
          btcMultiplier,
          ethMultiplier,
          ONE_DAY_IN_SECONDS,
          initialAllocationToken,
        );

        const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
        const newAuctionPivotPrice = newAuctionParameters[2];

        expect(newAuctionPivotPrice).to.be.bignumber.equal(auctionPriceParameters['auctionStartPrice']);
      });

      it('updates the auction pivot price correctly', async () => {
        await subject();

        const auctionPriceParameters = await managerHelper.getExpectedBtcEthAuctionParameters(
          btcPrice,
          ethPrice,
          btcMultiplier,
          ethMultiplier,
          ONE_DAY_IN_SECONDS,
          initialAllocationToken,
        );

        const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
        const newAuctionPivotPrice = newAuctionParameters[3];

        expect(newAuctionPivotPrice).to.be.bignumber.equal(auctionPriceParameters['auctionPivotPrice']);
      });

      it('emits correct LogProposal event', async () => {
        const txHash = await subject();

        const formattedLogs = await setTestUtils.getLogsFromTxHash(txHash);
        const expectedLogs = LogManagerProposal(
          btcPrice,
          ethPrice,
          btcethRebalancingManager.address
        );

        await SetTestUtils.assertLogEquivalence(formattedLogs, expectedLogs);
      });

      describe('when the new allocation is 75/25', async () => {
        before(async () => {
          btcMultiplier = new BigNumber(3);
          ethMultiplier = new BigNumber(1);
        });

        after(async () => {
          btcMultiplier = new BigNumber(1);
          ethMultiplier = new BigNumber(1);
        });

        it('updates new set token to the correct naturalUnit', async () => {
          await subject();

          const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
          const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
          const nextSetNaturalUnit = await nextSet.naturalUnit.callAsync();

          const expectedNextSetParams = managerHelper.getExpectedBtcEthNextSetParameters(
            btcPrice,
            ethPrice,
            btcMultiplier,
            ethMultiplier
          );
          expect(nextSetNaturalUnit).to.be.bignumber.equal(expectedNextSetParams['naturalUnit']);
        });

        it('updates new set token to the correct units', async () => {
          await subject();

          const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
          const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
          const nextSetUnits = await nextSet.getUnits.callAsync();

          const expectedNextSetParams = managerHelper.getExpectedBtcEthNextSetParameters(
            btcPrice,
            ethPrice,
            btcMultiplier,
            ethMultiplier
          );

          expect(JSON.stringify(nextSetUnits)).to.be.eql(JSON.stringify(expectedNextSetParams['units']));
        });
      });

      describe('but the price of ETH is greater than BTC', async () => {
        before(async () => {
          btcPrice = new BigNumber(2000 * 10 ** 18);
          ethPrice = new BigNumber(2500 * 10 ** 18);
          ethUnit = new BigNumber(10 ** 10);
        });

        after(async () => {
          btcPrice = new BigNumber(3500 * 10 ** 18);
          ethPrice = new BigNumber(150 * 10 ** 18);
          ethUnit = new BigNumber(40 * 10 ** 10);
        });

        it('updates new set token to the correct naturalUnit', async () => {
          await subject();

          const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
          const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
          const nextSetNaturalUnit = await nextSet.naturalUnit.callAsync();

          const expectedNextSetParams = managerHelper.getExpectedBtcEthNextSetParameters(
            btcPrice,
            ethPrice,
            btcMultiplier,
            ethMultiplier
          );
          expect(nextSetNaturalUnit).to.be.bignumber.equal(expectedNextSetParams['naturalUnit']);
        });

        it('updates new set token to the correct units', async () => {
          await subject();

          const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
          const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
          const nextSetUnits = await nextSet.getUnits.callAsync();

          const expectedNextSetParams = managerHelper.getExpectedBtcEthNextSetParameters(
            btcPrice,
            ethPrice,
            btcMultiplier,
            ethMultiplier
          );
          expect(JSON.stringify(nextSetUnits)).to.be.eql(JSON.stringify(expectedNextSetParams['units']));
        });

        it('updates the auction start price correctly', async () => {
          await subject();

          const auctionPriceParameters = await managerHelper.getExpectedBtcEthAuctionParameters(
            btcPrice,
            ethPrice,
            btcMultiplier,
            ethMultiplier,
            ONE_DAY_IN_SECONDS,
            initialAllocationToken,
          );

          const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
          const newAuctionPivotPrice = newAuctionParameters[2];

          expect(newAuctionPivotPrice).to.be.bignumber.equal(auctionPriceParameters['auctionStartPrice']);
        });

        it('updates the auction pivot price correctly', async () => {
          await subject();

          const auctionPriceParameters = await managerHelper.getExpectedBtcEthAuctionParameters(
            btcPrice,
            ethPrice,
            btcMultiplier,
            ethMultiplier,
            ONE_DAY_IN_SECONDS,
            initialAllocationToken,
          );

          const newAuctionParameters = await rebalancingSetToken.auctionPriceParameters.callAsync();
          const newAuctionPivotPrice = newAuctionParameters[3];

          expect(newAuctionPivotPrice).to.be.bignumber.equal(auctionPriceParameters['auctionPivotPrice']);
        });

        describe('but the new allocation is 75/25', async () => {
          before(async () => {
            btcMultiplier = new BigNumber(3);
            ethMultiplier = new BigNumber(1);
          });

          after(async () => {
            btcMultiplier = new BigNumber(1);
            ethMultiplier = new BigNumber(1);
          });

          it('updates new set token to the correct naturalUnit', async () => {
            await subject();

            const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
            const nextSetNaturalUnit = await nextSet.naturalUnit.callAsync();

            const expectedNextSetParams = managerHelper.getExpectedBtcEthNextSetParameters(
              btcPrice,
              ethPrice,
              btcMultiplier,
              ethMultiplier
            );
            expect(nextSetNaturalUnit).to.be.bignumber.equal(expectedNextSetParams['naturalUnit']);
          });

          it('updates new set token to the correct units', async () => {
            await subject();

            const nextSetAddress = await rebalancingSetToken.nextSet.callAsync();
            const nextSet = await protocolHelper.getSetTokenAsync(nextSetAddress);
            const nextSetUnits = await nextSet.getUnits.callAsync();

            const expectedNextSetParams = managerHelper.getExpectedBtcEthNextSetParameters(
              btcPrice,
              ethPrice,
              btcMultiplier,
              ethMultiplier
            );
            expect(JSON.stringify(nextSetUnits)).to.be.eql(JSON.stringify(expectedNextSetParams['units']));
          });
        });
      });

      describe('but the passed rebalancing set address was not created by Core', async () => {
        beforeEach(async () => {
          const unTrackedSetToken = await protocolHelper.createDefaultRebalancingSetTokenAsync(
            core,
            rebalancingFactory.address,
            btcethRebalancingManager.address,
            initialAllocationToken.address,
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

      describe('but the computed token allocation is too close to the bounds', async () => {
        before(async () => {
          btcPrice = new BigNumber(4000 * 10 ** 18);
          ethPrice = new BigNumber(100 * 10 ** 18);
        });

        after(async () => {
          btcPrice = new BigNumber(3500 * 10 ** 18);
          ethPrice = new BigNumber(150 * 10 ** 18);
        });

        it('should revert', async () => {
          await expectRevertError(subject());
        });
      });

      describe('but the rebalance interval has not elapsed', async () => {
        beforeEach(async () => {
          subjectTimeFastForward = ONE_DAY_IN_SECONDS.sub(10);
        });

        it('should revert', async () => {
          await expectRevertError(subject());
        });
      });
    });

    describe('when proposeNewRebalance is called from Proposal state', async () => {
      let timeJump: BigNumber;

      beforeEach(async () => {
        await blockchain.increaseTimeAsync(subjectTimeFastForward);
        await btcethRebalancingManager.propose.sendTransactionAsync(
          subjectRebalancingSetToken,
        );

        timeJump = new BigNumber(1000);
        await blockchain.increaseTimeAsync(timeJump);
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('when proposeNewRebalance is called from Rebalance state', async () => {
      beforeEach(async () => {
        await blockchain.increaseTimeAsync(subjectTimeFastForward);
        await btcethRebalancingManager.propose.sendTransactionAsync(
          subjectRebalancingSetToken,
        );

        // Transition to rebalance
        await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS.add(1));
        await rebalancingSetToken.startRebalance.sendTransactionAsync(
          { from: otherAccount, gas: DEFAULT_GAS }
        );
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });

    describe('when proposeNewRebalance is called from Drawdown State', async () => {
      beforeEach(async () => {
        // propose rebalance
        await blockchain.increaseTimeAsync(subjectTimeFastForward);
        await btcethRebalancingManager.propose.sendTransactionAsync(
          subjectRebalancingSetToken,
        );

        // Transition to rebalance
        await blockchain.increaseTimeAsync(ONE_DAY_IN_SECONDS.add(1));

        await rebalancingSetToken.startRebalance.sendTransactionAsync(
          { from: otherAccount, gas: DEFAULT_GAS }
        );

        const defaultTimeToPivot = new BigNumber(100000);
        await blockchain.increaseTimeAsync(defaultTimeToPivot.add(1));

        const biddingParameters = await rebalancingSetToken.biddingParameters.callAsync();
        const minimumBid = biddingParameters[0];
        await rebalanceAuctionModule.bid.sendTransactionAsync(
          rebalancingSetToken.address,
          minimumBid,
          false,
          { from: deployerAccount, gas: DEFAULT_GAS}
        );

        await rebalancingSetToken.endFailedAuction.sendTransactionAsync(
          { from: otherAccount, gas: DEFAULT_GAS}
        );
      });

      it('should revert', async () => {
        await expectRevertError(subject());
      });
    });
  });
});