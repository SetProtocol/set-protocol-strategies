pragma solidity 0.5.7;


contract HelloWorld {
    function renderHelloWorld ()
        public
        pure
        returns (string memory) {
        return "Hello World";
    }
}
