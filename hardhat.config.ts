import { task } from "hardhat/config";
import "@nomiclabs/hardhat-waffle";
import '@typechain/hardhat';
import '@nomiclabs/hardhat-ethers';
import "hardhat-etherscan-abi";
import * as dotenv from 'dotenv'
dotenv.config()

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
      forking: {
        url: `https://eth-mainnet.g.alchemy.com/v2/${process.env.MAINNET_ALCHEMY_KEY}`,
        blockNumber: 15476666
      }
    },
  },
  etherscan: {
    apiKey: process.env.MAINNET_ETHERSCAN_KEY
  },
  solidity: {
    compilers: [
      { version: "0.6.2" },
      { version: "0.5.17" },
      { version: "0.7.5" },
      { version: "0.8.0" },
      { version: "0.8.10" },
    ]
  },
  settings: {
    optimizer: {
      enabled: true,
      runs: 500
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  mocha: {
    timeout: 200000
  },
  typechain: {
    target: 'ethers-v5',
    alwaysGenerateOverloads: false,
  }
};
