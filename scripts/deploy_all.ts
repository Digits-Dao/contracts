import * as hre from "hardhat";
import { ethers } from "hardhat";
import { Digits, TokenStorage, MultiRewards } from "../typechain-types";
import { getBigNumber } from "../utils";

const addresses = {
  goerli: {
    dai: "0xdc31Ee1784292379Fbb2964b3B9C4124D8F89C60",
    uni_router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    disperse: "0xD152f549545093347A162Dce210e7293f1452150"
  },
  mainnet: {
    dai: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    uni_router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    disperse: "0xD152f549545093347A162Dce210e7293f1452150"
  }
}

async function main() {
  const accounts = await ethers.getSigners();

  console.log(`Deploying Digits...`);

  // Deploy Digits
  const digitsFactory = await ethers.getContractFactory("Digits");
  const digits = (await digitsFactory.deploy(
    addresses[hre.network.name]["dai"],
    addresses[hre.network.name]["uni_router"],
    accounts[0].address, [accounts[0].address, addresses[hre.network.name]["disperse"]])) as Digits;

  await digits.deployed();

  // Update settings
  await digits.updateDividendSettings(false, getBigNumber(100_000), true);

  console.log(`Digits deployed to ${digits.address}`);

  const dividendTrackerAddress = await digits.dividendTracker();

  console.log(`DividendTracker deployed to ${dividendTrackerAddress}`);

  // Deploy TokenStorage
  const tokenStorageFactory = await ethers.getContractFactory("TokenStorage");

  const tokenStorage = (await tokenStorageFactory.deploy(
    addresses[hre.network.name]["dai"],
    digits.address,
    accounts[0].address,
    dividendTrackerAddress,
    addresses[hre.network.name]["uni_router"])) as TokenStorage;

  await tokenStorage.deployed();

  console.log(`TokenStorage deployed to ${tokenStorage.address}`);

  // Connect TokenStorage with Digits
  await tokenStorage.addManager(digits.address);
  await digits.setTokenStorage(tokenStorage.address);

  // Deploy MultiRewards
  const multiRewardsFactory = await ethers.getContractFactory("MultiRewards");
  const multiRewards = (await multiRewardsFactory.deploy(
    accounts[0].address,
    digits.address,
    addresses[hre.network.name]["dai"])) as MultiRewards;

  await multiRewards.deployed();

  // Connect Multirewards with Digits
  await digits.excludeFromFees(multiRewards.address, true);
  await digits.excludeFromMaxTx(multiRewards.address, true);
  await digits.excludeFromMaxWallet(multiRewards.address, true);
  await digits.setMultiRewardsAddress(multiRewards.address);

  console.log(`MultiRewards deployed to ${multiRewards.address}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});