import * as hre from "hardhat";
import { ethers } from "hardhat";
import { BigNumber } from "ethers";
import { Digits } from "../typechain-types";
import disperseAbi from '../data/disperse.abi.json';
import snapshotData from '../data/snapshot.json';
import snapshotContractsData from '../data/snapshot_contracts.json';
import snapshotRawData from '../data/snapshot_raw.json';

// Enter manually
const addresses = {
    goerli: {
        disperse: "0xD152f549545093347A162Dce210e7293f1452150",
        digits: ""    // Enter manually
    },
    mainnet: {
        disperse: "0xD152f549545093347A162Dce210e7293f1452150",
        digits: ""    // Enter manually
    }
}

const holders: string[] = new Array<string>();
const amounts: BigNumber[] = new Array<BigNumber>();
const INCREMENT = 210;
const GAS_PRICE = 16_000_000_000;  // 16 gwei
const GAS_LIMIT = 16_000_000;
const STUCK = false;    // Set true when stuck

async function main() {
    console.log("Load snapshot data...");

    // Sanity check
    var rawSum = BigNumber.from(0);
    snapshotRawData.forEach(element => {
        var bign = BigNumber.from(element.amount)
        if (bign.gt(BigNumber.from(0))) {
            rawSum = rawSum.add(bign);
        }
    });

    console.log("snapshot_raw.json sum: ", rawSum.toString());

    var sum = BigNumber.from(0);
    snapshotData.forEach(element => {
        var bign = BigNumber.from(element.amount)
        if (bign.gt(BigNumber.from(0))) {
            holders.push(element.account);
            amounts.push(bign);
            sum = sum.add(bign);
        }
    });

    snapshotContractsData.forEach(element => {
        var bign = BigNumber.from(element.amount)
        sum = sum.add(bign);
    });

    console.log("snapshot.json and snapshot_contracts sum: ", sum.toString());

    if (!sum.eq(rawSum)) throw new Error("Snapshot raw sum doesn't equal snapshot.json and snapshot_contracts.json sumś");
    else console.log("snapshot_raw.json divided correctly");

    console.log("Snapshot data loaded");
    console.log(`${holders.length} eligible addresses`);

    const accounts = await ethers.getSigners();

    console.log("Get Digits contract");

    const digits = await ethers.getContractAt(
        "Digits", addresses[hre.network.name]["digits"]) as Digits;

    console.log("Get Disperse.app contract");

    const disperse = await ethers.getContractAt(disperseAbi, addresses[hre.network.name]["disperse"], accounts[0]);

    console.log("Approve DIGITS for Disperse.app");

    if (!STUCK) {
        await digits.approve(disperse.address, await digits.totalSupply());
        await digits.excludeFromFees(disperse.address, true);
        await digits.excludeFromMaxTx(disperse.address, true);
        await digits.excludeFromMaxWallet(disperse.address, true);
        await digits.excludeFromDividends(disperse.address, true);
    }

    console.log("Distribute tokens...");

    console.log(holders[0], holders[holders.length - 1]);

    var newNonce = 189;
    for (var i = 0; i < holders.length; i += INCREMENT) {
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
        await tx.wait();
        console.log("Batch done")
    }

    console.log(`Distributing done, updating DIGITS`);

    await digits.setSwapEnabled(true);

    console.log(`All done`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});