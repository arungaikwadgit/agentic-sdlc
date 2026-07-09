/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * AES-GCM encryption/decryption using Web Crypto API.
 * Key is derived from a password via PBKDF2 (SHA-256, 100k iterations).
 * Used for encrypting integration credentials before storing them via backend APIs.
 */

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function toBase64(buf: ArrayBuffer | Uint8Array<ArrayBuffer>): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(str: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

export interface EncryptedPayload {
  ciphertext: string; // base64
  iv: string;         // base64
  salt: string;       // base64
}

export async function encrypt(plaintext: string, password: string): Promise<EncryptedPayload> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES)) as Uint8Array<ArrayBuffer>;
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES)) as Uint8Array<ArrayBuffer>;
  const key = await deriveKey(password, salt);

  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext)
  );

  return {
    ciphertext: toBase64(cipherBuf),
    iv: toBase64(iv),
    salt: toBase64(salt),
  };
}

export async function decrypt(payload: EncryptedPayload, password: string): Promise<string> {
  const dec = new TextDecoder();
  const salt = fromBase64(payload.salt);
  const iv = fromBase64(payload.iv);
  const key = await deriveKey(password, salt);

  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    fromBase64(payload.ciphertext)
  );

  return dec.decode(plainBuf);
}
