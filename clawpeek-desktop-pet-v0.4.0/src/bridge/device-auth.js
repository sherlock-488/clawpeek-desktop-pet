const DEVICE_IDENTITY_STORAGE_KEY = 'clawpeek.gatewayDevice.v1';

function getStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function getSubtleCrypto() {
  return globalThis.crypto?.subtle ?? null;
}

function getDesktopCrypto() {
  return globalThis.window?.desktopPetAPI?.crypto ?? null;
}

function utf8Bytes(value) {
  return new TextEncoder().encode(value);
}

function bytesToBase64Url(bytes) {
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function sha256Hex(bytes) {
  const desktopCrypto = getDesktopCrypto();
  if (desktopCrypto?.sha256HexFromBytes) {
    return desktopCrypto.sha256HexFromBytes(Array.from(bytes));
  }

  const subtle = getSubtleCrypto();
  if (!subtle) throw new Error('Web Crypto is unavailable');

  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function exportPublicKeyRaw(publicKey) {
  const subtle = getSubtleCrypto();
  if (!subtle) throw new Error('Web Crypto is unavailable');

  try {
    return new Uint8Array(await subtle.exportKey('raw', publicKey));
  } catch {
    const jwk = await subtle.exportKey('jwk', publicKey);
    if (!jwk.x) throw new Error('Public key export failed');
    return base64UrlToBytes(jwk.x);
  }
}

async function createDeviceIdentity() {
  const desktopCrypto = getDesktopCrypto();
  if (desktopCrypto?.createEd25519Identity) {
    return desktopCrypto.createEd25519Identity();
  }

  const subtle = getSubtleCrypto();
  if (!subtle) return null;

  const keyPair = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKeyRaw = await exportPublicKeyRaw(keyPair.publicKey);
  const privateKeyPkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', keyPair.privateKey));
  const deviceId = await sha256Hex(publicKeyRaw);

  return {
    deviceId,
    publicKey: bytesToBase64Url(publicKeyRaw),
    privateKeyPkcs8: bytesToBase64Url(privateKeyPkcs8),
  };
}

async function importPrivateKey(privateKeyPkcs8) {
  const subtle = getSubtleCrypto();
  if (!subtle) throw new Error('Web Crypto is unavailable');

  return subtle.importKey(
    'pkcs8',
    base64UrlToBytes(privateKeyPkcs8),
    { name: 'Ed25519' },
    false,
    ['sign']
  );
}

function readStoredIdentity() {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(DEVICE_IDENTITY_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.deviceId !== 'string'
      || typeof parsed?.publicKey !== 'string'
      || typeof parsed?.privateKeyPkcs8 !== 'string'
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function writeStoredIdentity(identity) {
  const storage = getStorage();
  if (!storage || !identity) return;

  storage.setItem(DEVICE_IDENTITY_STORAGE_KEY, JSON.stringify({
    deviceId: identity.deviceId,
    publicKey: identity.publicKey,
    privateKeyPkcs8: identity.privateKeyPkcs8,
  }));
}

async function validateStoredIdentity(identity) {
  if (!identity) return null;

  const desktopCrypto = getDesktopCrypto();
  if (desktopCrypto?.signEd25519) {
    try {
      desktopCrypto.signEd25519({ privateKeyPkcs8: identity.privateKeyPkcs8, payload: 'clawpeek:validate' });
      return identity;
    } catch {
      return null;
    }
  }

  try {
    await importPrivateKey(identity.privateKeyPkcs8);
    return identity;
  } catch {
    return null;
  }
}

export function buildDeviceAuthPayload({
  deviceId,
  clientId,
  clientMode,
  role,
  scopes,
  signedAtMs,
  token,
  nonce,
}) {
  return [
    'v2',
    deviceId,
    clientId,
    clientMode,
    role,
    Array.isArray(scopes) ? scopes.join(',') : '',
    String(signedAtMs),
    token ?? '',
    nonce,
  ].join('|');
}

export async function loadOrCreateDeviceIdentity() {
  const stored = await validateStoredIdentity(readStoredIdentity());
  if (stored) return stored;

  const identity = await createDeviceIdentity();
  writeStoredIdentity(identity);
  return identity;
}

export async function signDevicePayload(identity, payload) {
  const desktopCrypto = getDesktopCrypto();
  if (desktopCrypto?.signEd25519) {
    return desktopCrypto.signEd25519({
      privateKeyPkcs8: identity.privateKeyPkcs8,
      payload,
    });
  }

  const subtle = getSubtleCrypto();
  if (!subtle) throw new Error('Web Crypto is unavailable');

  const privateKey = await importPrivateKey(identity.privateKeyPkcs8);
  const signature = await subtle.sign({ name: 'Ed25519' }, privateKey, utf8Bytes(payload));
  return bytesToBase64Url(new Uint8Array(signature));
}
