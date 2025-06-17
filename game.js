import * as THREE from 'three';
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

// --- Multiplayer ---
const room = new WebsimSocket();

// --- 3D Scene ---
let scene, camera, renderer, cube;
let animationFrameId;
const sceneObjects = {}; // To map game state objects to three.js objects
let controls; // To be defined if OrbitControls are used

// --- Global state ---
let hostState = {
    isLoggedIn: false,
    isMainHost: false,
    publicKey: null,
    privateKey: null,
    gameActive: false,
};

// --- UI Elements ---
const DOMElements = {
    appContainer: document.getElementById('app-container'),
    authContainer: document.getElementById('auth-container'),
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
    gameWorldPanel: document.getElementById('game-world-panel'),
    hostStatus: document.getElementById('host-status'),
    playerList: document.getElementById('player-list'),
};

// --- UI Logic ---

/**
 * Updates UI text based on whether a main host is configured.
 */
function configureUITextForEstablishedHost() {
    // A main host is considered "established" if its public key is hardcoded in the client.
    const hostIsEstablished = HOST_PUBLIC_KEY_JWK && HOST_PUBLIC_KEY_JWK.n;

    if (hostIsEstablished) {
        // Change text from "Host..." to more generic "User..." or "Your..." terms
        // since any user who is not THE host is just a regular user.
        DOMElements.authContainer.querySelector('h1').textContent = 'User Authentication';
        DOMElements.authPanel.querySelector('h2').textContent = 'User Setup & Login';
        
        const pinSetupPanel = DOMElements.pinSetupPanel;
        pinSetupPanel.querySelector('h3').textContent = '1. Generate Your Keys';
        pinSetupPanel.querySelector('p').textContent = "If you don't have keys yet, create them here. This only needs to be done once.";
        DOMElements.generateKeysBtn.textContent = 'Generate User Keys';

        const pinLoginPanel = DOMElements.pinLoginPanel;
        pinLoginPanel.querySelector('h3').textContent = '2. Login';
        pinLoginPanel.querySelector('p').textContent = 'If you have already generated keys, enter your PIN to log in.';
        DOMElements.loginBtn.textContent = 'Login as User';
    }
    // If no host is established, the default HTML text ("Host...") is appropriate.
}

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
    // Make sure it's visible if it was hidden
    notificationBar.style.display = 'block';
    setTimeout(() => {
        // Hide it by changing class, not display property, to allow transitions
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
        hostState.gameActive = false;
        updateAuthViewState();
        teardownGameWorld();
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
        connectToRoom(); // Connect to multiplayer room after login
    } catch (error) {
        console.error('Login failed:', error);
        showNotification('Incorrect PIN or corrupted keys.', 'error');
    }
}

function handleLogout() {
    hostState = { isLoggedIn: false, isMainHost: false, publicKey: null, privateKey: null };
    showNotification('You have been logged out.', 'success');
    updateHostStateView();
    // No need to disconnect, WebsimSocket handles browser close/refresh
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


// --- Player Character ---

function createStickCharacter() {
    const character = new THREE.Group();

    const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0xffdbac })
    );
    head.position.y = 1.5;

    const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 1, 8),
        new THREE.MeshStandardMaterial({ color: 0x333333 })
    );
    body.position.y = 0.75;
    
    character.add(head);
    character.add(body);

    // Simple placeholder for character body
    character.position.y = 0.5; // Sit on top of the terrain plane

    return character;
}


// --- 3D Scene Logic ---

function initializeGameWorld() {
    if (hostState.gameActive) return; // Already initialized
    console.log("Host detected. Initializing game world...");
    hostState.gameActive = true;

    // Hide auth/lobby UI and show game world
    DOMElements.authContainer.style.display = 'none';
    DOMElements.gameWorldPanel.style.display = 'block';
    DOMElements.appContainer.classList.add('in-game');


    // Basic Three.js setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);
    
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 20, 25);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    DOMElements.gameWorldPanel.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(-10, 20, 10);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    // Terrain
    const terrainGeometry = new THREE.PlaneGeometry(256, 256);
    const terrainMaterial = new THREE.MeshStandardMaterial({ color: 0x228B22 }); // ForestGreen
    const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
    terrain.rotation.x = -Math.PI / 2;
    scene.add(terrain);
    
    window.addEventListener('resize', onWindowResize);
    animate();
}

function teardownGameWorld() {
    if (!hostState.gameActive) return;
    console.log("Host left. Tearing down game world.");
    
    cancelAnimationFrame(animationFrameId);
    if (renderer) {
        DOMElements.gameWorldPanel.removeChild(renderer.domElement);
        renderer.dispose();
    }
    
    DOMElements.playerList.innerHTML = '';
    DOMElements.authContainer.style.display = 'block';
    DOMElements.gameWorldPanel.style.display = 'none';
    DOMElements.appContainer.classList.remove('in-game');

    // Clear scene objects
    for (const key in sceneObjects) {
        delete sceneObjects[key];
    }
    
    hostState.gameActive = false;
    updateHostStateView();
}


function onWindowResize() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    animationFrameId = requestAnimationFrame(animate);

    // Host-specific logic
    if (hostState.isMainHost) {
        // In a real game, host would calculate physics and update state here.
        // For now, we'll just keep players at their initial positions.
    }

    // All clients render based on roomState
    if (room.roomState.players) {
        const gamePlayers = room.roomState.players;
        for (const playerId in gamePlayers) {
            const data = gamePlayers[playerId];
            const obj = sceneObjects[playerId];
            if (obj && data) {
                obj.position.set(data.x, 0, data.z);
            }
        }
    }

    if(renderer) renderer.render(scene, camera);
}


// --- Multiplayer Logic ---

async function connectToRoom() {
    await room.initialize();
    
    console.log("Connected to room. My client ID:", room.clientId);
    
    // Set initial presence. If host, announce it.
    const initialPresence = {
        isHost: hostState.isMainHost,
        loggedIn: true,
        x: Math.random() * 20 - 10,
        z: Math.random() * 20 - 10,
    };
    room.updatePresence(initialPresence);

    // Host initializes game state
    if (hostState.isMainHost && !room.roomState.players) {
        console.log("I am the host. Initializing room state.");
        room.updateRoomState({
            players: {}
        });
    }

    room.subscribePresence(handlePresenceUpdate);
    room.subscribeRoomState(handleRoomStateUpdate);
}

function handlePresenceUpdate() {
    let hostFound = false;
    let hostUsername = 'N/A';
    const playerUsernames = [];

    const currentPlayers = room.roomState.players || {};
    
    for (const clientId in room.presence) {
        const peer = room.peers[clientId];
        const presence = room.presence[clientId];

        if (presence?.isHost) {
            hostFound = true;
            hostUsername = peer?.username || 'Host';
        }
        if (peer && presence?.loggedIn) {
             playerUsernames.push(peer.username);
        }

        // Host logic: check if player needs to be added to room state
        if (hostState.isMainHost && presence?.loggedIn && !currentPlayers[clientId]) {
            console.log(`Host: adding player ${clientId} to the game.`);
            room.updateRoomState({
                players: {
                    [clientId]: {
                        x: presence.x,
                        z: presence.z,
                    }
                }
            });
        }
    }

    // Host logic: check for disconnected players
    if (hostState.isMainHost) {
        const newPlayerState = { ...currentPlayers };
        let changed = false;
        for(const playerId in newPlayerState) {
            if (!room.presence[playerId] || !room.presence[playerId].loggedIn) {
                console.log(`Host: removing player ${playerId} from the game.`);
                newPlayerState[playerId] = null; // Mark for deletion
                changed = true;
            }
        }
        if (changed) {
            room.updateRoomState({ players: newPlayerState });
        }
    }


    if (hostFound && !hostState.gameActive) {
        initializeGameWorld();
    } else if (!hostFound && hostState.gameActive) {
        teardownGameWorld();
    }

    if(hostState.gameActive) {
        DOMElements.hostStatus.textContent = `Host: ${hostUsername}`;
        DOMElements.playerList.innerHTML = `Players: ${playerUsernames.join(', ')}`;
    }
}

function handleRoomStateUpdate(currentRoomState) {
    if (!hostState.gameActive || !scene) return;
    
    const gamePlayers = currentRoomState.players || {};

    // Add new players / characters
    for (const playerId in gamePlayers) {
        if (!sceneObjects[playerId] && gamePlayers[playerId]) {
            console.log(`Creating new character for: ${playerId}`);
            const character = createStickCharacter();
            
            // Customize color based on client ID to differentiate players
            const color = new THREE.Color().setHSL(parseInt(playerId.substring(0, 8), 36) / 1e12, 0.8, 0.7);
            character.traverse((child) => {
                 if (child.isMesh && child.geometry.type === 'CylinderGeometry') {
                    child.material.color.set(color);
                }
            });

            sceneObjects[playerId] = character;
            scene.add(character);
        }
    }

    // Remove old players / characters
     for (const playerId in sceneObjects) {
        if (!gamePlayers[playerId]) {
            console.log(`Removing character for: ${playerId}`);
            const obj = sceneObjects[playerId];
            scene.remove(obj);
            obj.traverse(child => {
                if (child.isMesh) {
                    child.geometry.dispose();
                    child.material.dispose();
                }
            });
            delete sceneObjects[playerId];
        }
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
    
    // Configure UI text based on whether a host key is defined in the client
    configureUITextForEstablishedHost();
    
    updateHostStateView();
}

// Start the application
initialize();