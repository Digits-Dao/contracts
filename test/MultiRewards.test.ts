import { ethers, network } from "hardhat";
import { MultiRewards, Digits, IERC20 } from "../typechain-types";
import { expect } from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { getBigNumber } from "../utils";
import { constants } from "ethers";

describe("MultiRewards", function () {
    let MultiRewards: MultiRewards;
    let deployer: SignerWithAddress;
    let alice: SignerWithAddress;
    let bob: SignerWithAddress;
    let Digits: Digits;
    let snapshotId: string;
    let Dai: IERC20;
    const tokenAmount = getBigNumber(10_000);
    const rewardsDuration = 86400 * 7;
    const DAI = "0x6B175474E89094C44Da98b954EedeAC495271d0F"
    const SUSHI_ROUTER = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F"
    const DAI_WHALE = "0xF977814e90dA44bFA03b6295A0616a897441aceC"

    before(async () => {
        [deployer, alice, bob] = await ethers.getSigners();

        Dai = await ethers.getContractAt(
            "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", DAI) as IERC20;

        // send dai to deployer
        const daiWhale = await ethers.getImpersonatedSigner(DAI_WHALE);
        await Dai.connect(daiWhale).transfer(deployer.address, tokenAmount)

        // deploy digits
        const digitsFactory = await ethers.getContractFactory("Digits");
        Digits = (await digitsFactory.deploy(Dai.address, SUSHI_ROUTER, deployer.address, [deployer.address])) as Digits;

        // deploy MultiRewards
        const contractFactory = await ethers.getContractFactory("MultiRewards");
        MultiRewards = (await contractFactory.deploy(deployer.address, Digits.address, Dai.address)) as MultiRewards;

        // digits related management
        await Digits.openTrading();
        await Digits.excludeFromFees(MultiRewards.address, true);
        await Digits.excludeFromMaxTx(MultiRewards.address, true);
        await Digits.excludeFromMaxWallet(MultiRewards.address, true);
        await Digits.setSwapEnabled(false);
        await Digits.transfer(alice.address, tokenAmount);
        await Digits.connect(alice).approve(MultiRewards.address, constants.MaxUint256);
        await Dai.approve(MultiRewards.address, constants.MaxUint256);

        snapshotId = await ethers.provider.send("evm_snapshot", []);
    });

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

        it("should not add reward if duration is not zero", async function () {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
            const action = MultiRewards.addReward(Dai.address, deployer.address, 10_000);
            await expect(action).to.be.reverted;
        });
    });

    describe("lastTimeRewardApplicable", () => {
        beforeEach("added token", async () => {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
        });

        it("should return zero just after addeing reward", async () => {
            const lastTimeRewardApplicable = await MultiRewards.lastTimeRewardApplicable(Dai.address);
            expect(lastTimeRewardApplicable).to.be.equal(0);
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

    describe("notifyReward", () => {
        beforeEach("added token", async () => {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
        });

        it("should add reward for token", async () => {
            const beforeOwnerBalance = await Dai.balanceOf(deployer.address);
            await MultiRewards.notifyRewardAmount(Dai.address, tokenAmount);
            const afterOwnerBalance = await Dai.balanceOf(deployer.address);
            const { rewardsDuration, periodFinish, rewardRate, lastUpdateTime, rewardPerTokenStored } = await MultiRewards.rewardData(Dai.address);
            const currentBlock = await ethers.provider.getBlockNumber();
            const blockTime = (await ethers.provider.getBlock(currentBlock)).timestamp;

            expect(beforeOwnerBalance).to.be.equal(tokenAmount);
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
    });

    describe("setRewardDuration", () => {
        // beforeEach("added token", async () => {
        //     await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
        // });

        // it("should update rewardRate", async () => {
        //     await MultiRewards.setRewardRate(Dai.address, 10);

        //     const { rewardRate, lastUpdateTime, rewardPerTokenStored } = await MultiRewards.rewardData(Dai.address);
        //     const currentBlock = await ethers.provider.getBlockNumber();
        //     const blockTime = (await ethers.provider.getBlock(currentBlock)).timestamp;

        //     expect(rewardPerTokenStored).to.be.equal(0);
        //     expect(lastUpdateTime).to.be.equal(blockTime);
        //     expect(rewardRate).to.be.equal(10);
        // });

        // it("should emit RateChanged event", async () => {
        //     const action = MultiRewards.setRewardRate(Dai.address, 10);
        //     await expect(action).to.emit(MultiRewards, 'RateChanged').withArgs(Dai.address, 0, 10);
        // });

        // it("should execute only by the owner", async function () {
        //     const action = MultiRewards.connect(alice).setRewardRate(Dai.address, 10);
        //     await expect(action).to.revertedWith('Ownable: caller is not the owner');
        // });

        // TODO: implement
    });

    describe("setRewardDistributor", () => { /* TODO: implement */ });

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

            expect(beforeOwnerBalance).to.be.equal(0);
            expect(afterOwnerBalance).to.be.equal(tokenAmount);
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

            expect(beforeOwnerBalance).to.be.equal(0);
            expect(afterOwnerBalance).to.be.equal(tokenAmount);
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
        // TODO: multiuser tests
        it("should emit Staked", async () => {
            const action = MultiRewards.connect(alice).stake(tokenAmount);
            await expect(action).to.emit(MultiRewards, "Staked").withArgs(alice.address, tokenAmount);
        });

        it("should check 0 amount", async () => {
            const action = MultiRewards.connect(alice).stake(0);
            await expect(action).to.revertedWith('Cannot stake 0');
        });

        it("should stake", async () => {
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

            expect(beforeAliceStakingTokenBalance).to.be.equal(tokenAmount);
            expect(afterAliceStakingTokenBalance).to.be.equal(beforeAliceStakingTokenBalance.sub(tokenAmount));
            expect(afterAliceStakingTokenBalance).not.be.equal(beforeAliceStakingTokenBalance);

            expect(beforeContractBalance).to.be.equal(0);
            expect(afterContractBalance).to.be.equal(beforeContractBalance.add(tokenAmount));
            expect(afterContractBalance).not.be.equal(beforeContractBalance);

            const balance = await MultiRewards.balanceOf(alice.address);
            expect(balance).to.be.equal(tokenAmount);
        });
    });

    describe("withdraw", () => {
        // TODO: multiuser tests
        beforeEach("added token", async () => {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
        });

        beforeEach("added rewards", async () => {
            await MultiRewards.notifyRewardAmount(Dai.address, tokenAmount);
        });

        beforeEach("stake token", async () => {
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

            expect(beforeStakingTokenBalance).to.be.equal(0);
            expect(afterStakingTokenBalance).to.be.equal(tokenAmount);
            expect(afterStakingTokenBalance).not.be.equal(beforeStakingTokenBalance);

            expect(beforeBalance).to.be.equal(tokenAmount);
            expect(afterBalance).to.be.equal(0);
            expect(afterBalance).not.be.equal(beforeBalance);
        });
    });

    describe("exit", () => {
        // TODO: add tests for multiple rewards
        // TODO: multiuser tests, finish period tests etc.
        beforeEach("added token", async () => {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
        });

        beforeEach("added rewards", async () => {
            await MultiRewards.notifyRewardAmount(Dai.address, tokenAmount);
        });

        beforeEach("stake token", async () => {
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

            expect(beforeStakingTokenBalance).to.be.equal(0);
            expect(afterStakingTokenBalance).to.be.equal(tokenAmount);
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
        // TODO: add tests for multiple rewards
        // TODO: multiuser tests, finish period tests etc.
        beforeEach("added token", async () => {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
        });

        beforeEach("added rewards", async () => {
            await MultiRewards.notifyRewardAmount(Dai.address, tokenAmount);
        });

        beforeEach("stake token", async () => {
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
        beforeEach("added token", async () => {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
        });

        beforeEach("added rewards", async () => {
            await MultiRewards.notifyRewardAmount(Dai.address, tokenAmount);
        });

        it("should return rewardPerToken", async () => {
            const { rewardPerTokenStored } = await MultiRewards.rewardData(Dai.address);
            const rewardPerToken = await MultiRewards.rewardPerToken(Dai.address);
            expect(rewardPerToken).to.be.equal(rewardPerTokenStored);
        });
        // Add test with blokc in the future
    });

    describe("getRewardForDuration", () => {
        beforeEach("added token", async () => {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
        });

        beforeEach("added rewards", async () => {
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
        beforeEach("added token", async () => {
            await MultiRewards.addReward(Dai.address, deployer.address, rewardsDuration);
        });

        beforeEach("added rewards", async () => {
            await MultiRewards.notifyRewardAmount(Dai.address, tokenAmount);
        });

        it('should return rewards list', async () => {
            const claimableRewards = await MultiRewards.earned(alice.address, Dai.address);
            expect(claimableRewards).to.be.equal(getBigNumber(0));
        });
        // Add test checking after passing some time
    });
});