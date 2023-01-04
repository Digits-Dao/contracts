import * as hre from "hardhat";
import { ethers } from "hardhat";

const addresses = {
  goerli: {
    dai: "0xdc31Ee1784292379Fbb2964b3B9C4124D8F89C60",
    suhi_router: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506"
  }
}

// Enter manually
const digitsAddress = "0x9BDfD637f171C85A16f4066B2730EF026ca25046";
const dividendTrackerAddress = "0xD980b1c800cB849e20EF1A638A3d8e82657D90de";
const TokenStorageAddress = "0xE0F10a6Dc17efba30D64792736Db79c7De12Ac3B";
const multiRewardsAddress = "0xCE22c3e95B5E118ea61C4fb9357Fe45Cbb34cb56";

async function main() {
  const accounts = await ethers.getSigners();

  await hre.run("verify:verify", {
    address: digitsAddress,
    constructorArguments: [
      addresses[hre.network.name]["dai"],
      addresses[hre.network.name]["suhi_router"],
      accounts[0].address,
      [accounts[0].address]
    ],
  });

  console.log(`Digits verified`);

  await hre.run("verify:verify", {
    address: dividendTrackerAddress,
    constructorArguments: [
      addresses[hre.network.name]["dai"],
      digitsAddress,
      addresses[hre.network.name]["suhi_router"]
    ],
  });

  console.log(`DividendTracker verified`);

  await hre.run("verify:verify", {
    address: TokenStorageAddress,
    constructorArguments: [
      addresses[hre.network.name]["dai"],
      digitsAddress,
      accounts[0].address,
      dividendTrackerAddress,
      addresses[hre.network.name]["suhi_router"]
    ],
  });

  console.log(`TokenStorage verified`);

  await hre.run("verify:verify", {
    address: multiRewardsAddress,
    constructorArguments: [
      accounts[0].address,
      digitsAddress,
      addresses[hre.network.name]["dai"]
    ],
  });

  console.log(`MultiRewards verified`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});