module.exports = {
  port: 8555,
  testrpcOptions: "--db blockchain --networkId 50 --port 8555 --accounts 20 -e 1000000 -m 'concert load couple harbor equip island argue ramp clarify fence smart topic'",
  testCommand: "node --max-old-space-size=4096 ../node_modules/.bin/truffle test `find ./transpiled/test/contracts -name '*.spec.js'` --network coverage",
  copyPackages: ['openzeppelin-solidity', 'set-protocol-contracts'],
  skipFiles: [
    'Migrations.sol',
    'mocks',
    'external',
    'managers/lib/UintArrayUtilsLibrary.sol',
    'meta-oracles/lib/LinkedListLibraryV2.sol', // There are issues with testing of LinkedListLibrary
    'meta-oracles/lib/LinkedListLibraryV3.sol', // There are issues with testing of LinkedListLibrary
  ],
};
