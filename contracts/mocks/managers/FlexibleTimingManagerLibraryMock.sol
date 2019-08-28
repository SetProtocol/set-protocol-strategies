pragma solidity 0.5.7;
pragma experimental "ABIEncoderV2";

import { FlexibleTimingManagerLibrary } from "../../managers/lib/FlexibleTimingManagerLibrary.sol";

// Mock contract implementation of FlexibleTimingManagerLibrary functions
contract FlexibleTimingManagerLibraryMock {
    function calculateAuctionPriceParameters(
        uint256 _currentSetDollarAmount,
        uint256 _nextSetDollarAmount,
        uint256 _timeIncrements,
        uint256 _auctionLibraryPriceDivisor,
        uint256 _auctionTimeToPivot
    )
        external
        returns (uint256, uint256)
    {
        return FlexibleTimingManagerLibrary.calculateAuctionPriceParameters(
            _currentSetDollarAmount,
            _nextSetDollarAmount,
            _timeIncrements,
            _auctionLibraryPriceDivisor,
            _auctionTimeToPivot
        );
    }

    function calculateSetTokenDollarValue(
        uint256[] calldata _tokenPrices,
        uint256 _naturalUnit,
        uint256[] calldata _units,
        uint256[] calldata _tokenDecimals
    )
        external
        returns (uint256)
    {
        return FlexibleTimingManagerLibrary.calculateSetTokenDollarValue(
            _tokenPrices,
            _naturalUnit,
            _units,
            _tokenDecimals
        );
    }
}
