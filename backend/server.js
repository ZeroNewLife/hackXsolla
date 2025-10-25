require('dotenv').config();
const express = require('express');
const { ethers } = require('ethers');
const crypto = require('crypto');
const cors = require('cors');
const pinataSDK = require('@pinata/sdk');
const fileUpload = require('express-fileupload');
const fetch = require('node-fetch');

const app = express();

// --- КРИТИЧЕСКИЕ ИСПРАВЛЕНИЯ ДЛЯ ОБРАБОТКИ БОЛЬШИХ ФАЙЛОВ ---
// 1. CORS: разрешает запросы с фронтенда (порт 8080)
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:8080' })); 


// 2. УВЕЛИЧЕННЫЕ ЛИМИТЫ EXPRESS: Для JSON и URL-encoded данных.
// Устанавливаем лимит 50MB, чтобы не обрывать большие запросы до fileUpload.
app.use(express.json({ limit: '50mb' })); // Для Webhook'ов и JSON
app.use(express.urlencoded({ limit: '50mb', extended: true })); // Для URL-encoded форм (если есть)

// 3. FILE UPLOAD С ЛИМИТАМИ: Для обработки multipart/form-data с файлами.
// Устанавливаем лимит 50MB. ЭТО ДОЛЖНО РЕШИТЬ ОШИБКУ "Unexpected end of form".
app.use(fileUpload({ 
    createParentPath: true,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB 
})); 
// -----------------------------------------------------------------


// --- КОНФИГУРАЦИЯ ИЗ .ENV ---
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const MINTER_PRIVATE_KEY = process.env.MINTER_PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL;

const XSOLLA_API_KEY = process.env.XSOLLA_API_KEY; 
const XSOLLA_MERCHANT_ID = process.env.XSOLLA_MERCHANT_ID;
const XSOLLA_PROJECT_ID = process.env.XSOLLA_PROJECT_ID;
const PRODUCT_SKU = process.env.PRODUCT_SKU || 'MEDICAL_CARD_NFT'; // SKU по умолчанию

const pinata = new pinataSDK(process.env.PINATA_API_KEY, process.env.PINATA_SECRET_KEY);
// ABI: Должен соответствовать фронтенду! 3 аргумента.
const MINT_ABI = [
    "function safeMint(address to, string memory tokenMetadataUri, string memory initialPrivateUri) public returns (uint256)",
];

// Подключение к блокчейну (для Webhook)
const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(MINTER_PRIVATE_KEY, provider);
const contract = new ethers.Contract(CONTRACT_ADDRESS, MINT_ABI, wallet);

// --- Вспомогательные функции ---

// 1. Проверка подписи Xsolla (ОБЯЗАТЕЛЬНО ДЛЯ БЕЗОПАСНОСТИ!)
function verifyXsollaSignature(body, signature) {
    if (!signature || !signature.startsWith('Signature ')) return false;
    const rawBody = JSON.stringify(body);
    const receivedHash = signature.split(' ')[1];
    const hash = crypto.createHmac('sha1', XSOLLA_API_KEY).update(rawBody).digest('hex');
    return hash === receivedHash;
}

// 2. Генерация токена для Pay Station (Вызов API Xsolla)
async function getXsollaToken(params) {
    const payload = {
        merchant_id: XSOLLA_MERCHANT_ID,
        project_id: XSOLLA_PROJECT_ID,
        user: { id: params.user_id },
        purchase: {
            custom_parameters: {
                userAddress: params.user_id,
                publicCid: params.publicCid,
                privateCid: params.privateCid,
            },
            checkout: {
                currency: params.currency,
                items: [{ sku: PRODUCT_SKU, quantity: 1 }],
            }
        },
        settings: {
             payment_method_filter: { by: 'payment_method_type', except: ['bankcard', 'paypal'] }
        }
    };
    
    const authString = `${XSOLLA_MERCHANT_ID}:${XSOLLA_API_KEY}`;
    const base64Auth = Buffer.from(authString).toString('base64');
    
    const response = await fetch('https://api.xsolla.com/merchant/v2/merchants/${XSOLLA_MERCHANT_ID}/payment_token', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${base64Auth}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (data.token) {
        return data.token;
    }
    throw new Error(`Xsolla Token Error: ${data.error ? data.error.description : JSON.stringify(data)}`);
}

// --- МАРШРУТЫ ---

// 1. Подготовка данных, загрузка в IPFS и ИНИЦИАЦИЯ ОПЛАТЫ
// ВАЖНО: УДАЛЕН ЛОКАЛЬНЫЙ fileUpload. Он работает глобально.
app.post('/api/prepare-medical-card', async (req, res) => {
    try {
        // Убедитесь, что req.body и req.files содержат данные
        console.log('--- Начат прием данных от фронтенда ---');

        const { patientName, birthDate, diagnosis, additionalInfo, userAddress } = req.body;
        const files = req.files || {};
        
        // 1. Загрузка фото (если есть)
        let photoCid = "";
        if (files.photo) {
            const photoResult = await pinata.pinFileToIPFS(files.photo.data, { pinataMetadata: { name: 'patient_photo' } });
            photoCid = photoResult.IpfsHash;
        }

        // 2. Создание публичных метаданных
        const publicMetadata = {
            name: `Медкарта: ${patientName}`,
            description: `Пациент: ${patientName}`,
            image: photoCid ? `ipfs://${photoCid}` : process.env.DEFAULT_IMAGE_URI || "ipfs://QmDefaultImage",
            external_url: `https://yourapp.com/cards/${Date.now()}`
        };

        // 3. Создание и "Шифрование" приватных метаданных
        const privateMetadata = {
            fullName: patientName,
            birthDate: birthDate,
            diagnosis: diagnosis,
            additionalInfo: additionalInfo,
            // Документы и шифрование здесь опущены
        };

        // 4. Загрузка метаданных в IPFS
        const publicCid = (await pinata.pinJSONToIPFS(publicMetadata)).IpfsHash;
        const privateCid = (await pinata.pinJSONToIPFS(privateMetadata)).IpfsHash;

        // 5. Получение токена для Xsolla Pay Station
        const xsollaToken = await getXsollaToken({
            user_id: userAddress,
            currency: "USD",
            publicCid: publicCid,
            privateCid: privateCid
        });

        // 6. Отправляем токен фронтенду для перенаправления
        res.json({
            token: xsollaToken,
            publicCid: `ipfs://${publicCid}`,
            privateCid: `ipfs://${privateCid}`
        });

    } catch (error) {
        // ВАЖНО: Если бэкенд упал, он больше не будет возвращать "Unexpected end of form", а вернет JSON-ошибку
        console.error('КРИТИЧЕСКАЯ ОШИБКА БЭКЕНДА:', error);
        res.status(500).json({ error: error.message, detail: error.toString() });
    }
});

// 2. WEBHOOK: Подтверждение оплаты и МИНТ NFT
// ВЫЗЫВАЕТСЯ СЕРВЕРОМ XSOLLA
app.post('/webhook/xsolla', async (req, res) => {
    try {
        const signature = req.get('Authorization');
        const webhookBody = req.body;
        
        // 1. Проверка подписи (Раскомментируйте в продакшене!)
        // if (!verifyXsollaSignature(webhookBody, signature)) {
        //     console.warn('Invalid Xsolla signature received.');
        //     return res.status(403).send('Forbidden');
        // }

        if (webhookBody.notification_type === 'user_paid') {
            const { userAddress, publicCid, privateCid } = webhookBody.purchase.custom_parameters;
            
            if (!userAddress || !publicCid || !privateCid) {
                console.error('Webhook: Missing custom parameters for mint.');
                return res.status(400).send('Missing data');
            }

            console.log(`Payment confirmed for ${userAddress}. Minting NFT...`);

            // 2. Минтим NFT (3 аргумента)
            const tx = await contract.safeMint(
                userAddress,
                `ipfs://${publicCid}`,
                `ipfs://${privateCid}`
            );
            
            await tx.wait();
            
            console.log(`NFT Minted for ${userAddress}. Tx: ${tx.hash}`);

            res.status(200).send('ok');
        } else {
            res.status(200).send('ok');
        }
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).send('Error');
    }
});

// --- Маршрут для проверки активности сервера ---
app.get('/', (req, res) => {
    res.send(`Xsolla-Minter Server is running on port ${port}. Minter: ${wallet.address}.`);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});