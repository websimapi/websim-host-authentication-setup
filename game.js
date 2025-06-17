import {
    keysExist,
    generateAndStoreKeys,
    getStoredPublicKey,
    getStoredEncryptedPrivateKey,
    decryptPrivateKey,
    clearStoredKeys
} from './auth.js';

// --- Hardcoded Host Public Key ---
const HOST_PUBLIC_KEY_JWK = {
  "alg": "PS256",
  "e": "AQAB",
  "ext": true,
  "key_ops": [
    "verify"
  ],
  "kty": "RSA",
  "n": "svKIby5x7ffPEkjkw0BKLaPD7ODkFblSB9JbEB_vfZI_EcHO4gIU5dpniJ7HDrG2BUVjrpGY0NL-jFhojoc0gE-KZIGbGGroft8SluTSCzgCXFBrvgh8R7X165lNC24x6Auhjepi55TjASWguw4HJv65ndKiPL3Js3YN1LIQ-v01Dm6QtG2bDvO59sBdm5RbmSRLEmwadOPZjNYE5W6DpFTfyOL4xCi-cD9kZQjY6hArJFmPDWRmhbiDseiacZ_8DdhZ4BAAWz-hTWgl9rQl7vwuf7ONFj3-uTsLs6gYCmJL15hhQCsQ28rpRUcycezbEsxfwsdJ72RVFnWruUyiHQ"
};

// --- Multiplayer Setup ---
const room = new WebsimSocket();

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
    
    playerPanel: document.getElementById('player-panel'),
    playerStatusText: document.getElementById('player-status-text'),
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
        // This browser belongs to the host
        DOMElements.pinSetupPanel.style.display = 'none';
        DOMElements.pinLoginPanel.style.display = 'block';
        DOMElements.playerPanel.style.display = 'none';
        DOMElements.authPanel.style.display = 'block';
    } else {
        // This browser belongs to a player
        DOMElements.pinSetupPanel.style.display = 'none';
        DOMElements.pinLoginPanel.style.display = 'none';
        DOMElements.authPanel.style.display = 'none';
        DOMElements.hostPanel.style.display = 'none';
        DOMElements.playerPanel.style.display = 'block';
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

// --- Multiplayer Logic ---

function handlePresenceUpdate(presence) {
    const hostId = findHost(presence);
    if (hostId) {
        if (keysExist()) { // This is the host client
             // Host is connected and verified, normal game operation can proceed.
        } else { // This is a player client
            DOMElements.playerStatusText.textContent = `Host '${room.peers[hostId].username}' is connected. The game can begin!`;
            DOMElements.playerStatusText.style.color = '#28a745'; // Green color for success
        }
    } else {
        if (!keysExist()) { // Player client
            DOMElements.playerStatusText.textContent = 'Waiting for the host to connect...';
            DOMElements.playerStatusText.style.color = '#ccc';
        }
    }
}

function findHost(presence) {
    for (const clientId in presence) {
        if (presence[clientId].isHost) {
            return clientId;
        }
    }
    return null;
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
        // After generating keys, a "login" is required.
        // We will just update the view to show the login panel.
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

        // Verify the decrypted key matches the hardcoded public key
        const decryptedPublicKey = await crypto.subtle.exportKey('jwk', 
            (await crypto.subtle.importKey('pkcs8', await crypto.subtle.exportKey('pkcs8', privateKey), KEY_ALGORITHM, true, ['sign'])).publicKey
        );
        
        // Simple comparison of the 'n' parameter of the JWK
        if (decryptedPublicKey.n !== HOST_PUBLIC_KEY_JWK.n) {
             showNotification('Keys in storage do not match the official host key.', 'error');
             return;
        }

        hostState.isLoggedIn = true;
        hostState.privateKey = privateKey;
        hostState.publicKey = await crypto.subtle.importKey('jwk', getStoredPublicKey(), { name: 'RSA-PSS', hash: 'SHA-256' }, true, ['verify']);
        
        showNotification('Login successful! Welcome, Host.', 'success');
        DOMElements.loginPinInput.value = '';
        updateHostStateView();

        // Announce to the room that this client is the host
        room.updatePresence({ isHost: true });

    } catch (error) {
        console.error('Login failed:', error);
        showNotification('Incorrect PIN or corrupted keys.', 'error');
    }
}

function handleLogout() {
    hostState = { isLoggedIn: false, publicKey: null, privateKey: null };
    // Announce departure as host
    room.updatePresence({ isHost: null });
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

async function initialize() {
    DOMElements.generateKeysBtn.addEventListener('click', handleGenerateKeys);
    DOMElements.loginBtn.addEventListener('click', handleLogin);
    DOMElements.logoutBtn.addEventListener('click', handleLogout);
    DOMElements.copyPublicKeyBtn.addEventListener('click', handleCopyPublicKey);
    DOMElements.showGenerateLink.addEventListener('click', handleShowGeneratePanel);
    
    // Initial UI state based on whether keys are in localStorage
    updateHostStateView();
    
    // Initialize multiplayer connection
    try {
        await room.initialize();
        console.log('Connected to room. Client ID:', room.clientId);
        
        // Set initial presence. If host keys exist, we are potentially the host.
        // The `isHost` flag will be set to true upon successful login.
        room.updatePresence({ isHost: false });

        room.subscribePresence(handlePresenceUpdate);
        
        // Initial check
        handlePresenceUpdate(room.presence);

    } catch (error) {
        console.error("Failed to initialize multiplayer connection:", error);
        showNotification("Could not connect to the server.", "error", 5000);
    }
}

// Start the application
initialize();