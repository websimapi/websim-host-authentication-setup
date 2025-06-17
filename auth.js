// --- Cryptographic constants ---
const KEY_ALGORITHM = {
    name: 'RSA-PSS',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
};
const ENCRYPTION_ALGORITHM = 'AES-GCM';
const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

// --- Local Storage Keys ---
const PUBLIC_KEY_STORE = 'hostPublicKey';
const PRIVATE_KEY_STORE = 'hostEncryptedPrivateKey';

// --- Helper Functions ---

/**
 * Converts a buffer to a Base64 string.
 * @param {ArrayBuffer} buffer - The buffer to convert.
 * @returns {string} The Base64 encoded string.
 */
function bufferToBase64(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

/**
 * Converts a Base64 string back to a buffer.
 * @param {string} base64 - The Base64 string.
 * @returns {ArrayBuffer} The decoded buffer.
 */
function base64ToBuffer(base64) {
    const str = atob(base64);
    const buffer = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
        buffer[i] = str.charCodeAt(i);
    }
    return buffer.buffer;
}

/**
 * Derives an encryption key from a user's PIN using PBKDF2.
 * @param {string} pin - The user's PIN.
 * @param {ArrayBuffer} salt - The salt for the key derivation.
 * @returns {Promise<CryptoKey>} The derived CryptoKey for AES-GCM.
 */
async function deriveKeyFromPin(pin, salt) {
    const pinBuffer = new TextEncoder().encode(pin);
    const masterKey = await crypto.subtle.importKey(
        'raw',
        pinBuffer,
        'PBKDF2',
        false,
        ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        masterKey,
        { name: ENCRYPTION_ALGORITHM, length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
}

// --- Core API ---

/**
 * Checks if host keys exist in local storage.
 * @returns {boolean} True if keys are found, false otherwise.
 */
export function keysExist() {
    return !!localStorage.getItem(PUBLIC_KEY_STORE) && !!localStorage.getItem(PRIVATE_KEY_STORE);
}

/**
 * Generates a new RSA public/private key pair.
 * @returns {Promise<{publicKey: CryptoKey, privateKey: CryptoKey}>} The generated key pair.
 */
async function generateRsaKeys() {
    return await crypto.subtle.generateKey(KEY_ALGORITHM, true, ['sign']);
}

/**
 * Encrypts a private key using a PIN.
 * @param {CryptoKey} privateKey - The private key to encrypt.
 * @param {string} pin - The user's PIN.
 * @returns {Promise<string>} A JSON string containing the encrypted key and metadata.
 */
async function encryptPrivateKey(privateKey, pin) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encryptionKey = await deriveKeyFromPin(pin, salt);
    
    const keyData = await crypto.subtle.exportKey('pkcs8', privateKey);
    
    const encryptedData = await crypto.subtle.encrypt(
        { name: ENCRYPTION_ALGORITHM, iv },
        encryptionKey,
        keyData
    );
    
    return JSON.stringify({
        salt: bufferToBase64(salt),
        iv: bufferToBase64(iv),
        data: bufferToBase64(encryptedData)
    });
}

/**
 * Decrypts a private key using a PIN.
 * @param {string} encryptedKeyJson - The JSON string of the encrypted key.
 * @param {string} pin - The user's PIN.
 * @returns {Promise<CryptoKey>} The decrypted private key.
 */
export async function decryptPrivateKey(encryptedKeyJson, pin) {
    const { salt: saltB64, iv: ivB64, data: dataB64 } = JSON.parse(encryptedKeyJson);
    const salt = base64ToBuffer(saltB64);
    const iv = base64ToBuffer(ivB64);
    const data = base64ToBuffer(dataB64);

    const decryptionKey = await deriveKeyFromPin(pin, salt);

    const decryptedData = await crypto.subtle.decrypt(
        { name: ENCRYPTION_ALGORITHM, iv },
        decryptionKey,
        data
    );

    return crypto.subtle.importKey(
        'pkcs8',
        decryptedData,
        KEY_ALGORITHM,
        true,
        ['sign']
    );
}

/**
 * Generates, encrypts, and stores new host keys.
 * @param {string} pin - The PIN to protect the private key.
 * @returns {Promise<void>}
 */
export async function generateAndStoreKeys(pin) {
    const { publicKey, privateKey } = await generateRsaKeys();
    
    const encryptedPrivateKeyJson = await encryptPrivateKey(privateKey, pin);
    const publicKeyJwk = await crypto.subtle.exportKey('jwk', publicKey);

    localStorage.setItem(PUBLIC_KEY_STORE, JSON.stringify(publicKeyJwk));
    localStorage.setItem(PRIVATE_KEY_STORE, encryptedPrivateKeyJson);
}

/**
 * Retrieves the stored public key JWK.
 * @returns {object|null} The public key as a JWK object, or null if not found.
 */
export function getStoredPublicKey() {
    const jwkString = localStorage.getItem(PUBLIC_KEY_STORE);
    return jwkString ? JSON.parse(jwkString) : null;
}

/**
 * Retrieves the stored encrypted private key.
 * @returns {string|null} The encrypted private key JSON string, or null if not found.
 */
export function getStoredEncryptedPrivateKey() {
    return localStorage.getItem(PRIVATE_KEY_STORE);
}

/**
 * Clears all host keys from local storage.
 */
export function clearStoredKeys() {
    localStorage.removeItem(PUBLIC_KEY_STORE);
    localStorage.removeItem(PRIVATE_KEY_STORE);
}