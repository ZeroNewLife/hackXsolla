import { ethers } from 'https://cdn.jsdelivr.net/npm/ethers@6.9.0/dist/ethers.min.js';

// ABI: минимальный набор функций контракта, используемый фронтом
const abi = [
  // mint
  "function safeMint(address to, string tokenMetadataUri, string initialPrivateUri) returns (uint256)",
  "function processPayment(uint256 tokenId)",
  "function updateTokenMetadata(uint256 tokenId, string newTokenURI)",

  "function grantAccess(uint256 tokenId, address doctor)",
  "function revokeAccess(uint256 tokenId, address doctor)",
  "function hasAccess(uint256 tokenId, address addr) view returns (bool)",

  "function updatePrivateData(uint256 tokenId, string newPrivateUri)",
  "function getPrivateTokenURI(uint256 tokenId) view returns (string)",

  "function tokenURI(uint256 tokenId) view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",

  "function setBaseImageURI(string newBaseImageURI)",
  "function getBaseImageURI() view returns (string)",
  "function setMinterServiceAddress(address newMinter)",

  "function burn(uint256 tokenId)",

  // events (optional)
  "event NFTMinted(uint256 indexed tokenId, address indexed to, string tokenURI)",
  "event PrivateDataUpdated(uint256 indexed tokenId, address indexed actor, string newUri)",
];

let provider, signer, contract;

const $ = id => document.getElementById(id);
const log = (msg) => { const el = $('log'); el.textContent = `${new Date().toISOString()} - ${msg}\n` + el.textContent }

async function connectWallet() {
  if (!window.ethereum) return alert('Установите MetaMask');
  provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send('eth_requestAccounts', []);
  signer = await provider.getSigner();
  const account = await signer.getAddress();
  $('account').textContent = `Account: ${account}`;
  const network = await provider.getNetwork();
  $('network').textContent = `Chain: ${network.name} (${network.chainId})`;
  log('Wallet connected: ' + account);
}

async function loadContract() {
  const addr = $('contractAddress').value.trim();
  if (!addr) return alert('Укажите адрес контракта');
  if (!signer) {
    // connect read-only
    if (!window.ethereum) return alert('Connect wallet first');
    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
  }
  contract = new ethers.Contract(addr, abi, signer);
  $('contractInfo').textContent = `Loaded: ${addr}`;
  log('Contract loaded ' + addr);
  // try show baseImageURI and owner
  try {
    const base = await contract.getBaseImageURI();
    log('baseImageURI: ' + base);
  } catch(e) { log('getBaseImageURI: ' + e.message) }
}

// helpers
async function txAndShow(promise, outputEl) {
  try {
    const tx = await promise;
    $(outputEl).textContent = 'tx sent: ' + tx.hash;
    log('tx sent: ' + tx.hash);
    const receipt = await tx.wait();
    $(outputEl).textContent += '\nmined: ' + receipt.transactionHash;
    log('tx mined: ' + receipt.transactionHash);
    return receipt;
  } catch (e) {
    $(outputEl).textContent = 'error: ' + (e && e.message ? e.message : e);
    log('error: ' + (e && e.message ? e.message : e));
    throw e;
  }
}

// wire UI
window.addEventListener('load', () => {
  $('connectBtn').onclick = connectWallet;
  $('loadContract').onclick = loadContract;

  $('btnSafeMint').onclick = async () => {
    const to = $('mint_recipient').value;
    const meta = $('mint_metadata').value;
    const priv = $('mint_private').value;
    if (!contract) return alert('Load contract first');
    await txAndShow(contract.safeMint(to, meta, priv), 'outSafeMint');
  };

  $('btnProcessPayment').onclick = async () => {
    const id = Number($('pay_tokenId').value || 0);
    if (!contract) return alert('Load contract first');
    await txAndShow(contract.processPayment(id), 'outProcessPayment');
  };

  $('btnUpdateMeta').onclick = async () => {
    const id = Number($('upmeta_tokenId').value || 0);
    const uri = $('upmeta_uri').value;
    if (!contract) return alert('Load contract first');
    await txAndShow(contract.updateTokenMetadata(id, uri), 'outUpdateMeta');
  };

  $('btnGrant').onclick = async () => {
    const id = Number($('acc_tokenId').value || 0);
    const doc = $('acc_doctor').value;
    if (!contract) return alert('Load contract first');
    await txAndShow(contract.grantAccess(id, doc), 'outAccess');
  };
  $('btnRevoke').onclick = async () => {
    const id = Number($('acc_tokenId').value || 0);
    const doc = $('acc_doctor').value;
    if (!contract) return alert('Load contract first');
    await txAndShow(contract.revokeAccess(id, doc), 'outAccess');
  };

  $('btnHasAccess').onclick = async () => {
    const id = Number($('view_tokenId').value || 0);
    const addr = $('view_addr').value || await signer.getAddress();
    if (!contract) return alert('Load contract first');
    try {
      const res = await contract.hasAccess(id, addr);
      $('outView').textContent = String(res);
      log(`hasAccess(${id}, ${addr}) => ${res}`);
    } catch(e){ $('outView').textContent = e.message; log(e.message) }
  };

  $('btnGetPrivate').onclick = async () => {
    const id = Number($('view_tokenId').value || 0);
    if (!contract) return alert('Load contract first');
    try {
      const res = await contract.getPrivateTokenURI(id);
      $('outView').textContent = String(res);
      log(`getPrivateTokenURI(${id}) => ${res}`);
    } catch(e){ $('outView').textContent = e.message; log(e.message) }
  };

  $('btnTokenURI').onclick = async () => {
    const id = Number($('q_tokenId').value || 0);
    if (!contract) return alert('Load contract first');
    try { const res = await contract.tokenURI(id); $('outQuery').textContent = res; log('tokenURI '+res) } catch(e){ $('outQuery').textContent = e.message }
  };
  $('btnOwnerOf').onclick = async () => {
    const id = Number($('q_tokenId').value || 0);
    if (!contract) return alert('Load contract first');
    try { const res = await contract.ownerOf(id); $('outQuery').textContent = res; log('ownerOf '+res) } catch(e){ $('outQuery').textContent = e.message }
  };
  $('btnBalanceOf').onclick = async () => {
    const address = $('q_address').value || await signer.getAddress();
    if (!contract) return alert('Load contract first');
    try { const res = await contract.balanceOf(address); $('outQuery').textContent = res.toString(); log('balanceOf '+res) } catch(e){ $('outQuery').textContent = e.message }
  };

  $('btnSetBase').onclick = async () => {
    const uri = $('admin_base').value;
    if (!contract) return alert('Load contract first');
    await txAndShow(contract.setBaseImageURI(uri), 'outAdmin');
  };
  $('btnSetMinter').onclick = async () => {
    const m = $('admin_minter').value;
    if (!contract) return alert('Load contract first');
    await txAndShow(contract.setMinterServiceAddress(m), 'outAdmin');
  };

  $('btnUpdatePrivate').onclick = async () => {
    const id = Number($('upd_tokenId').value || 0);
    const uri = $('upd_private').value;
    if (!contract) return alert('Load contract first');
    await txAndShow(contract.updatePrivateData(id, uri), 'outUpd');
  };

  $('btnBurn').onclick = async () => {
    const id = Number($('upd_tokenId').value || 0);
    if (!contract) return alert('Load contract first');
    await txAndShow(contract.burn(id), 'outUpd');
  };

});
