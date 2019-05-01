pragma solidity 0.5.4;


contract HelloWorld {
    function renderHelloWorld ()
        public
        pure
        returns (string memory) {
        return "Hello World";
    }
}
