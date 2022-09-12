import { ethers, network } from "hardhat";
import { MultiRewards, Digits, IERC20, TokenStorage, IUniswapV2Router02, WrapERC20 } from "../typechain-types";
import { expect } from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { getBigNumber } from "../utils";
import { constants } from "ethers";

describe("MultiRewards", function () {
    let MultiRewards: MultiRewards;
    let SushiRouter: IUniswapV2Router02;
    let TokenStorage: TokenStorage;
    let deployer: SignerWithAddress;
    let alice: SignerWithAddress;
    let bob: SignerWithAddress;
    let Digits: Digits;
    let snapshotId: string;
    let Dai: IERC20;
    const tokenAmount = getBigNumber(10_000);
    const initialUserAmount = getBigNumber(500_000);
    const initialDeployerAmount = getBigNumber(10_000_000);
    const rewardsDuration = 86400 * 7;
    const DAI = "0x6B175474E89094C44Da98b954EedeAC495271d0F"
    const SUSHI_ROUTER = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F"
    const DAI_WHALE = "0xF977814e90dA44bFA03b6295A0616a897441aceC"
    const PRECISION = getBigNumber(1, 5);
    const EXPECTED_WITHDRAWABLE_AMOUNT = getBigNumber("32621448591520465892", 0);

    before(async () => {
        [deployer, alice, bob] = await ethers.getSigners();

        Dai = await ethers.getContractAt(
            "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", DAI) as IERC20;

        SushiRouter = await ethers.getContractAt("IUniswapV2Router02", SUSHI_ROUTER) as IUniswapV2Router02;

        // send dai to deployer
        const daiWhale = await ethers.getImpersonatedSigner(DAI_WHALE);
        await Dai.connect(daiWhale).transfer(deployer.address, initialDeployerAmount)
        await Dai.connect(daiWhale).transfer(deployer.address, initialDeployerAmount)

        // deploy Digits
        const digitsFactory = await ethers.getContractFactory("Digits");
        Digits = (await digitsFactory.deploy(Dai.address, SushiRouter.address, deployer.address, [deployer.address])) as Digits;

        // deploy TokenStorage
        const tokenStorageFactory = await ethers.getContractFactory("TokenStorage");
        const dividendTracker = await Digits.dividendTracker();
        TokenStorage = (await tokenStorageFactory.deploy(Dai.address, Digits.address, deployer.address, dividendTracker, SushiRouter.address)) as TokenStorage;
        await TokenStorage.addManager(Digits.address);
        await Digits.setTokenStorage(TokenStorage.address);

        // deploy MultiRewards
        const contractFactory = await ethers.getContractFactory("MultiRewards");
        MultiRewards = (await contractFactory.deploy(deployer.address, Digits.address, Dai.address)) as MultiRewards;

        // digits related management
        await Digits.openTrading();
        await Digits.excludeFromFees(MultiRewards.address, true);
        await Digits.excludeFromMaxTx(MultiRewards.address, true);
        await Digits.excludeFromMaxWallet(MultiRewards.address, true);
        await Digits.transfer(alice.address, initialUserAmount);
        await Digits.transfer(bob.address, initialUserAmount);
        await Digits.connect(alice).approve(MultiRewards.address, constants.MaxUint256);
        await Digits.connect(bob).approve(MultiRewards.address, constants.MaxUint256);
        await Digits.connect(bob).approve(SushiRouter.address, constants.MaxUint256);
        await Dai.approve(MultiRewards.address, constants.MaxUint256);
        await Digits.updateDividendSettings(true, getBigNumber(1_000), true);

        // add liquidity for DIGITS-DAI pair
        const currentBlock = await ethers.provider.getBlockNumber();
        const blockTime = (await ethers.provider.getBlock(currentBlock)).timestamp;
        await Digits.approve(SushiRouter.address, constants.MaxUint256);
        await Dai.approve(SushiRouter.address, constants.MaxUint256);
        await SushiRouter.addLiquidity(
            Digits.address,
            Dai.address,
            getBigNumber(10_000_000),
            getBigNumber(10_000_000),
            0,
            0,
            deployer.address,
            blockTime + 10000
        )

        snapshotId = await ethers.provider.send("evm_snapshot", []);
    });

    async function makeFewTrades(tradesCount = 2, tradeValue = 100_000) {
        for (let index = 0; index < tradesCount; index++) {
            const currentBlock = await ethers.provider.getBlockNumber();
            const blockTime = (await ethers.provider.getBlock(currentBlock)).timestamp;
            await SushiRouter.connect(bob).swapExactTokensForTokensSupportingFeeOnTransferTokens(
                getBigNumber(tradeValue),
                0,
                [Digits.address, Dai.address],
                bob.address,
                blockTime + 1
            )
        }
    };

    afterEach(async () => {
        await network.provider.send("evm_revert", [snapshotId]);
        snapshotId = await ethers.provider.send("evm_snapshot", []);
    });

    describe("addReward", () => {
        it("should add reward token", async function () {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
            const rewardToken = await MultiRewards.rewardTokens(0);
            const rewardTokenLength = await MultiRewards.rewardTokenLength();
            const rewardData = await MultiRewards.rewardData(rewardToken);

            expect(rewardToken).to.be.equal(Dai.address);
            expect(rewardTokenLength).to.be.equal(1);
            expect(rewardData["rewardsDistributor"]).to.be.equal(deployer.address);
            expect(rewardData["rewardsDuration"]).to.be.equal(rewardsDuration);
        });

        it("should execute only by the owner", async function () {
            const action = MultiRewards.connect(alice).addReward(Dai.address, deployer.address, rewardsDuration);
            await expect(action).to.be.revertedWith('Only the contract owner may perform this action');
        });

        it("should not add reward if current duration is not zero", async function () {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
            const action = MultiRewards.addReward(Dai.address, deployer.address, 10_000);
            await expect(action).to.be.reverted;
        });

        it("should not add reward if new duration is zero", async function () {
            const action = MultiRewards.addReward(Dai.address, deployer.address, 0);
            await expect(action).to.be.revertedWith('Reward duration must be non-zero');
        });
    });

    describe("lastTimeRewardApplicable", () => {
        beforeEach("added token", async () => {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
        });

        it("should return zero just after adding reward", async () => {
            const lastTimeRewardApplicable = await MultiRewards.lastTimeRewardApplicable(Dai.address);
            expect(lastTimeRewardApplicable).to.be.equal(0);
        });

        it("should return block.timestamp if reward period is in the future", async () => {
            await MultiRewards.notifyRewardAmount(Dai.address, tokenAmount);
            await network.provider.send("hardhat_mine", ['0x' + Number(1).toString(16), '0x' + Number(3600).toString(16)]);
            const lastTimeRewardApplicable = await MultiRewards.lastTimeRewardApplicable(Dai.address);
            const currentBlock = await ethers.provider.getBlockNumber();
            const blockTime = (await ethers.provider.getBlock(currentBlock)).timestamp;
            expect(lastTimeRewardApplicable).to.be.equal(blockTime);
        });

        it("should return reward period if reward period is in the past", async () => {
            await MultiRewards.notifyRewardAmount(Dai.address, tokenAmount);
            await network.provider.send("hardhat_mine", ['0x' + Number(169).toString(16), '0x' + Number(3600).toString(16)]);
            const rewardData = await MultiRewards.rewardData(Dai.address);
            const lastTimeRewardApplicable = await MultiRewards.lastTimeRewardApplicable(Dai.address);
            expect(lastTimeRewardApplicable).to.be.equal(rewardData["periodFinish"]);
        });
    });

    describe("rewardTokenLength", () => {
        it("should return reward token length (0)", async () => {
            const rewardTokenLength = await MultiRewards.rewardTokenLength();
            expect(rewardTokenLength).to.be.equal(0);
        });

        it("should return reward token length (1)", async () => {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
            const rewardTokenLength = await MultiRewards.rewardTokenLength();
            expect(rewardTokenLength).to.be.equal(1);
        });
    });

    describe("notifyRewardAmount", () => {
        beforeEach("added token", async () => {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
        });

        it("should add reward for token", async () => {
            const beforeOwnerBalance = await Dai.balanceOf(deployer.address);
            await MultiRewards.notifyRewardAmount(Dai.address, tokenAmount);
            const afterOwnerBalance = await Dai.balanceOf(deployer.address);
            const { rewardsDuration, periodFinish, rewardRate, lastUpdateTime, rewardPerTokenStored }
                = await MultiRewards.rewardData(Dai.address);
            const currentBlock = await ethers.provider.getBlockNumber();
            const blockTime = (await ethers.provider.getBlock(currentBlock)).timestamp;

            expect(beforeOwnerBalance).to.be.equal(initialDeployerAmount);
            expect(afterOwnerBalance).to.be.equal(beforeOwnerBalance.sub(tokenAmount));
            expect(afterOwnerBalance).not.be.equal(beforeOwnerBalance);
            expect(rewardPerTokenStored).to.be.equal(0);
            expect(lastUpdateTime).to.be.equal(blockTime);
            expect(periodFinish).to.be.equal(rewardsDuration.add(blockTime));
            expect(rewardRate).to.be.equal(tokenAmount.div(rewardsDuration));
        });

        it("should execute only by the token distributor", async function () {
            const action = MultiRewards.connect(alice).notifyRewardAmount(Dai.address, tokenAmount);
            await expect(action).to.be.reverted;
        });

        it("should not update reflection", async function () {
            await MultiRewards.connect(alice).stake(tokenAmount);
            await makeFewTrades();
            const beforeWithdrawableReflection = await Digits.withdrawableDividendOf(MultiRewards.address);
            const beforeDaiBalance = await Dai.balanceOf(MultiRewards.address);
            await MultiRewards.notifyRewardAmount(Dai.address, tokenAmount);
            const afterWithdrawableReflection = await Digits.withdrawableDividendOf(MultiRewards.address);
            const afterDaiBalance = await Dai.balanceOf(MultiRewards.address);
            expect(beforeWithdrawableReflection).to.be.equal(afterWithdrawableReflection);
            expect(beforeDaiBalance).to.be.equal(afterDaiBalance.sub(tokenAmount));
            expect(beforeWithdrawableReflection.gt(getBigNumber(0)));
        });

        it("should not allow overflow in rewardRate", async () => {
            const action = MultiRewards.notifyRewardAmount(Dai.address, constants.MaxUint256);
            await expect(action).to.revertedWith("Reward too large, would lock")
        });

        it("should not allow overflow in rewardRate (edge case)", async () => {
            const tokenFactory = await ethers.getContractFactory("WrapERC20");
            const Token = (await tokenFactory.deploy("Token", "T")) as WrapERC20;
            await Token.mint(deployer.address, constants.MaxUint256);
            await Token.approve(MultiRewards.address, constants.MaxUint256);
            await MultiRewards.addReward(Token.address, deployer.address, rewardsDuration);
            await MultiRewards.notifyRewardAmount(Token.address, constants.MaxUint256.div(getBigNumber(1, 18)));
            const action = MultiRewards.rewardPerToken(Token.address);
            await expect(action).to.not.be.reverted;
        });
    });

    describe("setRewardsDuration", () => {
        beforeEach("added token", async () => {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
        });

        it("should update rewardDuration", async () => {
            await MultiRewards.setRewardsDuration(Dai.address, 10);

            const { rewardsDuration, lastUpdateTime, rewardPerTokenStored } = await MultiRewards.rewardData(Dai.address);
            const currentBlock = await ethers.provider.getBlockNumber();
            const blockTime = (await ethers.provider.getBlock(currentBlock)).timestamp;

            expect(rewardPerTokenStored).to.be.equal(0);
            expect(lastUpdateTime).to.be.equal(0);
            expect(rewardsDuration).to.be.equal(10);
        });

        it("should execute only by the token distributor", async function () {
            const action = MultiRewards.connect(alice).setRewardsDuration(Dai.address, 10);
            await expect(action).to.be.reverted;
        });

        it("should emit RateChanged event", async () => {
            const action = MultiRewards.setRewardsDuration(Dai.address, 10);
            await expect(action).to.emit(MultiRewards, 'RewardsDurationUpdated').withArgs(Dai.address, 10);
        });

        it("should not update if duration is still active", async function () {
            await MultiRewards.notifyRewardAmount(Dai.address, tokenAmount);
            const action = MultiRewards.setRewardsDuration(Dai.address, 10);
            await expect(action).to.revertedWith('Reward period still active');
        });
    });

    describe("setRewardsDistributor", () => {
        beforeEach("added rewards", async () => {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
            await MultiRewards.notifyRewardAmount(Dai.address, tokenAmount);
        });

        it("should set proper values", async () => {
            const beforeRewardsDistributor = (await MultiRewards.rewardData(Dai.address))["rewardsDistributor"];
            await MultiRewards.setRewardsDistributor(Dai.address, bob.address);
            const afterRewardsDistributor = (await MultiRewards.rewardData(Dai.address))["rewardsDistributor"];
            expect(beforeRewardsDistributor).to.equal(deployer.address);
            expect(afterRewardsDistributor).to.equal(bob.address);
        });
    });

    describe("recoverERC20", () => {
        it("should emit Recovered", async () => {
            await Dai.transfer(MultiRewards.address, tokenAmount);
            const action = MultiRewards.recoverERC20(Dai.address, tokenAmount);
            await expect(action).to.emit(MultiRewards, "Recovered").withArgs(Dai.address, tokenAmount);
        });

        it("should transfer tokens to owner before setting reward", async () => {
            await Dai.transfer(MultiRewards.address, tokenAmount);
            const beforeOwnerBalance = await Dai.balanceOf(deployer.address);
            const beforeMultiRewardsBalance = await Dai.balanceOf(MultiRewards.address);
            await MultiRewards.recoverERC20(Dai.address, tokenAmount);
            const afterOwnerBalance = await Dai.balanceOf(deployer.address);
            const afterMultiRewardsBalance = await Dai.balanceOf(MultiRewards.address);

            expect(beforeOwnerBalance).to.be.equal(initialDeployerAmount.sub(tokenAmount));
            expect(afterOwnerBalance).to.be.equal(initialDeployerAmount);
            expect(afterOwnerBalance).not.be.equal(beforeOwnerBalance);
            expect(beforeMultiRewardsBalance).to.be.equal(tokenAmount);
            expect(afterMultiRewardsBalance).to.be.equal(0);
            expect(afterMultiRewardsBalance).not.be.equal(beforeMultiRewardsBalance);
        });

        it("should transfer tokens to owner before any updateReward", async () => {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
            await Dai.transfer(MultiRewards.address, tokenAmount);
            const beforeOwnerBalance = await Dai.balanceOf(deployer.address);
            const beforeMultiRewardsBalance = await Dai.balanceOf(MultiRewards.address);
            await MultiRewards.recoverERC20(Dai.address, tokenAmount);
            const afterOwnerBalance = await Dai.balanceOf(deployer.address);
            const afterMultiRewardsBalance = await Dai.balanceOf(MultiRewards.address);

            expect(beforeOwnerBalance).to.be.equal(initialDeployerAmount.sub(tokenAmount));
            expect(afterOwnerBalance).to.be.equal(initialDeployerAmount);
            expect(afterOwnerBalance).not.be.equal(beforeOwnerBalance);
            expect(beforeMultiRewardsBalance).to.be.equal(tokenAmount);
            expect(afterMultiRewardsBalance).to.be.equal(0);
            expect(afterMultiRewardsBalance).not.be.equal(beforeMultiRewardsBalance);
        });

        it("should check staking address", async function () {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
            const action = MultiRewards.recoverERC20(Digits.address, 10);
            await expect(action).to.revertedWith('Cannot withdraw staking token');
        });

        it("should check reward address", async function () {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
            await MultiRewards.notifyRewardAmount(Dai.address, tokenAmount);
            const action = MultiRewards.recoverERC20(Dai.address, 0);
            await expect(action).to.revertedWith('Cannot withdraw reward token');
        });

        it("should execute only by the owner", async function () {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
            const action = MultiRewards.connect(alice).recoverERC20(Dai.address, 10);
            await expect(action).to.revertedWith('Only the contract owner may perform this action');
        });
    });

    describe("stake", () => {
        it("should emit Staked", async () => {
            const action = MultiRewards.connect(alice).stake(tokenAmount);
            await expect(action).to.emit(MultiRewards, "Staked").withArgs(alice.address, tokenAmount);
        });

        it("should check 0 amount", async () => {
            const action = MultiRewards.connect(alice).stake(0);
            await expect(action).to.revertedWith('Cannot stake 0');
        });

        it("should stake properly", async () => {
            const beforeTotalSupply = await MultiRewards.totalSupply();
            const beforeAliceStakingTokenBalance = await Digits.balanceOf(alice.address);
            const beforeContractBalance = await Digits.balanceOf(MultiRewards.address);
            await MultiRewards.connect(alice).stake(tokenAmount);
            const afterTotalSupply = await MultiRewards.totalSupply();
            const afterAliceStakingTokenBalance = await Digits.balanceOf(alice.address);
            const afterContractBalance = await Digits.balanceOf(MultiRewards.address);

            expect(beforeTotalSupply).to.be.equal(0);
            expect(afterTotalSupply).to.be.equal(beforeTotalSupply.add(tokenAmount));
            expect(afterTotalSupply).not.be.equal(beforeTotalSupply);

            expect(beforeAliceStakingTokenBalance).to.be.equal(initialUserAmount);
            expect(afterAliceStakingTokenBalance).to.be.equal(beforeAliceStakingTokenBalance.sub(tokenAmount));
            expect(afterAliceStakingTokenBalance).not.be.equal(beforeAliceStakingTokenBalance);

            expect(beforeContractBalance).to.be.equal(0);
            expect(afterContractBalance).to.be.equal(beforeContractBalance.add(tokenAmount));
            expect(afterContractBalance).not.be.equal(beforeContractBalance);

            const balance = await MultiRewards.balanceOf(alice.address);
            expect(balance).to.be.equal(tokenAmount);
        });

        it("should process reflection on consequent stake", async () => {
            await MultiRewards.connect(alice).stake(tokenAmount);
            await makeFewTrades();
            const beforeDaiBalance = await Dai.balanceOf(alice.address);
            const beforeContractDaiBalance = await Dai.balanceOf(MultiRewards.address);
            await MultiRewards.connect(alice).stake(tokenAmount);
            const afterContractDaiBalance = await Dai.balanceOf(MultiRewards.address);
            const afterDaiBalance = await Dai.balanceOf(alice.address);
            expect(beforeContractDaiBalance).to.equal(0);
            expect(afterDaiBalance).to.not.equal(beforeDaiBalance);
            expect(afterContractDaiBalance).lt(getBigNumber(1, 5));
        });
    });

    describe("reflection mechanic", () => {
        beforeEach("prepare", async () => {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
            await MultiRewards.notifyRewardAmount(Dai.address, tokenAmount);
        });

        it("should claim proper value on stake", async () => {
            await MultiRewards.connect(alice).stake(tokenAmount);
            await makeFewTrades(1);
            // trigger dividend distribution
            await Digits.connect(bob).transfer(Digits.address, 0);

            const beforeWithdrawable = await Digits.withdrawableDividendOf(MultiRewards.address);
            const beforeContractDaiBalance = await Dai.balanceOf(MultiRewards.address);
            const beforeUserDaiBalance = await Dai.balanceOf(alice.address);

            await MultiRewards.connect(alice).stake(tokenAmount);

            const afterWithdrawable = await Digits.withdrawableDividendOf(MultiRewards.address);
            const afterContractDaiBalance = await Dai.balanceOf(MultiRewards.address);
            const afterUserDaiBalance = await Dai.balanceOf(alice.address);

            const expectedWithdrawableAmount = EXPECTED_WITHDRAWABLE_AMOUNT

            expect(beforeWithdrawable).to.equal(expectedWithdrawableAmount);
            expect(beforeUserDaiBalance).to.equal(0);
            expect(beforeContractDaiBalance).to.equal(tokenAmount);

            expect(afterWithdrawable).to.equal(0);
            expect(afterUserDaiBalance).to.equal(expectedWithdrawableAmount);
            expect(afterContractDaiBalance).to.equal(tokenAmount);
        });

        it("should claim proper value on stake updating reflection", async () => {
            await MultiRewards.connect(alice).stake(tokenAmount);
            await makeFewTrades(1);

            const beforeWithdrawable = await Digits.withdrawableDividendOf(MultiRewards.address);
            const beforeContractDaiBalance = await Dai.balanceOf(MultiRewards.address);
            const beforeUserDaiBalance = await Dai.balanceOf(alice.address);

            // trigger dividend distribution
            await MultiRewards.connect(alice).stake(tokenAmount);

            const afterWithdrawable = await Digits.withdrawableDividendOf(MultiRewards.address);
            const afterContractDaiBalance = await Dai.balanceOf(MultiRewards.address);
            const afterUserDaiBalance = await Dai.balanceOf(alice.address);

            const expectedWithdrawableAmount = EXPECTED_WITHDRAWABLE_AMOUNT

            expect(beforeWithdrawable).to.equal(0);
            expect(beforeUserDaiBalance).to.equal(0);
            expect(beforeContractDaiBalance).to.equal(tokenAmount);

            expect(afterWithdrawable).to.equal(0);
            expect(afterUserDaiBalance).to.equal(expectedWithdrawableAmount);
            expect(afterContractDaiBalance).to.equal(tokenAmount);
        });

        it("should work for many users staking (easy)", async () => {
            await MultiRewards.connect(alice).stake(tokenAmount);
            await MultiRewards.connect(bob).stake(tokenAmount);

            await makeFewTrades(1);
            // make bob have zero dai and trigger dividend distribution
            await Dai.connect(bob).transfer(deployer.address, await Dai.balanceOf(bob.address));
            await Digits.connect(bob).transfer(Digits.address, 0);

            const beforeWithdrawable = await Digits.withdrawableDividendOf(MultiRewards.address);
            const beforeContractDaiBalance = await Dai.balanceOf(MultiRewards.address);
            const beforeAliceDaiBalance = await Dai.balanceOf(alice.address);
            const beforeBobDaiBalance = await Dai.balanceOf(bob.address);

            await MultiRewards.connect(bob).stake(tokenAmount);
            await MultiRewards.connect(alice).stake(tokenAmount);

            const afterWithdrawable = await Digits.withdrawableDividendOf(MultiRewards.address);
            const afterContractDaiBalance = await Dai.balanceOf(MultiRewards.address);
            const afterAliceDaiBalance = await Dai.balanceOf(alice.address);
            const afterBobDaiBalance = await Dai.balanceOf(bob.address);

            const expectedWithdrawableAmount = EXPECTED_WITHDRAWABLE_AMOUNT.mul(2);
            const expectedWithdrawableAmountperUser = expectedWithdrawableAmount.div(2);

            expect(beforeWithdrawable).to.equal(expectedWithdrawableAmount);
            expect(beforeAliceDaiBalance).to.equal(0);
            expect(beforeBobDaiBalance).to.equal(0);
            expect(beforeContractDaiBalance).to.equal(tokenAmount);

            expect(afterWithdrawable).to.equal(0);
            expect(afterAliceDaiBalance).to.equal(afterBobDaiBalance);
            expect(afterAliceDaiBalance).to.equal(expectedWithdrawableAmountperUser);
            expect(afterBobDaiBalance).to.equal(expectedWithdrawableAmountperUser);
            expect(afterContractDaiBalance).to.equal(tokenAmount);
            expect(afterContractDaiBalance.sub(beforeContractDaiBalance)).lt(PRECISION);
        });

        it("should work for many users staking (complex)", async () => {
            await MultiRewards.connect(alice).stake(tokenAmount);
            await MultiRewards.connect(bob).stake(tokenAmount);

            await makeFewTrades(1);
            // make bob have zero dai and trigger dividend distribution
            await Dai.connect(bob).transfer(deployer.address, await Dai.balanceOf(bob.address));
            await Digits.connect(bob).transfer(Digits.address, 0);

            const beforeWithdrawable = await Digits.withdrawableDividendOf(MultiRewards.address);
            const beforeContractDaiBalance = await Dai.balanceOf(MultiRewards.address);
            const beforeAliceDaiBalance = await Dai.balanceOf(alice.address);
            const beforeBobDaiBalance = await Dai.balanceOf(bob.address);

            await MultiRewards.connect(bob).stake(tokenAmount);
            await MultiRewards.connect(bob).stake(tokenAmount);

            const duringWithdrawable = await Digits.withdrawableDividendOf(MultiRewards.address);
            const duringContractDaiBalance = await Dai.balanceOf(MultiRewards.address);
            const duringAliceDaiBalance = await Dai.balanceOf(alice.address);
            const duringBobDaiBalance = await Dai.balanceOf(bob.address);

            await makeFewTrades(1);
            // make bob have zero dai from trade and trigger dividend distribution
            await Dai.connect(bob).transfer(deployer.address, await Dai.balanceOf(bob.address));
            await Digits.connect(bob).transfer(Digits.address, 0);

            await MultiRewards.connect(alice).stake(tokenAmount);
            await MultiRewards.connect(bob).stake(tokenAmount);
            const afterContractDaiBalance = await Dai.balanceOf(MultiRewards.address);
            const afterAliceDaiBalance = await Dai.balanceOf(alice.address);
            const afterBobDaiBalance = await Dai.balanceOf(bob.address);

            const expectedWithdrawableAmount = EXPECTED_WITHDRAWABLE_AMOUNT.mul(2);
            const expectedWithdrawableAmountperUser = expectedWithdrawableAmount.div(2);

            expect(beforeWithdrawable).to.equal(expectedWithdrawableAmount);
            expect(beforeAliceDaiBalance).to.equal(0);
            expect(beforeBobDaiBalance).to.equal(0);
            expect(beforeContractDaiBalance).to.equal(tokenAmount);

            expect(duringWithdrawable).to.equal(0);
            expect(duringAliceDaiBalance).to.equal(0);
            expect(duringBobDaiBalance).to.equal(expectedWithdrawableAmountperUser);
            expect(duringContractDaiBalance).to.equal(tokenAmount.add(expectedWithdrawableAmountperUser));
            expect(duringContractDaiBalance.sub(beforeContractDaiBalance).sub(expectedWithdrawableAmountperUser)).lt(PRECISION);

            expect((afterAliceDaiBalance.sub(expectedWithdrawableAmountperUser)).mul(3).div(PRECISION)).to.equal(afterBobDaiBalance.div(PRECISION));
            expect(afterContractDaiBalance.div(PRECISION)).to.equal(tokenAmount.div(PRECISION));
            expect(afterContractDaiBalance.sub(beforeContractDaiBalance)).lt(PRECISION);
        });

        it("is not called during getReward on paused contract", async () => {
            await MultiRewards.connect(alice).stake(tokenAmount);
            await makeFewTrades(1);
            await MultiRewards.setPaused(true);

            const beforeAliceDigitsBalance = await Digits.balanceOf(alice.address);
            const beforeWithdrawable = await Digits.withdrawableDividendOf(MultiRewards.address);
            const beforeDividendTrackerDaiBalance = await Dai.balanceOf(await Digits.dividendTracker());
            const rewardRate = (await MultiRewards.rewardData(Dai.address))["rewardRate"];
            const earned = await MultiRewards.earned(alice.address, Dai.address);

            const action = MultiRewards.connect(alice).getReward();
            await expect(action).to.not.emit(MultiRewards, "ReflectionPaid");

            const afterAliceDigitsBalance = await Digits.balanceOf(alice.address);
            const afterAliceDaiBalance = await Dai.balanceOf(alice.address);
            const afterWithdrawable = await Digits.withdrawableDividendOf(MultiRewards.address);
            const afterDividendTrackerDaiBalance = await Dai.balanceOf(await Digits.dividendTracker());

            expect(beforeAliceDigitsBalance).to.equal(initialUserAmount.sub(tokenAmount));
            expect(afterAliceDigitsBalance).to.equal(beforeAliceDigitsBalance);
            expect(beforeDividendTrackerDaiBalance).to.equal(0);
            expect(afterDividendTrackerDaiBalance).to.equal(0);
            expect(beforeWithdrawable).to.equal(0);
            expect(afterWithdrawable).to.equal(0);
            expect(afterAliceDaiBalance.div(10000)).to.equal(earned.add(rewardRate).div(10000));
        });

        it("should claim proper value on withdraw", async () => {
            await MultiRewards.connect(alice).stake(tokenAmount);
            await makeFewTrades(1);
            // trigger dividend distribution
            await Digits.connect(bob).transfer(Digits.address, 0);

            const beforeWithdrawable = await Digits.withdrawableDividendOf(MultiRewards.address);
            const beforeContractDaiBalance = await Dai.balanceOf(MultiRewards.address);
            const beforeUserDaiBalance = await Dai.balanceOf(alice.address);
            const beforeUserDigitsBalance = await Digits.balanceOf(alice.address);

            await MultiRewards.connect(alice).withdraw(tokenAmount);

            const afterWithdrawable = await Digits.withdrawableDividendOf(MultiRewards.address);
            const afterContractDaiBalance = await Dai.balanceOf(MultiRewards.address);
            const afterUserDaiBalance = await Dai.balanceOf(alice.address);
            const afterUserDigitsBalance = await Digits.balanceOf(alice.address);

            expect(beforeWithdrawable).to.equal(EXPECTED_WITHDRAWABLE_AMOUNT);
            expect(beforeUserDaiBalance).to.equal(0);
            expect(beforeContractDaiBalance).to.equal(tokenAmount);
            expect(beforeUserDigitsBalance).to.equal(initialUserAmount.sub(tokenAmount));

            expect(afterWithdrawable).to.equal(0);
            expect(afterUserDaiBalance).to.equal(EXPECTED_WITHDRAWABLE_AMOUNT);
            expect(afterContractDaiBalance).to.equal(tokenAmount);
            expect(afterUserDigitsBalance).to.equal(initialUserAmount);
        });

        it("should claim proper value on withdraw updating reflection", async () => {
            await MultiRewards.connect(alice).stake(tokenAmount);
            await makeFewTrades(1);

            const beforeWithdrawable = await Digits.withdrawableDividendOf(MultiRewards.address);
            const beforeContractDaiBalance = await Dai.balanceOf(MultiRewards.address);
            const beforeUserDaiBalance = await Dai.balanceOf(alice.address);
            const beforeUserDigitsBalance = await Digits.balanceOf(alice.address);

            await MultiRewards.connect(alice).withdraw(tokenAmount);

            const afterWithdrawable = await Digits.withdrawableDividendOf(MultiRewards.address);
            const afterContractDaiBalance = await Dai.balanceOf(MultiRewards.address);
            const afterUserDaiBalance = await Dai.balanceOf(alice.address);
            const afterUserDigitsBalance = await Digits.balanceOf(alice.address);

            expect(beforeWithdrawable).to.equal(0);
            expect(beforeUserDaiBalance).to.equal(0);
            expect(beforeContractDaiBalance).to.equal(tokenAmount);
            expect(beforeUserDigitsBalance).to.equal(initialUserAmount.sub(tokenAmount));

            expect(afterWithdrawable).to.equal(0);
            expect(afterUserDaiBalance).to.equal(EXPECTED_WITHDRAWABLE_AMOUNT);
            expect(afterContractDaiBalance).to.equal(tokenAmount);
            expect(afterUserDigitsBalance).to.equal(initialUserAmount);
        });

        it("should claim proper value on getReward", async () => {
            await MultiRewards.connect(alice).stake(tokenAmount);
            await makeFewTrades(1);
            // trigger dividend distribution
            await Digits.connect(bob).transfer(Digits.address, 0);

            const beforeWithdrawable = await Digits.withdrawableDividendOf(MultiRewards.address);
            const beforeContractDaiBalance = await Dai.balanceOf(MultiRewards.address);
            const beforeUserDaiBalance = await Dai.balanceOf(alice.address);
            const beforeUserDigitsBalance = await Digits.balanceOf(alice.address);
            const rewardRate = (await MultiRewards.rewardData(Dai.address))["rewardRate"];
            const earned = await MultiRewards.earned(alice.address, Dai.address);

            await MultiRewards.connect(alice).getReward();

            const afterWithdrawable = await Digits.withdrawableDividendOf(MultiRewards.address);
            const afterContractDaiBalance = await Dai.balanceOf(MultiRewards.address);
            const afterUserDaiBalance = await Dai.balanceOf(alice.address);
            const afterUserDigitsBalance = await Digits.balanceOf(alice.address);

            expect(beforeWithdrawable).to.equal(EXPECTED_WITHDRAWABLE_AMOUNT);
            expect(beforeUserDaiBalance).to.equal(0);
            expect(beforeContractDaiBalance).to.equal(tokenAmount);
            expect(beforeUserDigitsBalance).to.equal(initialUserAmount.sub(tokenAmount));

            expect(afterWithdrawable).to.equal(0);
            expect(afterUserDaiBalance.div(PRECISION)).to.equal(earned.add(rewardRate).add(EXPECTED_WITHDRAWABLE_AMOUNT).div(PRECISION));
            expect(afterContractDaiBalance.div(PRECISION)).to.equal(tokenAmount.sub(rewardRate.mul(3)).div(PRECISION));
            expect(afterUserDigitsBalance).to.equal(beforeUserDigitsBalance);
        });

        it("should claim proper value on getReward updating reflection", async () => {
            await MultiRewards.connect(alice).stake(tokenAmount);
            await makeFewTrades(1);

            const beforeWithdrawable = await Digits.withdrawableDividendOf(MultiRewards.address);
            const beforeContractDaiBalance = await Dai.balanceOf(MultiRewards.address);
            const beforeUserDaiBalance = await Dai.balanceOf(alice.address);
            const beforeUserDigitsBalance = await Digits.balanceOf(alice.address);
            const rewardRate = (await MultiRewards.rewardData(Dai.address))["rewardRate"];
            const earned = await MultiRewards.earned(alice.address, Dai.address);

            await MultiRewards.connect(alice).getReward();

            const afterWithdrawable = await Digits.withdrawableDividendOf(MultiRewards.address);
            const afterContractDaiBalance = await Dai.balanceOf(MultiRewards.address);
            const afterUserDaiBalance = await Dai.balanceOf(alice.address);
            const afterUserDigitsBalance = await Digits.balanceOf(alice.address);

            expect(beforeWithdrawable).to.equal(0);
            expect(beforeUserDaiBalance).to.equal(0);
            expect(beforeContractDaiBalance).to.equal(tokenAmount);
            expect(beforeUserDigitsBalance).to.equal(initialUserAmount.sub(tokenAmount));

            expect(afterWithdrawable).to.equal(0);
            expect(afterUserDaiBalance.div(PRECISION)).to.equal(earned.add(EXPECTED_WITHDRAWABLE_AMOUNT).add(rewardRate).div(PRECISION));
            expect(afterContractDaiBalance.div(PRECISION)).to.equal(tokenAmount.sub(rewardRate.mul(2)).div(PRECISION));
            expect(afterUserDigitsBalance).to.equal(beforeUserDigitsBalance);
        });

        it("should claim proper value on exit", async () => {
            await MultiRewards.connect(alice).stake(tokenAmount);
            await makeFewTrades(1);
            // trigger dividend distribution
            await Digits.connect(bob).transfer(Digits.address, 0);

            const beforeWithdrawable = await Digits.withdrawableDividendOf(MultiRewards.address);
            const beforeContractDaiBalance = await Dai.balanceOf(MultiRewards.address);
            const beforeUserDaiBalance = await Dai.balanceOf(alice.address);
            const beforeUserDigitsBalance = await Digits.balanceOf(alice.address);
            const rewardRate = (await MultiRewards.rewardData(Dai.address))["rewardRate"];
            const earned = await MultiRewards.earned(alice.address, Dai.address);

            await MultiRewards.connect(alice).exit();

            const afterWithdrawable = await Digits.withdrawableDividendOf(MultiRewards.address);
            const afterContractDaiBalance = await Dai.balanceOf(MultiRewards.address);
            const afterUserDaiBalance = await Dai.balanceOf(alice.address);
            const afterUserDigitsBalance = await Digits.balanceOf(alice.address);

            expect(beforeWithdrawable).to.equal(EXPECTED_WITHDRAWABLE_AMOUNT);
            expect(beforeUserDaiBalance).to.equal(0);
            expect(beforeContractDaiBalance).to.equal(tokenAmount);
            expect(beforeUserDigitsBalance).to.equal(initialUserAmount.sub(tokenAmount));

            expect(afterWithdrawable).to.equal(0);
            expect(afterUserDaiBalance.div(PRECISION)).to.equal(earned.add(EXPECTED_WITHDRAWABLE_AMOUNT).add(rewardRate).div(PRECISION));
            expect(afterContractDaiBalance.div(PRECISION)).to.equal(tokenAmount.sub(rewardRate.mul(3)).div(PRECISION));
            expect(afterUserDigitsBalance).to.equal(initialUserAmount);
        });

        it("should claim proper value on exit updating reflection", async () => {
            await MultiRewards.connect(alice).stake(tokenAmount);
            await makeFewTrades(1);

            const beforeWithdrawable = await Digits.withdrawableDividendOf(MultiRewards.address);
            const beforeContractDaiBalance = await Dai.balanceOf(MultiRewards.address);
            const beforeUserDaiBalance = await Dai.balanceOf(alice.address);
            const beforeUserDigitsBalance = await Digits.balanceOf(alice.address);
            const rewardRate = (await MultiRewards.rewardData(Dai.address))["rewardRate"];
            const earned = await MultiRewards.earned(alice.address, Dai.address);

            await MultiRewards.connect(alice).exit();

            const afterWithdrawable = await Digits.withdrawableDividendOf(MultiRewards.address);
            const afterContractDaiBalance = await Dai.balanceOf(MultiRewards.address);
            const afterUserDaiBalance = await Dai.balanceOf(alice.address);
            const afterUserDigitsBalance = await Digits.balanceOf(alice.address);

            expect(beforeWithdrawable).to.equal(0);
            expect(beforeUserDaiBalance).to.equal(0);
            expect(beforeContractDaiBalance).to.equal(tokenAmount);
            expect(beforeUserDigitsBalance).to.equal(initialUserAmount.sub(tokenAmount));

            expect(afterWithdrawable).to.equal(0);
            expect(afterUserDaiBalance.div(PRECISION)).to.equal(earned.add(EXPECTED_WITHDRAWABLE_AMOUNT).add(rewardRate).div(PRECISION));
            expect(afterContractDaiBalance.div(PRECISION)).to.equal(tokenAmount.sub(rewardRate.mul(2)).div(PRECISION));
            expect(afterUserDigitsBalance).to.equal(initialUserAmount);
        });
    });

    describe("withdraw", () => {
        beforeEach("added rewards", async () => {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
            await MultiRewards.notifyRewardAmount(Dai.address, tokenAmount);
            await MultiRewards.connect(alice).stake(tokenAmount);
        });

        it("should check 0 amount", async () => {
            const action = MultiRewards.connect(alice).withdraw(0);
            await expect(action).to.revertedWith('Cannot withdraw 0');
        });

        it("should emit Withdrawn", async () => {
            const action = MultiRewards.connect(alice).withdraw(tokenAmount);
            await expect(action).to.emit(MultiRewards, "Withdrawn").withArgs(alice.address, tokenAmount);
        });

        it("should return staking token without claim rewards", async () => {
            const beforeTotalSupply = await MultiRewards.totalSupply();
            const beforeStakingTokenBalance = await Digits.balanceOf(alice.address);
            const beforeBalance = await MultiRewards.balanceOf(alice.address);
            await MultiRewards.connect(alice).withdraw(tokenAmount);
            const afterTotalSupply = await MultiRewards.totalSupply();
            const afterStakingTokenBalance = await Digits.balanceOf(alice.address);
            const afterBalance = await MultiRewards.balanceOf(alice.address);

            expect(beforeTotalSupply).to.be.equal(tokenAmount);
            expect(afterTotalSupply).to.be.equal(0);
            expect(afterTotalSupply).not.be.equal(beforeTotalSupply);

            expect(beforeStakingTokenBalance).to.be.equal(initialUserAmount.sub(tokenAmount));
            expect(afterStakingTokenBalance).to.be.equal(initialUserAmount);
            expect(afterStakingTokenBalance).not.be.equal(beforeStakingTokenBalance);

            expect(beforeBalance).to.be.equal(tokenAmount);
            expect(afterBalance).to.be.equal(0);
            expect(afterBalance).not.be.equal(beforeBalance);
        });
    });

    describe("exit", () => {
        beforeEach("added rewards", async () => {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
            await MultiRewards.notifyRewardAmount(Dai.address, tokenAmount);
            await MultiRewards.connect(alice).stake(tokenAmount);
        });

        it("should emit Withdrawn", async () => {
            const action = MultiRewards.connect(alice).exit();
            await expect(action).to.emit(MultiRewards, "Withdrawn").withArgs(alice.address, tokenAmount);
        });

        it("should emit RewardPaid", async () => {
            const action = MultiRewards.connect(alice).exit();
            await expect(action).to.emit(MultiRewards, "RewardPaid").withArgs(alice.address, Dai.address, "16534391534390000");
        });

        it("should return staking token with claim rewards", async () => {
            const beforeTotalSupply = await MultiRewards.totalSupply();
            const beforeStakingTokenBalance = await Digits.balanceOf(alice.address);
            const beforeBalance = await MultiRewards.balanceOf(alice.address);
            const beforeRewardTokenBalance = await Dai.balanceOf(alice.address);
            const userRewardPerTokenPaid = await MultiRewards.userRewardPerTokenPaid(alice.address, Dai.address);

            await MultiRewards.connect(alice).exit();

            const afterTotalSupply = await MultiRewards.totalSupply();
            const afterStakingTokenBalance = await Digits.balanceOf(alice.address);
            const afterBalance = await MultiRewards.balanceOf(alice.address);
            const afterRewardTokenBalance = await Dai.balanceOf(alice.address);

            const { rewardPerTokenStored } = await MultiRewards.rewardData(Dai.address);
            const rewardAmount = tokenAmount.mul(rewardPerTokenStored.sub(userRewardPerTokenPaid)).div("1000000000000000000");

            expect(beforeTotalSupply).to.be.equal(tokenAmount);
            expect(afterTotalSupply).to.be.equal(0);
            expect(afterTotalSupply).not.be.equal(beforeTotalSupply);

            expect(beforeStakingTokenBalance).to.be.equal(initialUserAmount.sub(tokenAmount));
            expect(afterStakingTokenBalance).to.be.equal(initialUserAmount);
            expect(afterStakingTokenBalance).not.be.equal(beforeStakingTokenBalance);

            expect(beforeBalance).to.be.equal(tokenAmount);
            expect(afterBalance).to.be.equal(0);
            expect(afterBalance).not.be.equal(beforeBalance);

            expect(beforeRewardTokenBalance).to.be.equal(0);
            expect(afterRewardTokenBalance).to.be.equal(rewardAmount);
            expect(afterRewardTokenBalance).not.be.equal(beforeRewardTokenBalance);
        });
    });

    describe("getReward", () => {
        beforeEach("added rewards", async () => {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
            await MultiRewards.notifyRewardAmount(Dai.address, tokenAmount);
            await MultiRewards.connect(alice).stake(tokenAmount);
        });

        it("should emit RewardPaid", async () => {
            const action = MultiRewards.connect(alice).getReward();
            await expect(action).to.emit(MultiRewards, "RewardPaid").withArgs(alice.address, Dai.address, "16534391534390000");
        });

        it("should return rewards", async () => {
            const beforeRewardTokenBalance = await Dai.balanceOf(alice.address);
            const userRewardPerTokenPaid = await MultiRewards.userRewardPerTokenPaid(alice.address, Dai.address);

            await MultiRewards.connect(alice).getReward();

            const afterRewardTokenBalance = await Dai.balanceOf(alice.address);

            const { rewardPerTokenStored } = await MultiRewards.rewardData(Dai.address);
            const rewardAmount = tokenAmount.mul(rewardPerTokenStored.sub(userRewardPerTokenPaid)).div("1000000000000000000");

            expect(beforeRewardTokenBalance).to.be.equal(0);
            expect(afterRewardTokenBalance).to.be.equal(rewardAmount);
            expect(afterRewardTokenBalance).not.be.equal(beforeRewardTokenBalance);
        });
    });

    describe("rewardPerToken", () => {
        beforeEach("added rewards", async () => {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
            await MultiRewards.notifyRewardAmount(Dai.address, tokenAmount);
        });

        it("should return rewardPerToken", async () => {
            const { rewardPerTokenStored } = await MultiRewards.rewardData(Dai.address);
            const rewardPerToken = await MultiRewards.rewardPerToken(Dai.address);
            expect(rewardPerToken).to.be.equal(rewardPerTokenStored);
        });
    });

    describe("getRewardForDuration", () => {
        beforeEach("added rewards", async () => {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
            await MultiRewards.notifyRewardAmount(Dai.address, tokenAmount);
        });

        it("should return rewardPerToken", async () => {
            const { rewardRate } = await MultiRewards.rewardData(Dai.address);
            const rfd = rewardRate.mul(rewardsDuration);
            const getRewardForDuration = await MultiRewards.getRewardForDuration(Dai.address);
            expect(getRewardForDuration).to.be.equal(rfd);
        });
    });

    describe("earned", () => {
        beforeEach("added rewards", async () => {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
            await MultiRewards.notifyRewardAmount(Dai.address, tokenAmount);
        });

        it('should return rewards list', async () => {
            const claimableRewards = await MultiRewards.earned(alice.address, Dai.address);
            expect(claimableRewards).to.be.equal(getBigNumber(0));
        });
    });

    describe("dividendsEarned", () => {
        beforeEach("added rewards", async () => {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
            await MultiRewards.notifyRewardAmount(Dai.address, tokenAmount);
        });

        it('should return zero on empty', async () => {
            const claimableDividendsAlice = await MultiRewards.dividendsEarned(alice.address);
            expect(claimableDividendsAlice).to.be.equal(getBigNumber(0));
        });

        it('should return zero on just staked', async () => {
            await MultiRewards.connect(alice).stake(tokenAmount);
            const claimableDividendsAlice = await MultiRewards.dividendsEarned(alice.address);
            expect(claimableDividendsAlice).to.be.equal(getBigNumber(0));
        });

        it('should return dividend earned', async () => {
            await MultiRewards.connect(alice).stake(tokenAmount);
            await makeFewTrades(1);
            await MultiRewards.connect(bob).stake(tokenAmount);
            const claimableDividendsAlice = await MultiRewards.dividendsEarned(alice.address);
            const claimableDividendsBob = await MultiRewards.dividendsEarned(bob.address);
            expect(claimableDividendsAlice).to.be.equal(EXPECTED_WITHDRAWABLE_AMOUNT);
            expect(claimableDividendsBob).to.be.equal(0);

        });
    });
});