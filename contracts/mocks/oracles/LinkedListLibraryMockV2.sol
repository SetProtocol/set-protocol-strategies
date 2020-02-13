/*
    Copyright 2019 Set Labs Inc.

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

import { LinkedListLibraryV2 } from "set-protocol-oracles/contracts/meta-oracles/lib/LinkedListLibraryV2.sol";

/**
 * @title LinkedListLibraryMock
 * @author Set Protocol
 *
 * Mock contract for interacting with LinkedListLibrary
 */
contract LinkedListLibraryMockV2
{
    using LinkedListLibraryV2 for LinkedListLibraryV2.LinkedList;

    /* ============ State Variables ============ */

    LinkedListLibraryV2.LinkedList private linkedList;

    /* ============ Public Function ============ */

    function initializeMock(
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

    function editListMock(
        uint256 _addedValue
    )
        public
    {
        linkedList.editList(
            _addedValue
        );
    }

    function addNodeMock(
        uint256 _addedValue
    )
        public
    {
        linkedList.addNode(
            _addedValue
        );
    }

    function updateNodeMock(
        uint256 _addedValue
    )
        public
    {
        linkedList.updateNode(
            _addedValue
        );
    }

    function readListMock(
        uint256 _dataPoints
    )
        public
        returns (uint256[] memory)
    {
        return linkedList.readList(
            _dataPoints
        );
    }

    function addBadValue(
        uint256 _badValue
    )
        public
    {
        linkedList.dataArray.push(_badValue);
    }

    /* ============ Getters ============ */

    function getDataSizeLimit()
        public
        view
        returns (uint256)
    {
        return linkedList.dataSizeLimit;
    }

    function getLastUpdatedIndex()
        public
        view
        returns (uint256)
    {
        return linkedList.lastUpdatedIndex;
    }

    function getDataArray()
        public
        view
        returns (uint256[] memory)
    {
        return linkedList.dataArray;
    }
}