import * as hre from "hardhat";
import { ethers } from "hardhat";
import { BigNumber } from "ethers";
import { Digits } from "../typechain-types";
import disperseAbi from '../data/disperse.abi.json';
import snapshotData from '../data/snapshot.json';
import { getBigNumber } from "../utils";

// Enter manually
const addresses = {
    goerli: {
        disperse: "0xD152f549545093347A162Dce210e7293f1452150",
        digits: "0xBf6750Ea6CA706A4C89940FF1AbAC51AfceB4031"
    },
    mainnet: {
        disperse: "0xD152f549545093347A162Dce210e7293f1452150",
        digits: ""  // Enter manually
    }
}
const holders: string[] = new Array<string>();
const amounts: BigNumber[] = new Array<BigNumber>();
const sum = BigNumber.from(0);
const INCREMENT = 300;
const GAS_PRICE = 16_000_000_000;  // 16 gwei
const GAS_LIMIT = 30_000_000;

async function main() {
    console.log("Load snapshot data...");

    snapshotData.forEach(element => {
        var bign = BigNumber.from(element.amount)
        sum.add(bign);
        if (bign.gt(BigNumber.from(0))) {
            holders.push(element.account);
            amounts.push(bign);
        }
    });

    // Sanity check
    console.log("Sum should be 0:", sum);
    if (!sum.eq(BigNumber.from(0))) throw new Error("Snapshot malcostructed");

    console.log("Snapshot data loaded");
    console.log(`${holders.length} eligible addresses`);

    const accounts = await ethers.getSigners();

    console.log("Get Digits contract");

    const digits = await ethers.getContractAt(
        "Digits", addresses[hre.network.name]["digits"]) as Digits;

    console.log("Get Disperse.app contract");

    const disperse = await ethers.getContractAt(disperseAbi, addresses[hre.network.name]["disperse"], accounts[0]);

    console.log("Approve DIGITS for Disperse.app");

    await digits.approve(disperse.address, await digits.totalSupply());
    await digits.excludeFromFees(disperse.address, true);
    await digits.excludeFromMaxTx(disperse.address, true);
    await digits.excludeFromMaxWallet(disperse.address, true);
    await digits.excludeFromDividends(disperse.address, true);

    console.log("Distribute tokens...");

    console.log(holders[0], holders[holders.length - 1]);

    var newNonce = 189;
    for (var i = 0; i < 1; i += INCREMENT) {
        var batch = i + INCREMENT;
        if (batch > holders.length) {
            batch = holders.length;
        }

        console.log(`Distributing ${i} to ${batch} tokens`);

        const tx = await disperse.disperseToken(digits.address, holders.slice(i, batch), amounts.slice(i, batch), {
            // nonce: newNonce, // Uncomment when stuck
            // gasPrice: GAS_PRICE, // Uncomment when stuck
            gasLimit: GAS_LIMIT
        });

        newNonce += 1;

        console.log("Tx hash:", tx.hash);
    }

    console.log(`Distributing done`);

    await digits.updateDividendSettings(false, getBigNumber(100_000), true);

    console.log(`All done`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});