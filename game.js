import {
    keysExist,
    generateAndStoreKeys,
    getStoredPublicKey,
    getStoredEncryptedPrivateKey,
    decryptPrivateKey,
    clearStoredKeys
} from './auth.js';

// --- Global state ---
let hostState = {
    isLoggedIn: false,
    publicKey: null,
    privateKey: null,
};

// --- UI Elements ---
const DOMElements = {
    notificationBar: document.getElementById('notification-bar'),
    authPanel: document.getElementById('auth-panel'),
    pinSetupPanel: document.getElementById('pin-setup-panel'),
    pinInput: document.getElementById('pin-input'),
    confirmPinInput: document.getElementById('confirm-pin-input'),
    generateKeysBtn: document.getElementById('generate-keys-btn'),
    
    pinLoginPanel: document.getElementById('pin-login-panel'),
    loginPinInput: document.getElementById('login-pin-input'),
    loginBtn: document.getElementById('login-btn'),
    showGenerateLink: document.getElementById('show-generate-link'),

    hostPanel: document.getElementById('host-panel'),
    publicKeyDisplay: document.getElementById('public-key-display'),
    copyPublicKeyBtn: document.getElementById('copy-public-key-btn'),
    privateKeyInfo: document.getElementById('private-key-info'),
    logoutBtn: document.getElementById('logout-btn'),
};

// --- UI Logic ---

/**
 * Displays a notification message.
 * @param {string} message - The message to display.
 * @param {'success'|'error'} type - The type of notification.
 * @param {number} duration - How long to show the message in ms.
 */
function showNotification(message, type = 'success', duration = 3000) {
    const { notificationBar } = DOMElements;
    notificationBar.textContent = message;
    notificationBar.className = `notification ${type}`;
    setTimeout(() => {
        notificationBar.className = 'notification';
    }, duration);
}

/**
 * Updates the UI based on whether keys exist in storage.
 */
function updateAuthViewState() {
    if (keysExist()) {
        DOMElements.pinSetupPanel.style.display = 'none';
        DOMElements.pinLoginPanel.style.display = 'block';
    } else {
        DOMElements.pinSetupPanel.style.display = 'block';
        DOMElements.pinLoginPanel.style.display = 'none';
    }
}

/**
 * Updates the UI based on the host's login state.
 */
function updateHostStateView() {
    if (hostState.isLoggedIn) {
        DOMElements.authPanel.style.display = 'none';
        DOMElements.hostPanel.style.display = 'block';
        const publicKeyJwk = getStoredPublicKey();
        DOMElements.publicKeyDisplay.textContent = JSON.stringify(publicKeyJwk, null, 2);
    } else {
        DOMElements.authPanel.style.display = 'block';
        DOMElements.hostPanel.style.display = 'none';
        updateAuthViewState();
    }
}

// --- Event Handlers ---

async function handleGenerateKeys() {
    const pin = DOMElements.pinInput.value;
    const confirmPin = DOMElements.confirmPinInput.value;

    if (pin.length < 4 || pin.length > 8) {
        showNotification('PIN must be between 4 and 8 digits.', 'error');
        return;
    }
    if (pin !== confirmPin) {
        showNotification('PINs do not match.', 'error');
        return;
    }

    try {
        await generateAndStoreKeys(pin);
        showNotification('Host keys generated and stored securely!', 'success');
        DOMElements.pinInput.value = '';
        DOMElements.confirmPinInput.value = '';
        updateAuthViewState();
    } catch (error) {
        console.error('Key generation failed:', error);
        showNotification('Error generating keys. See console for details.', 'error');
    }
}

async function handleLogin() {
    const pin = DOMElements.loginPinInput.value;
    if (!pin) {
        showNotification('Please enter your PIN.', 'error');
        return;
    }

    const encryptedKey = getStoredEncryptedPrivateKey();
    try {
        const privateKey = await decryptPrivateKey(encryptedKey, pin);
        hostState.isLoggedIn = true;
        hostState.privateKey = privateKey;
        hostState.publicKey = await crypto.subtle.importKey('jwk', getStoredPublicKey(), { name: 'RSA-PSS', hash: 'SHA-256' }, true, ['verify']);
        
        showNotification('Login successful! Welcome, Host.', 'success');
        DOMElements.loginPinInput.value = '';
        updateHostStateView();
    } catch (error) {
        console.error('Login failed:', error);
        showNotification('Incorrect PIN or corrupted keys.', 'error');
    }
}

function handleLogout() {
    hostState = { isLoggedIn: false, publicKey: null, privateKey: null };
    showNotification('You have been logged out.', 'success');
    updateHostStateView();
}

function handleCopyPublicKey() {
    navigator.clipboard.writeText(DOMElements.publicKeyDisplay.textContent)
        .then(() => showNotification('Public key copied to clipboard!', 'success'))
        .catch(err => {
            console.error('Failed to copy public key:', err);
            showNotification('Failed to copy key.', 'error');
        });
}

function handleShowGeneratePanel(e) {
    e.preventDefault();
    if(confirm("Are you sure? This will delete your existing keys if you proceed with generating new ones.")){
        clearStoredKeys();
        updateAuthViewState();
    }
}


// --- Initialization ---

function initialize() {
    DOMElements.generateKeysBtn.addEventListener('click', handleGenerateKeys);
    DOMElements.loginBtn.addEventListener('click', handleLogin);
    DOMElements.logoutBtn.addEventListener('click', handleLogout);
    DOMElements.copyPublicKeyBtn.addEventListener('click', handleCopyPublicKey);
    DOMElements.showGenerateLink.addEventListener('click', handleShowGeneratePanel);
    
    updateHostStateView();
}

// Start the application
initialize();

