pragma solidity ^0.8.10;
pragma experimental ABIEncoderV2;

interface IDigits {
    function claim() external;

    function withdrawableDividendOf(address account)
        external
        view
        returns (uint256);
}
