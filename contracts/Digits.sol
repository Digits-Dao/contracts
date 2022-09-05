// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "./DividendTracker.sol";

interface ITokenStorage {
    function swapTokensForDai(uint256 tokens) external;

    function transferDai(address to, uint256 amount) external;

    function addLiquidity(uint256 tokens, uint256 dais) external;

    function distributeDividends(
        uint256 swapTokensDividends,
        uint256 daiDividends
    ) external;

    function setLiquidityWallet(address _liquidityWallet) external;
}

contract Digits is Ownable, IERC20 {
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    string private constant _name = "Digits";
    string private constant _symbol = "DIGITS";

    address public immutable uniswapRouter;
    address public immutable dai;

    uint256 public treasuryFeeBPS = 700;
    uint256 public liquidityFeeBPS = 200;
    uint256 public dividendFeeBPS = 300;
    uint256 public totalFeeBPS = 1200;

    uint256 public swapTokensAtAmount = 100000 * (10**18);
    uint256 public lastSwapTime;
    bool swapAllToken = true;

    bool public swapEnabled = true;
    bool public taxEnabled = true;
    bool public compoundingEnabled = true;

    uint256 private _totalSupply;
    bool private swapping;

    address marketingWallet;

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    mapping(address => bool) private _isExcludedFromFees;
    mapping(address => bool) public automatedMarketMakerPairs;
    mapping(address => bool) private _whiteList;

    event SwapAndAddLiquidity(
        uint256 tokensSwapped,
        uint256 daiReceived,
        uint256 tokensIntoLiquidity
    );
    event ExcludeFromFees(address indexed account, bool isExcluded);
    event SetAutomatedMarketMakerPair(address indexed pair, bool indexed value);
    event SetFee(
        uint256 _treasuryFee,
        uint256 _liquidityFee,
        uint256 _dividendFee
    );
    event SwapEnabled(bool enabled);
    event TaxEnabled(bool enabled);
    event CompoundingEnabled(bool enabled);
    event SetTokenStorage(address _tokenStorage);
    event UpdateDividendSettings(
        bool _swapEnabled,
        uint256 _swapTokensAtAmount,
        bool _swapAllToken
    );
    event SetMaxTxBPS(uint256 bps);
    event ExcludeFromMaxTx(address account, bool excluded);
    event SetMaxWalletBPS(uint256 bps);
    event ExcludeFromMaxWallet(address account, bool excluded);

    DividendTracker public immutable dividendTracker;
    ITokenStorage public tokenStorage;
    IUniswapV2Router02 public uniswapV2Router;

    address public uniswapV2Pair;

    uint256 public maxTxBPS = 49;
    uint256 public maxWalletBPS = 200;

    bool isOpen = false;

    mapping(address => bool) private _isExcludedFromMaxTx;
    mapping(address => bool) private _isExcludedFromMaxWallet;

    constructor(
        address _dai,
        address _uniswapRouter,
        address _marketingWallet,
        address[] memory whitelistAddress
    ) {
        dai = _dai;
        uniswapRouter = _uniswapRouter;
        marketingWallet = _marketingWallet;
        includeToWhiteList(whitelistAddress);

        uniswapV2Router = IUniswapV2Router02(uniswapRouter);
        uniswapV2Pair = IUniswapV2Factory(uniswapV2Router.factory()).createPair(
                address(this),
                dai
            );

        dividendTracker = new DividendTracker(
            dai,
            address(this),
            uniswapRouter
        );

        _setAutomatedMarketMakerPair(uniswapV2Pair, true);

        dividendTracker.excludeFromDividends(address(dividendTracker), true);
        dividendTracker.excludeFromDividends(address(this), true);
        dividendTracker.excludeFromDividends(owner(), true);
        dividendTracker.excludeFromDividends(address(uniswapV2Router), true);
        dividendTracker.excludeFromDividends(address(DEAD), true);

        excludeFromFees(owner(), true);
        excludeFromFees(address(this), true);
        excludeFromFees(address(dividendTracker), true);

        excludeFromMaxTx(owner(), true);
        excludeFromMaxTx(address(this), true);
        excludeFromMaxTx(address(dividendTracker), true);

        excludeFromMaxWallet(owner(), true);
        excludeFromMaxWallet(address(this), true);
        excludeFromMaxWallet(address(dividendTracker), true);

        _mint(owner(), 1000000000 * (10**18));
    }

    function name() external view returns (string memory) {
        return _name;
    }

    function symbol() external view returns (string memory) {
        return _symbol;
    }

    function decimals() external pure returns (uint8) {
        return 18;
    }

    function totalSupply() public view virtual override returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account)
        public
        view
        virtual
        override
        returns (uint256)
    {
        return _balances[account];
    }

    function allowance(address owner, address spender)
        external
        view
        virtual
        override
        returns (uint256)
    {
        return _allowances[owner][spender];
    }

    function approve(address spender, uint256 amount)
        external
        virtual
        override
        returns (bool)
    {
        _approve(_msgSender(), spender, amount);
        return true;
    }

    function increaseAllowance(address spender, uint256 addedValue)
        external
        returns (bool)
    {
        _approve(
            _msgSender(),
            spender,
            _allowances[_msgSender()][spender] + addedValue
        );
        return true;
    }

    function decreaseAllowance(address spender, uint256 subtractedValue)
        external
        returns (bool)
    {
        uint256 currentAllowance = _allowances[_msgSender()][spender];
        require(
            currentAllowance >= subtractedValue,
            "Digits: decreased allowance below zero"
        );
        _approve(_msgSender(), spender, currentAllowance - subtractedValue);
        return true;
    }

    function transfer(address recipient, uint256 amount)
        external
        virtual
        override
        returns (bool)
    {
        _transfer(_msgSender(), recipient, amount);
        return true;
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external virtual override returns (bool) {
        _transfer(sender, recipient, amount);
        uint256 currentAllowance = _allowances[sender][_msgSender()];
        require(
            currentAllowance >= amount,
            "Digits: transfer amount exceeds allowance"
        );
        _approve(sender, _msgSender(), currentAllowance - amount);
        return true;
    }

    function _transfer(
        address sender,
        address recipient,
        uint256 amount
    ) internal {
        require(
            isOpen ||
                sender == owner() ||
                recipient == owner() ||
                _whiteList[sender] ||
                _whiteList[recipient],
            "Not Open"
        );

        require(sender != address(0), "Digits: transfer from the zero address");
        require(
            recipient != address(0),
            "Digits: transfer to the zero address"
        );

        uint256 _maxTxAmount = (totalSupply() * maxTxBPS) / 10000;
        uint256 _maxWallet = (totalSupply() * maxWalletBPS) / 10000;
        require(
            amount <= _maxTxAmount || _isExcludedFromMaxTx[sender],
            "TX Limit Exceeded"
        );

        if (
            sender != owner() &&
            recipient != address(this) &&
            recipient != address(DEAD) &&
            recipient != uniswapV2Pair
        ) {
            uint256 currentBalance = balanceOf(recipient);
            require(
                _isExcludedFromMaxWallet[recipient] ||
                    (currentBalance + amount <= _maxWallet)
            );
        }

        uint256 senderBalance = _balances[sender];
        require(
            senderBalance >= amount,
            "Digits: transfer amount exceeds balance"
        );

        uint256 contractTokenBalance = IERC20(this).balanceOf(
            address(tokenStorage)
        );
        uint256 contractDaiBalance = IERC20(dai).balanceOf(
            address(tokenStorage)
        );

        bool canSwap = contractTokenBalance >= swapTokensAtAmount;

        if (
            swapEnabled && // True
            canSwap && // true
            !swapping && // swapping=false !false true
            !automatedMarketMakerPairs[sender] && // no swap on remove liquidity step 1 or DEX buy
            sender != address(uniswapV2Router) && // no swap on remove liquidity step 2
            sender != owner() &&
            recipient != owner()
        ) {
            swapping = true;

            if (!swapAllToken) {
                contractTokenBalance = swapTokensAtAmount;
            }
            _executeSwap(contractTokenBalance, contractDaiBalance);

            lastSwapTime = block.timestamp;
            swapping = false;
        }

        bool takeFee;

        if (
            sender == address(uniswapV2Pair) ||
            recipient == address(uniswapV2Pair)
        ) {
            takeFee = true;
        }

        if (_isExcludedFromFees[sender] || _isExcludedFromFees[recipient]) {
            takeFee = false;
        }

        if (swapping || !taxEnabled) {
            takeFee = false;
        }

        if (takeFee) {
            uint256 fees = (amount * totalFeeBPS) / 10000;
            amount -= fees;
            _executeTransfer(sender, address(tokenStorage), fees);
        }

        _executeTransfer(sender, recipient, amount);

        dividendTracker.setBalance(sender, balanceOf(sender));
        dividendTracker.setBalance(recipient, balanceOf(recipient));
    }

    function _executeTransfer(
        address sender,
        address recipient,
        uint256 amount
    ) private {
        uint256 senderBalance = _balances[sender];
        require(
            senderBalance >= amount,
            "Digits: transfer amount exceeds balance"
        );
        _balances[sender] = senderBalance - amount;
        _balances[recipient] += amount;
        emit Transfer(sender, recipient, amount);
    }

    function _approve(
        address owner,
        address spender,
        uint256 amount
    ) private {
        require(owner != address(0), "Digits: approve from the zero address");
        require(spender != address(0), "Digits: approve to the zero address");
        _allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }

    function _mint(address account, uint256 amount) private {
        require(account != address(0), "Digits: mint to the zero address");
        _totalSupply += amount;
        _balances[account] += amount;
        emit Transfer(address(0), account, amount);
    }

    function includeToWhiteList(address[] memory _users) private {
        for (uint8 i = 0; i < _users.length; i++) {
            _whiteList[_users[i]] = true;
        }
    }

    function _executeSwap(uint256 tokens, uint256 dais) private {
        if (tokens <= 0) {
            return;
        }

        uint256 swapTokensMarketing;
        if (address(marketingWallet) != address(0)) {
            swapTokensMarketing = (tokens * treasuryFeeBPS) / totalFeeBPS;
        }

        uint256 swapTokensDividends;
        if (dividendTracker.totalSupply() > 0) {
            swapTokensDividends = (tokens * dividendFeeBPS) / totalFeeBPS;
        }

        uint256 tokensForLiquidity = tokens -
            swapTokensMarketing -
            swapTokensDividends;
        uint256 swapTokensLiquidity = tokensForLiquidity / 2;
        uint256 addTokensLiquidity = tokensForLiquidity - swapTokensLiquidity;
        uint256 swapTokensTotal = swapTokensMarketing +
            swapTokensDividends +
            swapTokensLiquidity;

        uint256 initDaiBal = IERC20(dai).balanceOf(address(tokenStorage));
        tokenStorage.swapTokensForDai(swapTokensTotal);
        uint256 daiSwapped = (IERC20(dai).balanceOf(address(tokenStorage)) -
            initDaiBal) + dais;

        uint256 daiMarketing = (daiSwapped * swapTokensMarketing) /
            swapTokensTotal;
        uint256 daiDividends = (daiSwapped * swapTokensDividends) /
            swapTokensTotal;
        uint256 daiLiquidity = daiSwapped - daiMarketing - daiDividends;

        if (daiMarketing > 0) {
            tokenStorage.transferDai(marketingWallet, daiMarketing);
        }

        tokenStorage.addLiquidity(addTokensLiquidity, daiLiquidity);
        emit SwapAndAddLiquidity(
            swapTokensLiquidity,
            daiLiquidity,
            addTokensLiquidity
        );

        if (daiDividends > 0) {
            tokenStorage.distributeDividends(swapTokensDividends, daiDividends);
        }
    }

    function openTrading() external onlyOwner {
        isOpen = true;
    }

    function setTokenStorage(address _tokenStorage) external onlyOwner {
        require(
            address(tokenStorage) == address(0),
            "Digits: tokenStorage already set."
        );

        tokenStorage = ITokenStorage(_tokenStorage);
        dividendTracker.excludeFromDividends(address(tokenStorage), true);
        excludeFromFees(address(tokenStorage), true);
        excludeFromMaxTx(address(tokenStorage), true);
        excludeFromMaxWallet(address(tokenStorage), true);
        emit SetTokenStorage(_tokenStorage);
    }

    function excludeFromFees(address account, bool excluded) public onlyOwner {
        require(
            _isExcludedFromFees[account] != excluded,
            "Digits: account is already set to requested state"
        );
        _isExcludedFromFees[account] = excluded;
        emit ExcludeFromFees(account, excluded);
    }

    function isExcludedFromFees(address account) external view returns (bool) {
        return _isExcludedFromFees[account];
    }

    function excludeFromDividends(address account, bool excluded)
        external
        onlyOwner
    {
        dividendTracker.excludeFromDividends(account, excluded);
    }

    function isExcludedFromDividends(address account)
        external
        view
        returns (bool)
    {
        return dividendTracker.isExcludedFromDividends(account);
    }

    function setWallet(address _marketingWallet, address _liquidityWallet)
        external
        onlyOwner
    {
        require(_marketingWallet != address(0), "Digits: zero!");
        require(_liquidityWallet != address(0), "Digits: zero!");

        marketingWallet = _marketingWallet;
        tokenStorage.setLiquidityWallet(_liquidityWallet);
    }

    function setAutomatedMarketMakerPair(address pair, bool value)
        external
        onlyOwner
    {
        require(pair != uniswapV2Pair, "Digits: DEX pair can not be removed");
        _setAutomatedMarketMakerPair(pair, value);
    }

    function setFee(
        uint256 _treasuryFee,
        uint256 _liquidityFee,
        uint256 _dividendFee
    ) external onlyOwner {
        require(
            _treasuryFee <= 800 && _liquidityFee <= 800 && _dividendFee <= 800,
            "Each fee must be below 8%."
        );

        treasuryFeeBPS = _treasuryFee;
        liquidityFeeBPS = _liquidityFee;
        dividendFeeBPS = _dividendFee;
        totalFeeBPS = _treasuryFee + _liquidityFee + _dividendFee;

        emit SetFee(_treasuryFee, _liquidityFee, _dividendFee);
    }

    function _setAutomatedMarketMakerPair(address pair, bool value) private {
        require(
            automatedMarketMakerPairs[pair] != value,
            "Digits: automated market maker pair is already set to that value"
        );
        automatedMarketMakerPairs[pair] = value;
        if (value) {
            dividendTracker.excludeFromDividends(pair, true);
        }
        emit SetAutomatedMarketMakerPair(pair, value);
    }

    function claim() external {
        bool result = dividendTracker.processAccount(_msgSender());

        require(result == true, "Digits: claim failed.");
    }

    function compound() external {
        require(compoundingEnabled, "Digits: compounding is not enabled");
        bool result = dividendTracker.compoundAccount(_msgSender());

        require(result == true, "Digits: compounding failed.");
    }

    function withdrawableDividendOf(address account)
        external
        view
        returns (uint256)
    {
        return dividendTracker.withdrawableDividendOf(account);
    }

    function withdrawnDividendOf(address account)
        external
        view
        returns (uint256)
    {
        return dividendTracker.withdrawnDividendOf(account);
    }

    function accumulativeDividendOf(address account)
        external
        view
        returns (uint256)
    {
        return dividendTracker.accumulativeDividendOf(account);
    }

    function getAccountInfo(address account)
        external
        view
        returns (
            address,
            uint256,
            uint256,
            uint256,
            uint256
        )
    {
        return dividendTracker.getAccountInfo(account);
    }

    function getLastClaimTime(address account) external view returns (uint256) {
        return dividendTracker.getLastClaimTime(account);
    }

    function setSwapEnabled(bool _enabled) external onlyOwner {
        swapEnabled = _enabled;
        emit SwapEnabled(_enabled);
    }

    function setTaxEnabled(bool _enabled) external onlyOwner {
        taxEnabled = _enabled;
        emit TaxEnabled(_enabled);
    }

    function setCompoundingEnabled(bool _enabled) external onlyOwner {
        compoundingEnabled = _enabled;

        emit CompoundingEnabled(_enabled);
    }

    function updateDividendSettings(
        bool _swapEnabled,
        uint256 _swapTokensAtAmount,
        bool _swapAllToken
    ) external onlyOwner {
        swapEnabled = _swapEnabled;
        swapTokensAtAmount = _swapTokensAtAmount;
        swapAllToken = _swapAllToken;

        emit UpdateDividendSettings(
            _swapEnabled,
            _swapTokensAtAmount,
            _swapAllToken
        );
    }

    function setMaxTxBPS(uint256 bps) external onlyOwner {
        require(bps >= 49 && bps <= 10000, "BPS must be between 49 and 10000");
        maxTxBPS = bps;

        emit SetMaxTxBPS(bps);
    }

    function excludeFromMaxTx(address account, bool excluded) public onlyOwner {
        _isExcludedFromMaxTx[account] = excluded;

        emit ExcludeFromMaxTx(account, excluded);
    }

    function isExcludedFromMaxTx(address account) external view returns (bool) {
        return _isExcludedFromMaxTx[account];
    }

    function setMaxWalletBPS(uint256 bps) external onlyOwner {
        require(
            bps >= 100 && bps <= 10000,
            "BPS must be between 100 and 10000"
        );
        maxWalletBPS = bps;

        emit SetMaxWalletBPS(bps);
    }

    function excludeFromMaxWallet(address account, bool excluded)
        public
        onlyOwner
    {
        _isExcludedFromMaxWallet[account] = excluded;

        emit ExcludeFromMaxWallet(account, excluded);
    }

    function isExcludedFromMaxWallet(address account)
        external
        view
        returns (bool)
    {
        return _isExcludedFromMaxWallet[account];
    }

    function rescueToken(address _token, uint256 _amount) external onlyOwner {
        IERC20(_token).transfer(msg.sender, _amount);
    }

    function rescueETH(uint256 _amount) external onlyOwner {
        payable(msg.sender).transfer(_amount);
    }
}
