/*
    Copyright 2018 Set Labs Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/

pragma solidity 0.5.7;
pragma experimental "ABIEncoderV2";

import { LinkedListLibrary } from "../meta-oracles/lib/LinkedListLibrary.sol";

/**
 * @title LinkedListLibraryMock
 * @author Set Protocol
 *
 * Mock contract for interacting with LinkedListLibrary
 */
contract LinkedListLibraryMock {

    using LinkedListLibrary for LinkedListLibrary.LinkedList;

    /* ============ State Variables ============ */

    LinkedListLibrary.LinkedList private linkedList;

    /* ============ Public Function ============ */

    function initialize(
        uint256 _dataSizeLimit,
        uint256 _initialValue
    )
        public
    {
        linkedList.initialize(
            _dataSizeLimit,
            _initialValue
        );
    }

    function editList(
        uint256 _addedValue
    )
        public
    {
        linkedList.editList(
            _addedValue
        );
    }

    function addNode(
        uint256 _addedValue
    )
        public
    {
        linkedList.addNode(
            _addedValue
        );
    }

    function updateNode(
        uint256 _addedValue
    )
        public
    {
        linkedList.updateNode(
            _addedValue
        );
    }   


    /* ============ Getters ============ */

    function getDataSizeLimit()
        public
        returns (uint256)
    {
        return linkedList.dataSizeLimit;
    }

    function getLastUpdatedIndex()
        public
        returns (uint256)
    {
        return linkedList.lastUpdatedIndex;
    }

    function getDataArray()
        public
        returns (uint256[] memory)
    {
        return linkedList.dataArray;
    }

    function getNodeLink(
        uint256 _index
    )
        public
        returns (uint256)
    {
        return linkedList.links[_index];
    }
}