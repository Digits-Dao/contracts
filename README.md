# DigitsDao Protocol contracts

[DigitsDao](https://www.digitsdao.finance)

This repository contains the contracts of DigitsDAO Protocol.

MultiRewards.sol contract is a fork of [Curve's Finance MultiRewards contract](https://github.com/curvefi/multi-rewards/blob/master/contracts/MultiRewards.sol).

## Deployment addresses

In this section deployment addresses will be posted (on Ethereum mainnet):

- `Digits.sol` - [etherscan]().
- `DividendTracker.sol` - [etherscan]().
- `TokenStorage.sol` - [etherscan]().
- `MultiRewards.sol` - [etherscan]().

## Migration to Ethereum

Digits DAO is migrating to Ethereum. 
Holders snapshot was done on block `24750350`, on Avalanche c-chain.

In `/data` folder exist snapshot files:
- `snapshot_raw.json` - snapshot data generated with a script `/scripts/snapshot.ts`.
- `snapshot_contracts.json` - contracts and treasury data from `/data/snapshot_raw.json`.
- `snapshot_raw.json` - final snapshot without contracts and treasury data used in `/scripts/distribute.ts`.

Contracts data may be used in the future to airdrop additional DIGITS, circa ~4mm DIGITS is locked in the contracts currently.

## Development

```sh
$ yarn
```

Compile hardhat components:

```sh
$ yarn compile
```

Run tests:

```sh
$ yarn test
```