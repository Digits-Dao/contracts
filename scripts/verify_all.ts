import * as hre from "hardhat";
import { ethers } from "hardhat";

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
  },
}

// Enter manually
const digitsAddress = "";
const dividendTrackerAddress = "";
const TokenStorageAddress = "";
const multiRewardsAddress = "";

async function main() {
  const accounts = await ethers.getSigners();

  await hre.run("verify:verify", {
    address: digitsAddress,
    constructorArguments: [
      addresses[hre.network.name]["dai"],
      addresses[hre.network.name]["uni_router"],
      accounts[0].address,
      [accounts[0].address, addresses[hre.network.name]["disperse"]]
    ],
  });

  console.log(`Digits verified`);

  await hre.run("verify:verify", {
    address: dividendTrackerAddress,
    constructorArguments: [
      addresses[hre.network.name]["dai"],
      digitsAddress,
      addresses[hre.network.name]["uni_router"]
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
      addresses[hre.network.name]["uni_router"]
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