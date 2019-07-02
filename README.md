<p align="center"><img src="https://s3-us-west-1.amazonaws.com/set-protocol/set-logo.svg" width="64" /></p>

<p align="center">
  <a href="https://circleci.com/gh/SetProtocol/set-protocol-strategies/tree/master">
    <img src="https://img.shields.io/circleci/project/github/SetProtocol/set-protocol-strategies/master.svg" />
  </a>
  <a href='https://coveralls.io/github/SetProtocol/set-protocol-strategies'>
    <img src='https://coveralls.io/repos/github/SetProtocol/set-protocol-strategies/badge.svg?branch=master' alt='Coverage Status' />
  </a>
  <a href='https://github.com/SetProtocol/set-protocol-contracts/blob/master/LICENSE'>
    <img src='https://img.shields.io/github/license/SetProtocol/set-protocol-strategies.svg' alt='License' />
  </a>
  <a href='https://www.npmjs.com/package/set-protocol-strategies'>
    <img src='https://img.shields.io/npm/v/set-protocol-strategies.svg' alt='NPM' />
  </a>
</p>

# Set Protocol Strategies

This repository contains smart contracts that implement portfolio management strategies as managers, as specified in the [Smart Contract Managed Rebalancing Sets Whitepaper](https://www.setprotocol.com/pdf/managed_sets_whitepaper.pdf). We use [Truffle](https://github.com/trufflesuite/truffle) as a development environment for compiling, testing, and deploying our contracts.


## Testing
0. Docker Set up
Firstly, you need to install Docker. The easiest way is to follow the Instructions on https://docs.docker.com/install/#supported-platforms

You need to pull the docker image that you want to use by using the following command:

```
docker pull ethereum/solc:0.5.7
```

If you wish not to set up docker, you can turn off the `docker: true` flag in truffle.js

1. Run yarn install
```
yarn install
```

2. Run an ethereum chain on a separate terminal window
```
yarn chain
```

3. Run unit tests
```
yarn test
```
