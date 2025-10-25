## Foundry

**Foundry is a blazing fast, portable and modular toolkit for Ethereum application development written in Rust.**

Foundry consists of:

- **Forge**: Ethereum testing framework (like Truffle, Hardhat and DappTools).
- **Cast**: Swiss army knife for interacting with EVM smart contracts, sending transactions and getting chain data.
- **Anvil**: Local Ethereum node, akin to Ganache, Hardhat Network.
- **Chisel**: Fast, utilitarian, and verbose solidity REPL.

## Documentation

# Medical Card NFT — подробная документация

Это репозиторий смарт-контракта NFT для медицинских карт, оптимизированный под workflow, где
публичная часть (metadata JSON) хранится в IPFS (Pinata), изображение может быть одно для всех токенов,
а приватные медицинские данные хранятся отдельно (зашифрованные) и доступны только авторизованным лицам.

Ниже — подробный разбор кода, всех функций и событий, а также пошаговые инструкции по деплою,
верификации в Xsolla ZK Sepolia и интеграции с фронтендом/Xsolla.

## Краткая аннотация контракта

Файл: `src/MedicalCard.sol` — контракт `MedicalCardNFT`.

- Наследует: `ERC721Enumerable`, `ERC721URIStorage`, `Ownable` (локальная версия OpenZeppelin v5 в `lib/`).
- Основная идея:
	- публичные метаданные (tokenURI) — указываются при минте и пинятся в Pinata;
	- приватный URI (например, зашифрованный JSON в IPFS) хранится в `_privateTokenUris[tokenId]`;
	- доступ врачей контролируется через `_authorizedDoctors[tokenId][doctor]`;
	- минт может вызывать только `minterServiceAddress` (обычно backend/Xsolla webhook);
	- есть упрощённая логика оплаты (`processPayment`) и обновления метаданных (`updateTokenMetadata`).

## Хранение данных

- mapping(uint256 => mapping(address => bool)) private _authorizedDoctors;
	- кто имеет доступ к приватным данным конкретного `tokenId`.

- mapping(uint256 => string) private _privateTokenUris;
	- CID/URI приватных (зашифрованных) данных в IPFS.

- string public baseImageURI;
	- общий URI изображения, используемый в публичных metadata JSON (опционально — можно указывать напрямую в metadata).

- address public minterServiceAddress;
	- адрес, которому доверено создавать токены (в production — адрес бэкенда Xsolla/минтера).

## События

- AccessGranted(tokenId, doctor)
- AccessRevoked(tokenId, doctor)
- PrivateDataUpdated(tokenId, actor, newUri)
- NFTMinted(tokenId, to, tokenURI)
- PaymentProcessed(tokenId, from, amount)
- BaseImageURIUpdated(newBaseImageURI)

Используются для удобной индексации и оффчейн-трекинга через логсервисы.

## Разбор функций (строго по коду)

- constructor(address initialMinterService, string name, string symbol)
	- Инициализация `ERC721` с именем/символом.
	- Вызывает `Ownable(msg.sender)` (в OpenZeppelin v5 конструктор Ownable требует owner).
	- Устанавливает `minterServiceAddress = initialMinterService`.

- function safeMint(address to, string tokenMetadataUri, string initialPrivateUri) public returns (uint256)
	- Доступна только вызвавшемуся `minterServiceAddress`.
	- Минтит новый tokenId, устанавливает публичный URI через `_setTokenURI` и приватный URI в mapping.
	- Эмитит `NFTMinted`.

- function grantAccess(uint256 tokenId, address doctor) public
	- Владелец токена (или одобренный) может дать доступ врачу.
	- Проверка проводится через внутренние OpenZeppelin-хелперы: получаем owner через `_ownerOf` и проверяем `_isAuthorized(owner, caller, tokenId)`.

- function revokeAccess(uint256 tokenId, address doctor) public
	- Отозвать доступ аналогично grantAccess.

- function hasAccess(uint256 tokenId, address addr) public view returns (bool)
	- Владелец/approved/operator (через `_isAuthorized`) автоматически имеют доступ.
	- Иначе проверяется `_authorizedDoctors[tokenId][addr]`.

- function updatePrivateData(uint256 tokenId, string newPrivateUri) public
	- Владелец или авторизованный врач может обновить приватный URI (например, после загрузки нового зашифрованного файла).

- function getPrivateTokenURI(uint256 tokenId) public view returns (string memory)
	- Возвращает приватный URI, но только для тех, у кого есть доступ (hasAccess проверяет это).

- function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory)
	- Возвращает публичный metadata URI, управляемый ERC721URIStorage.

- function setMinterServiceAddress(address newMinter) external onlyOwner
	- Меняет адрес, который вправе вызывать `safeMint`.

- function setBaseImageURI(string newBaseImageURI) external onlyOwner
	- Обновление общего изображения (изменяет `baseImageURI` и эмитит событие).

- function processPayment(uint256 tokenId) external
	- Примитивная функция, вызываемая `minterServiceAddress` после успешной оплаты.
	- Эмитит `PaymentProcessed`. Здесь можно интегрировать проверку приходящего webhook/Xsolla данные.

- function updateTokenMetadata(uint256 tokenId, string newTokenURI) external
	- Обновление публичного metadata URI (может понадобиться для обновления `description` после оплаты или KYC).
	- Доступ только minterServiceAddress или владельцу/approved.

- function burn(uint256 tokenId) external
	- Внешняя функция для бёрна (вызывает внутренний `ERC721._burn`) при условии авторизации.
	- Очищает приватный URI из mapping при бёрне.

## Особенности реализации и замечания по безопасности

- Приватные данные НЕ хранятся в блокчейне — в контракте хранится только URI (CID). Сам файл с данными должен быть зашифрован off-chain.
- Шифрование: используйте симметричное шифрование (AES) или асимметричное, ключи не храните в контракте.
- Доверенный минтер (`minterServiceAddress`) — важный элемент безопасности; используйте AccessControl, если нужно несколько минтеров.
- Проверьте, что приватные URI действительно зашифрованы и доступ к ключам только у уполномоченных.

## Workflow: фронтенд + Pinata + Xsolla (пошагово)

1) Фронтенд загружает/пинит общее изображение на Pinata (один раз) и получает `ipfs://imageCid`.
2) Для каждой карты фронтенд формирует публичный metadata JSON (image = baseImageURI или imageCid):
	 - `name`, `description`, `image`, `attributes`.
3) Фронтенд пинит metadata JSON -> получает `ipfs://metadataCid`.
4) Приватные медицинские данные шифруются на клиенте (AES с ключом пациента) -> пинятся -> `ipfs://privateCid`.
5) Бэкенд (Xsolla webhook) после успешной оплаты вызывает `safeMint(patientAddress, "ipfs://metadataCid", "ipfs://privateCid")`.
6) При необходимости пациент даёт доступ врачу: `grantAccess(tokenId, doctorAddress)`.
7) Авторизованный врач получает `ipfs://privateCid` из контракта и запрашивает у пациента/сервер ключ шифрования для расшифровки.

## Деплой и проверка

Твой deploy-скрипт уже есть: `script/Deploy.s.sol`. Он устанавливает `minterServiceAddress = deployer` и `baseImageURI`.

Примеры команд (Foundry):

Сборка и деплой:
```bash
forge build
source .env
forge script script/Deploy.s.sol:DeployMedicalCard \
	--rpc-url $SEPOLIA_RPC_URL \
	--private-key $PRIVATE_KEY \
	--broadcast \
	--verify
```

Верификация на Xsolla ZK Sepolia (через кастомный верификатор):
1) Получить constructor args в hex (пример для твоего конструктора):
```bash
cast abi-encode "constructor(address,string,string)" 0xD843CBe0bdeE3E884Fd32cE4942219830D5944DA "Xsolla Medical Card NFT" "xMCARD" | sed 's/^0x//'
```

2) Запустить forge verify-contract с явной версией компилятора:
```bash
forge verify-contract \
	--rpc-url $SEPOLIA_RPC_URL \
	--constructor-args 0x<CONSTRUCTOR_HEX> \
	--verifier custom \
	--verifier-url $XSOLLA_ZK_SEPOLIA_TESTNET_CONTRACT_VERIFICATION \
	--compiler-version 0.8.30 \
	$DEPLOYED_CONTRACT_ADDRESS \
	./src/MedicalCard.sol:MedicalCardNFT
```

Если сервис Xsolla не принимает прямой forge-запрос или верификация не прошла, делать flatten и отправлять через их API (curl):

```bash
forge flatten src/MedicalCard.sol > MedicalCard.flattened.sol

# подготовить CONSTRUCTOR_HEX как выше (с 0x)

curl -X POST "$XSOLLA_ZK_SEPOLIA_TESTNET_CONTRACT_VERIFICATION" \
	-F "contract_address=$DEPLOYED_CONTRACT_ADDRESS" \
	-F "contract_name=MedicalCardNFT" \
	-F "compiler_version=0.8.30" \
	-F "constructor_arguments=0x<CONSTRUCTOR_HEX_NO0X>" \
	-F "source_code=@MedicalCard.flattened.sol"
```

Обрати внимание: поля `optimization_used`/`runs` / имена полей могут отличаться у Xsolla — смотри документацию API. Если их форма другая — адаптируй имена полей к требуемым.

## Тестирование (рекомендуется)

- Написать Foundry тесты:
	- mint: успешный mint только от minterServiceAddress;
	- access control: grant/revoke/hasAccess;
	- getPrivateTokenURI: доступ для владельца и авторизованного врача; отказ для других.

Я могу добавить эти тесты по запросу.

## Траблшутинг верификации

Если верификация не прошла или сайт не показывает исходник:

1) Проверь, что в `forge build` использована одна и та же версия компилятора, как та, которой ты передаёшь `--compiler-version` (0.8.30).
2) Убедись, что `constructor_arguments` совпадают точно с теми, которые использовались при деплое (включая 0x и порядок аргументов).
3) Если контракт использует remappings/импорты, убедись, что flattened файл содержит корректно подставленные импорты (forge flatten делает это).
4) Посмотри curl-ответ от Xsolla после отправки source — чаще всего сервис возвращает причину отказа в теле.

Если хочешь, могу:
- подготовить `MedicalCard.flattened.sol` и пример `curl` payload под конкретное поле API Xsolla;
- собрать и выслать `constructor_args` в hex;
- или добавить простые тесты для валидации логики контракта.

## Что дальше (предлагаемые шаги)

1) Подтверди, что верификация на Xsolla в статусе "Success" — если нет, пришли текст ошибки со страницы.
2) Если верификация не отображается (404 / unsupported chain) — используй `forge verify-contract` с флагом `--verifier custom` и URL в `.env` (как показано выше).
3) Напишу unit-тесты Foundry (3–5 тестов) чтобы проверить ключевые сценарии.
4) Подготовлю пример backend-эндпоинта (Node.js/Express) для приёма вебхуков Xsolla и вызова `safeMint`.

---

Если хочешь — сделаю следующее прямо сейчас:
- сгенерирую `constructor_args` в hex и добавлю их в README; 
- сгенерирую `MedicalCard.flattened.sol` и подготовлю `curl`-запрос для отправки на Xsolla.

Скажи, что делаем дальше: (A) готовлю flattened+curl, (B) генерирую constructor hex и запускаем forge verify-contract, (C) пишу тесты, (D) готовлю backend webhook пример.
