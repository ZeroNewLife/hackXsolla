// backend/server.js
const express = require('express');
const { ethers } = require('ethers');
const multer = require('multer');
const pinataSDK = require('@pinata/sdk');
const crypto = require('crypto');

const app = express();
const pinata = new pinataSDK(process.env.PINATA_API_KEY, process.env.PINATA_SECRET_KEY);

// Конфигурация для Xsolla
const XSOLLA_PROJECT_ID = process.env.XSOLLA_PROJECT_ID;
const XSOLLA_PROJECT_KEY = process.env.XSOLLA_PROJECT_KEY;
const XSOLLA_MERCHANT_ID = process.env.XSOLLA_MERCHANT_ID;

// Конфигурация для смарт-контракта
const CONTRACT_ADDRESS = "0xe06e6886Ce61017d9B8663a260EfC6e9449295f6";
const MINTER_PRIVATE_KEY = process.env.MINTER_PRIVATE_KEY;

// Хранилище временных данных (в реальном проекте используйте базу данных)
const pendingMints = new Map();

// Настройка multer для загрузки файлов
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB лимит
});

// 1. Подготовка данных медкарты
app.post('/api/prepare-medical-card', upload.fields([
    { name: 'photo', maxCount: 1 },
    { name: 'documents', maxCount: 5 }
]), async (req, res) => {
    try {
        // Загрузка фото в IPFS
        const photoBuffer = req.files['photo'][0].buffer;
        const photoResult = await pinata.pinFileToIPFS(photoBuffer, {
            pinataMetadata: { name: `patient_photo_${Date.now()}.jpg` }
        });
        const photoCid = photoResult.IpfsHash;

        // Загрузка документов
        const documentCids = await Promise.all(
            req.files['documents'].map(async file => {
                const result = await pinata.pinFileToIPFS(file.buffer, {
                    pinataMetadata: { name: file.originalname }
                });
                return result.IpfsHash;
            })
        );

        // Создание публичных метаданных
        const publicMetadata = {
            name: `Медкарта: ${req.body.patientName}`,
            description: `Пациент: ${req.body.patientName}\nДата рождения: ${req.body.birthDate}`,
            image: `ipfs://${photoCid}`,
            external_url: `https://yourapp.com/cards/${Date.now()}`
        };

        // Шифрование и создание приватных метаданных
        const privateMetadata = {
            fullName: req.body.patientName,
            birthDate: req.body.birthDate,
            diagnosis: req.body.diagnosis,
            additionalInfo: req.body.additionalInfo,
            documents: documentCids.map(cid => `ipfs://${cid}`)
        };

        // Шифрование приватных данных (в реальном проекте используйте более безопасный метод)
        const encryptedPrivateData = crypto.publicEncrypt(
            {
                key: process.env.PUBLIC_KEY,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING
            },
            Buffer.from(JSON.stringify(privateMetadata))
        );

        // Загрузка метаданных в IPFS
        const publicCid = (await pinata.pinJSONToIPFS(publicMetadata)).IpfsHash;
        const privateCid = (await pinata.pinJSONToIPFS({
            data: encryptedPrivateData.toString('base64')
        })).IpfsHash;

        // Получение токена для Xsolla Pay Station
        const xsollaToken = await getXsollaToken({
            user_id: req.body.userAddress,
            amount: 100, // Стоимость в вашей валюте
            currency: "USD"
        });

        // Сохраняем данные для последующего минта
        pendingMints.set(xsollaToken, {
            userAddress: req.body.userAddress,
            publicCid,
            privateCid
        });

        res.json({
            token: xsollaToken,
            publicCid,
            privateCid
        });
    } catch (error) {
        console.error('Error preparing medical card:', error);
        res.status(500).json({ error: error.message });
    }
});

// 2. Webhook для Xsolla
app.post('/webhook/xsolla', async (req, res) => {
    try {
        // Проверка подписи от Xsolla
        const signature = req.get('Authorization');
        if (!verifyXsollaSignature(req.body, signature)) {
            throw new Error('Invalid signature');
        }

        const { payment_id, token, status } = req.body;
        
        if (status === 'paid') {
            const mintData = pendingMints.get(token);
            if (!mintData) {
                throw new Error('Mint data not found');
            }

            // Минтим NFT
            const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
            const wallet = new ethers.Wallet(MINTER_PRIVATE_KEY, provider);
            const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

            // Создание NFT
            const tx = await contract.safeMint(
                mintData.userAddress,
                `ipfs://${mintData.publicCid}`,
                `ipfs://${mintData.privateCid}`
            );
            
            const receipt = await tx.wait();
            
            // Очистка временных данных
            pendingMints.delete(token);

            // Отправка успешного статуса Xsolla
            res.json({ status: 'ok' });
        }
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Вспомогательные функции
async function getXsollaToken(params) {
    // Генерация токена для Pay Station
    const payload = {
        merchant_id: XSOLLA_MERCHANT_ID,
        project_id: XSOLLA_PROJECT_ID,
        user: {
            id: params.user_id
        },
        purchase: {
            checkout: {
                currency: params.currency,
                amount: params.amount
            }
        }
    };

    // В реальном проекте здесь должен быть запрос к API Xsolla
    return 'test_token';
}

function verifyXsollaSignature(body, signature) {
    // Проверка подписи от Xsolla
    // В реальном проекте здесь должна быть настоящая проверка
    return true;
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});