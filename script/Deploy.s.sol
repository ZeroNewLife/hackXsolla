// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {MedicalCardNFT} from "../src/MedicalCard.sol";
import {console2} from "forge-std/console2.sol";

contract DeployMedicalCard is Script {


    // Константы для деплоя // Constants for deployment
    address public deployer;
    string public constant NFT_NAME = "Xsolla Medical Card NFT";
    string public constant NFT_SYMBOL = "xMCARD";
    string public constant DEFAULT_BASE_IMAGE = "ipfs://bafkreighn7zc2wrpb3lb7b4ttnd6jlvkoot5xzoidpww6zw7qfs4qkkgma"; // замените на реальный хеш

    function setUp() public {
        // Получаем private key из env  
        // Get the private key from env 
        string memory privKey = vm.envString("PRIVATE_KEY");
        
        // Добавляем 0x префикс если его нет
          // Add the 0x prefix if it is missing
        if (!isHexPrefixed(privKey)) {
            privKey = string.concat("0x", privKey);
        }
        
        uint256 deployerPrivateKey = vm.parseUint(privKey);
        deployer = vm.addr(deployerPrivateKey);

        // Логируем информацию о деплое 
        // Logging deployment information
        console2.log("Deploying to:", vm.envString("SEPOLIA_RPC_URL"));
        console2.log("Deployer address:", deployer);
        console2.log("NFT Name:", NFT_NAME);
        console2.log("NFT Symbol:", NFT_SYMBOL);
    }

    // Вспомогательная функция 
    // Auxiliary function
    function isHexPrefixed(string memory str) internal pure returns (bool) {
        bytes memory strBytes = bytes(str);
        return strBytes.length >= 2 && strBytes[0] == '0' && strBytes[1] == 'x';
    }

    function run() public returns (MedicalCardNFT) {
        string memory privKey = vm.envString("PRIVATE_KEY");
        if (!isHexPrefixed(privKey)) {
            privKey = string.concat("0x", privKey);
        }
        uint256 deployerPrivateKey = vm.parseUint(privKey);
        
        // Устанавливаем высокий лимит газа для Xsolla ZK Sepolia 
        // Setting a high gas limit for Xsolla ZK Sepolia
        vm.txGasPrice(100000000); // 0.1 gwei
        
        // Начинаем broadcast транзакций 
         // Start broadcasting transactions
        vm.startBroadcast(deployerPrivateKey);

        // Деплоим контракт:
        // - minterServiceAddress: сначала deployer, потом можно изменить
        // - name: "Medical Card NFT"
        // - symbol: "MCARD"
        // Deploy contract:
        // - minterServiceAddress: deployer first, can be changed later
        // - name: “Medical Card NFT”
        // - symbol: “MCARD”
        MedicalCardNFT nft = new MedicalCardNFT(
            deployer, // временно даём права минта деплоеру // temporarily grant rights to the deployer
            NFT_NAME,
            NFT_SYMBOL
        );

        // Устанавливаем базовый URI изображения 
         // Set the base URI for the image
        nft.setBaseImageURI(DEFAULT_BASE_IMAGE);

        //Тут тоже логируем данные максимально глупо так делать но пусть будет 
         //Here, too, we log data in the most stupid way possible, but let it be. 
        console2.log("NFT deployed to:", address(nft));
        console2.log("Current minter:", nft.minterServiceAddress());
        
        // Завершаем broadcast транзакций 
         // Complete broadcast transactions
        vm.stopBroadcast();
        return nft;
    }
}