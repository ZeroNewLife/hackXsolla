// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30; // Совместимо с 0.8.30

import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "openzeppelin-contracts/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {ERC721URIStorage} from "openzeppelin-contracts/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

/**
 * @author ZeroWeb3,Doni
 * @title MedicalCardNFT
 * @dev Контракт ERC-721 для медицинских карт. Использует ERC721Enumerable и Ownable.
 * 
 */
contract MedicalCardNFT is ERC721Enumerable, ERC721URIStorage, Ownable {

    // Тут у нас реализован счетчик токенов 
    uint256 private _tokenIdTracker = 1;

    // 1. Приватные данные: tokenId => Адрес врача => Статус доступа (true/false)
    mapping(uint256 => mapping(address => bool)) private _authorizedDoctors;

    // 2. Хранение URI: tokenId => CID зашифрованных приватных данных
    mapping(uint256 => string) private _privateTokenUris;

    // 3. Адрес, авторизованный для минта (Ваш Бэкенд Xsolla Webhook)
    address public minterServiceAddress;

    // Тут у нас реализовано отслеживанние событий:
    event AccessGranted(uint256 indexed tokenId, address indexed doctor);
    event AccessRevoked(uint256 indexed tokenId, address indexed doctor);
    event PrivateDataUpdated(uint256 indexed tokenId, address indexed actor, string newUri);
    event NFTMinted(uint256 indexed tokenId, address indexed to, string tokenURI);
    event PaymentProcessed(uint256 indexed tokenId, address indexed from, uint256 amount);
    event BaseImageURIUpdated(string newBaseImageURI);

    // Тут у нас реализовано общее изображение для всех NFT
    string public baseImageURI;
    
    // --- Наш конструктор  ---
    
    constructor(address initialMinterService, string memory name, string memory symbol) 
        ERC721(name, symbol) 
        Ownable(msg.sender)
    {
        // Тут происходит назначение начального адреса минтера 
        minterServiceAddress = initialMinterService;
    }

    // --- Функции управления общим изображением 

    /// @notice Установить базовый URI изображения, общий для всех NFT
    function setBaseImageURI(string memory newBaseImageURI) external onlyOwner {
        baseImageURI = newBaseImageURI;
        emit BaseImageURIUpdated(newBaseImageURI);
    }

    /// @notice Получить базовый URI изображения
    function getBaseImageURI() external view returns (string memory) {
        return baseImageURI;
    }

    // --- ФУНКЦИЯ МИНТА (Интеграция с Xsolla) ---

    /// @notice Минтит новый токен с публичным metadata URI IPFS и приватным CID/URI
    /// @param to Получатель токена адрессат 
    /// @param tokenMetadataUri Публичный URI  который указывает на JSON в Pinata
    /// @param initialPrivateUri Приватный CID/URI (может быть зашифрованный) для хранения медданных


    function safeMint(address to, string memory tokenMetadataUri, string memory initialPrivateUri)
     public returns (uint256) {

        // Только авторизованный бэкенд может вызывать mint (или владелец может менять этот адрес)
        require(msg.sender == minterServiceAddress, "MINT: Caller is not the authorized minter");
        require(to != address(0), "MINT: Cannot mint to zero address");
        require(bytes(tokenMetadataUri).length > 0, "MINT: tokenMetadataUri required");

        uint256 tokenId = _tokenIdTracker;

        _safeMint(to, tokenId);

        // Сохраняем публичный metadata URI
        _setTokenURI(tokenId, tokenMetadataUri);

        // Сохраняем приватный URI/CID
        _privateTokenUris[tokenId] = initialPrivateUri;

        // Увеличиваем счетчик токенов
        _tokenIdTracker++;

        //Тут у нас реализовано просмотр событий 
        emit NFTMinted(tokenId, to, tokenMetadataUri);
        
        return tokenId;
    }

    /// @notice Обработка платежа через Xsolla (вызывается после успешной оплаты)
    /// @dev Эта функция эмитит событие для трекинга платежей, может быть расширена
    function processPayment(uint256 tokenId) external {
        require(msg.sender == minterServiceAddress, "PAYMENT: Only minter can process");
        require(_ownerOf(tokenId) != address(0), "PAYMENT: Token does not exist");
        
        // В реальной интеграции здесь может быть логика обработки платежа
        emit PaymentProcessed(tokenId, _ownerOf(tokenId), 1); // amount пока =1 для примера
    }

    /// @notice Обновить публичные метаданные NFT (например, description)
    /// @dev Только владелец токена или minter могут обновлять
    function updateTokenMetadata(uint256 tokenId, string memory newTokenURI) external {
        address owner = _ownerOf(tokenId);
        require(owner != address(0), "URI: Token does not exist");
        require(
            msg.sender == minterServiceAddress || _isAuthorized(owner, msg.sender, tokenId),
            "URI: Not authorized to update metadata"
        );
        
        _setTokenURI(tokenId, newTokenURI);
    }
    
    // --- ФУНКЦИИ КОНТРОЛЯ ДОСТУПА (Доктора) ---

     /// @notice Тут мы назначаем нового пользователя с доступом к медданным
    function grantAccess(uint256 tokenId, address doctor) public {
        address owner = ERC721._ownerOf(tokenId);
        require(owner != address(0), "ACCESS: Token does not exist");

        // проверяем авторизацию вызывающего (владелец / approved / operator)
        require(ERC721._isAuthorized(owner, msg.sender, tokenId), "ACCESS: Not authorized");
        require(doctor != address(0), "ACCESS: Doctor address cannot be zero");

        _authorizedDoctors[tokenId][doctor] = true;
        emit AccessGranted(tokenId, doctor);
    }

    /// @notice Тут мы удаляем доступ пользователя к медданным
    function revokeAccess(uint256 tokenId, address doctor) public {
        address owner = ERC721._ownerOf(tokenId);
        require(owner != address(0), "ACCESS: Token does not exist");
        require(ERC721._isAuthorized(owner, msg.sender, tokenId), "ACCESS: Not authorized");

        _authorizedDoctors[tokenId][doctor] = false;
        emit AccessRevoked(tokenId, doctor);
    }
    /// @notice Проверяет, имеет ли адрес доступ к приватным данным токена
    function hasAccess(uint256 tokenId, address addr) public view returns (bool) {
        address owner = ERC721._ownerOf(tokenId);
        require(owner != address(0), "ACCESS: Token does not exist");

        // владелец, approved или operator всегда имеют доступ
        if (ERC721._isAuthorized(owner, addr, tokenId)) {
            return true;
        }
        return _authorizedDoctors[tokenId][addr];
    }
    
    // --- ФУНКЦИИ УПРАВЛЕНИЯ ДАННЫМИ ---

    function updatePrivateData(uint256 tokenId, string memory newPrivateUri) public {

        // Проверка прав на обновление (владелец ИЛИ авторизованный врач)
        address owner = ERC721._ownerOf(tokenId);
        require(owner != address(0), "UPDATE: Token does not exist");
        require(
            ERC721._isAuthorized(owner, msg.sender, tokenId) || _authorizedDoctors[tokenId][msg.sender], 
            "UPDATE: Caller must be patient or authorized doctor"
        );
            
        bytes memory uriBytes = bytes(newPrivateUri);
        require(uriBytes.length > 0, "UPDATE: URI cannot be empty");

        _privateTokenUris[tokenId] = newPrivateUri;
        emit PrivateDataUpdated(tokenId, msg.sender, newPrivateUri);
    }
    
    /// @notice Получить приватный URI/CID медицинских данных токена
    function getPrivateTokenURI(uint256 tokenId) public view returns (string memory) {
        address owner = ERC721._ownerOf(tokenId);
        require(owner != address(0), "URI: Token does not exist");

        // Только владелец, approved, operator или авторизованный врач могут получить приватный URI
        require(hasAccess(tokenId, msg.sender), "URI: Caller has no access to private data");
        return _privateTokenUris[tokenId];
    }
    
    // --- ПЕРЕОПРЕДЕЛЕНИЕ ФУНКЦИЙ ERC-721 

    /// @dev Возвращает публичный metadata URI (тот, что был установлен при mint через Pinata)

    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    /// @dev Проверка поддержки интерфейсов
    function supportsInterface(bytes4 interfaceId) 
        public 
        view 
        override(ERC721Enumerable, ERC721URIStorage)
        returns (bool) 
    {
        return super.supportsInterface(interfaceId);
    }

    // --- ADMIN FUNCTIONS ---

    /// @notice Установить адрес сервиса, который может вызывать mint
    function setMinterServiceAddress(address newMinter) external onlyOwner {
        minterServiceAddress = newMinter;
    }

    // --- Необходимые переопределения для множественного наследования (OpenZeppelin v5) ---

    /// @dev ERC721Enumerable переопределяет _increaseBalance и _update; нужно указать оба базовых класса
    function _increaseBalance(address account, uint128 value) internal virtual override(ERC721, ERC721Enumerable) {
        super._increaseBalance(account, value);
    }

 
    function _update(address to, uint256 tokenId, address auth) internal virtual override(ERC721, ERC721Enumerable) returns (address) {
        return super._update(to, tokenId, auth);
    }

    /// @notice Публичный burn, очищающий приватные данные. Используем внутренний ERC721._burn
    function burn(uint256 tokenId) external {
        address owner = ERC721._ownerOf(tokenId);
        require(owner != address(0), "BURN: Token does not exist");
        require(ERC721._isAuthorized(owner, msg.sender, tokenId), "BURN: Not authorized");

        // Вызов внутренней реализации _burn
        ERC721._burn(tokenId);

        if (bytes(_privateTokenUris[tokenId]).length != 0) {
            delete _privateTokenUris[tokenId];
        }
    }
}