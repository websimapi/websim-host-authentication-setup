import {
    keysExist,
    generateAndStoreKeys,
    getStoredPublicKey,
    getStoredEncryptedPrivateKey,
    decryptPrivateKey,
    clearStoredKeys
} from './auth.js';

// The designated host's public key.
const HOST_PUBLIC_KEY_JWK = {
  "alg": "PS256",
  "e": "AQAB",
  "ext": true,
  "key_ops": [
    "verify"
  ],
  "kty": "RSA",
  "n": "v-Ha4MxtKjVSkBtwPZ9CFyalZGtgEj88VFPSGPsm7ezOLvgMVL0pswTXMzrjZ87j3dF3NSaXb6b1ch0r8ixfPOCq4QcKXAcJq3rFvyBlLBZl3LXhkf9YYaQolm88bTVfCQi9LdqPHBWMHH3-vykzZb3dERSUdxiJXV5kk5GRJQ3bf48CwZDba4jAhr5_40uBsefabWAO32t8jlxBl-aCzetaXdGYeSRn0kXY7b5b4QhYougNN99FbO1ZGWOJfFXy4SOhcPA0hkn0L5mvS5IgmEzdx75FzuS-Q9qDl4YN1ArU7lacfDh0wXNVD1KhxVHwV_LxQwecHg_ee57tiXHPjQ"
};

// --- Global state ---
let hostState = {
    isLoggedIn: false,
    isMainHost: false,
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
    playerPanel: document.getElementById('player-panel'),
    playerLogoutBtn: document.getElementById('player-logout-btn'),
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
        if (hostState.isMainHost) {
            DOMElements.hostPanel.style.display = 'block';
            DOMElements.playerPanel.style.display = 'none';
            const publicKeyJwk = getStoredPublicKey();
            DOMElements.publicKeyDisplay.textContent = JSON.stringify(publicKeyJwk, null, 2);
        } else {
            DOMElements.hostPanel.style.display = 'none';
            DOMElements.playerPanel.style.display = 'block';
        }
    } else {
        DOMElements.authPanel.style.display = 'block';
        DOMElements.hostPanel.style.display = 'none';
        DOMElements.playerPanel.style.display = 'none';
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

/**
 * Checks if a user's public key matches the designated host's public key.
 * A simple but effective way to compare JWK objects is by their modulus (`n`).
 * @param {object} userPublicKeyJwk - The user's public key in JWK format.
 * @returns {boolean}
 */
function isUserTheHost(userPublicKeyJwk) {
    if (!userPublicKeyJwk || !HOST_PUBLIC_KEY_JWK) {
        return false;
    }
    // Comparing the 'n' (modulus) component is a reliable way to check if it's the same RSA public key.
    return userPublicKeyJwk.n === HOST_PUBLIC_KEY_JWK.n;
}

async function handleLogin() {
    const pin = DOMElements.loginPinInput.value;
    if (!pin) {
        showNotification('Please enter your PIN.', 'error');
        return;
    }

    const encryptedKey = getStoredEncryptedPrivateKey();
    const userPublicKeyJwk = getStoredPublicKey();
    try {
        const privateKey = await decryptPrivateKey(encryptedKey, pin);
        hostState.isLoggedIn = true;
        hostState.privateKey = privateKey;
        hostState.publicKey = await crypto.subtle.importKey('jwk', userPublicKeyJwk, { name: 'RSA-PSS', hash: 'SHA-256' }, true, ['verify']);
        
        // Check if the logged-in user is the designated host
        hostState.isMainHost = isUserTheHost(userPublicKeyJwk);

        const welcomeMessage = hostState.isMainHost ? 'Login successful! Welcome, Host.' : 'Login successful! Welcome, Player.';
        showNotification(welcomeMessage, 'success');
        DOMElements.loginPinInput.value = '';
        updateHostStateView();
    } catch (error) {
        console.error('Login failed:', error);
        showNotification('Incorrect PIN or corrupted keys.', 'error');
    }
}

function handleLogout() {
    hostState = { isLoggedIn: false, isMainHost: false, publicKey: null, privateKey: null };
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
    DOMElements.playerLogoutBtn.addEventListener('click', handleLogout); // Also hook up logout for player panel
    DOMElements.copyPublicKeyBtn.addEventListener('click', handleCopyPublicKey);
    DOMElements.showGenerateLink.addEventListener('click', handleShowGeneratePanel);
    
    updateHostStateView();
}

// Start the application
initialize();