// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

interface IDividendTracker {
    function distributeDividends(uint256 daiDividends) external;
}

contract TokenStorage is Ownable {
    address public immutable dai;
    address public liquidityWallet;
    address public immutable tokenAddress;
    IDividendTracker public immutable dividendTracker;
    IUniswapV2Router02 public uniswapV2Router;

    mapping(address => bool) public managers;

    event SendDividends(uint256 tokensSwapped, uint256 amount);

    constructor(
        address _dai,
        address _tokenAddress,
        address _liquidityWallet,
        address _dividendTracker,
        address _uniswapRouter
    ) {
        dai = _dai;
        tokenAddress = _tokenAddress;
        liquidityWallet = _liquidityWallet;
        dividendTracker = IDividendTracker(_dividendTracker);
        uniswapV2Router = IUniswapV2Router02(_uniswapRouter);
    }

    function addManager(address _address) external onlyOwner {
        require(tokenAddress == _address, "Digits: must be digits address.");
        managers[_address] = true;
    }

    function removeManager(address _address) external onlyOwner {
        managers[_address] = false;
    }

    function transferDai(address to, uint256 amount) external {
        require(
            managers[msg.sender] == true,
            "This address is not allowed to interact with the contract"
        );
        IERC20(dai).transfer(to, amount);
    }

    function swapTokensForDai(uint256 tokens) external {
        require(
            managers[msg.sender] == true,
            "This address is not allowed to interact with the contract"
        );
        address[] memory path = new address[](2);
        path[0] = address(tokenAddress);
        path[1] = dai;

        IERC20(tokenAddress).approve(address(uniswapV2Router), tokens);
        uniswapV2Router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            tokens,
            0, // accept any amount of dai
            path,
            address(this),
            block.timestamp
        );
    }

    function addLiquidity(uint256 tokens, uint256 dais) external {
        require(
            managers[msg.sender] == true,
            "This address is not allowed to interact with the contract"
        );
        IERC20(tokenAddress).approve(address(uniswapV2Router), tokens);
        IERC20(dai).approve(address(uniswapV2Router), dais);

        uniswapV2Router.addLiquidity(
            address(tokenAddress),
            dai,
            tokens,
            dais,
            0, // slippage unavoidable
            0, // slippage unavoidable
            liquidityWallet,
            block.timestamp
        );
    }

    function distributeDividends(
        uint256 swapTokensDividends,
        uint256 daiDividends
    ) external {
        require(
            managers[msg.sender] == true,
            "This address is not allowed to interact with the contract"
        );
        IERC20(dai).approve(address(dividendTracker), daiDividends);
        try dividendTracker.distributeDividends(daiDividends) {
            emit SendDividends(swapTokensDividends, daiDividends);
        } catch Error(
            string memory /*err*/
        ) {}
    }

    function setLiquidityWallet(address _liquidityWallet) external {
        require(
            managers[msg.sender] == true,
            "This address is not allowed to interact with the contract"
        );
        require(_liquidityWallet != address(0), "Digits: zero!");

        liquidityWallet = _liquidityWallet;
    }
}
