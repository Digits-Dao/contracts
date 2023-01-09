import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { Digits } from "../typechain-types";
var fs = require('fs');

// Avalanche C-Chain snapshot
const digitsAddress = "0x18e2269f98db2eda3cfc06e6cca384b291e553d9";
const fromBlock = 10668334;     // Digits creation block
const toBlock = 24559303;       // Snapshot block
const INCREMENT = 2000;         // Max events per node call

type HolderInfo = {
    account: string,
    amount: BigNumber,
}

type HolderInfoFormatted = {
    account: string,
    amount: string,
}

const balances = new Map<string, BigNumber>();
const holderInfo: HolderInfo[] = new Array<HolderInfo>();
const holderInfoFormatted: HolderInfoFormatted[] = new Array<HolderInfoFormatted>();

function processEvents(events) {
    events.forEach(element => {
        const from = element.args.from;
        const to = element.args.to;
        var fromValue: BigNumber;
        var toValue: BigNumber;

        if (balances[from] === undefined) fromValue = BigNumber.from(0);
        else fromValue = balances[from];
        if (balances[to] === undefined) toValue = BigNumber.from(0);
        else toValue = balances[to];

        balances[from] = fromValue.sub(element.args.value);
        balances[to] = toValue.add(element.args.value);
    });
}

async function main() {

    console.log("Get digits contract");

    const digits = await ethers.getContractAt(
        "Digits", digitsAddress) as Digits;

    console.log("Create filter");

    const filter = digits.filters.Transfer();

    console.log("Process events");

    try {
        for (var i = fromBlock; i < toBlock; i = i + INCREMENT + 1) {
            console.log(i, "/", toBlock, balances.keys.length);
            var end = i + INCREMENT;
            if (end >= toBlock) end = toBlock;
            const events = await digits.queryFilter(filter, i, end);
            processEvents(events);
        }
        console.log("Events processed");
    } catch (e) {
        console.log(e.message);
        throw e;
    } finally {
        console.log("Saving JSON...");

        for (let key in balances) {
            let info = { account: key, amount: balances[key] };
            holderInfo.push(info);
        }

        holderInfo.sort((a, b) => {
            if (a.amount.lt(b.amount)) return -1;
            else if (b.amount.lt(a.amount)) return 1;
            else return 0;
        })

        holderInfo.forEach(element => {
            holderInfoFormatted.push({ account: element.account, amount: element.amount.toString() })
        })

        const json = JSON.stringify(holderInfoFormatted);
        await fs.writeFile('data/snapshot.json', json, 'utf8', () => {
            console.log("JSON saved");
        });
    }

    console.log(`Done`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});