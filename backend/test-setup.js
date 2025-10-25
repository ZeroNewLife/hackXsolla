const ethers = require('ethers');
const dotenv = require('dotenv');
dotenv.config();

// Тестовый скрипт для проверки всех компонентов
async function testSetup() {
    try {
        // 1. Проверка подключения к блокчейну
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        const network = await provider.getNetwork();
        console.log('Connected to network:', network.name);

        // 2. Проверка баланса минтера
        const wallet = new ethers.Wallet(process.env.MINTER_PRIVATE_KEY, provider);
        const balance = await provider.getBalance(wallet.address);
        console.log('Minter balance:', ethers.formatEther(balance), 'ETH');
        
        if (balance < ethers.parseEther('0.1')) {
            console.warn('Warning: Low balance for minter! Need at least 0.1 ETH');
        }

        // 3. Проверка контракта
        const contract = new ethers.Contract(
            process.env.CONTRACT_ADDRESS,
            ["function minterServiceAddress() view returns (address)"],
            wallet
        );
        
        const minter = await contract.minterServiceAddress();
        console.log('Current minter address:', minter);
        
        if (minter.toLowerCase() !== wallet.address.toLowerCase()) {
            console.warn('Warning: Minter address does not match wallet address!');
        }

        // 4. Проверка Pinata
        const pinataSDK = require('@pinata/sdk');
        const pinata = new pinataSDK(
            process.env.PINATA_API_KEY,
            process.env.PINATA_SECRET_KEY
        );
        
        const testAuth = await pinata.testAuthentication();
        console.log('Pinata auth:', testAuth.authenticated ? 'OK' : 'Failed');

        // 5. Проверка переменных Xsolla
        const xsollaVars = ['XSOLLA_MERCHANT_ID', 'XSOLLA_PROJECT_ID', 'XSOLLA_API_KEY'];
        xsollaVars.forEach(key => {
            if (!process.env[key]) {
                console.warn(`Warning: ${key} not set in .env`);
            }
        });

        return true;
    } catch (error) {
        console.error('Setup test failed:', error);
        return false;
    }
}

// Запускаем тест
testSetup().then(success => {
    if (success) {
        console.log('\nSetup test completed successfully! ✅');
    } else {
        console.log('\nSetup test failed! ❌');
    }
});