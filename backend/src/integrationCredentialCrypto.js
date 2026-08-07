/**
 * Copyright 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
const crypto = require('crypto');

const ENVELOPE_VERSION = 1;
const STORAGE_MARKER = 'server:aes-256-gcm:v1';
const MAX_CREDENTIAL_BYTES = 64 * 1024;

class IntegrationCredentialCryptoError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'IntegrationCredentialCryptoError';
    this.code = code;
  }
}

function parseEncryptionKey(raw) {
  const value = String(raw ?? '').trim();
  if (!value) {
    throw new IntegrationCredentialCryptoError(
      'KEY_NOT_CONFIGURED',
      'Integration credential encryption is not configured.',
    );
  }

  let key;
  if (/^[a-f0-9]{64}$/i.test(value)) {
    key = Buffer.from(value, 'hex');
  } else {
    try {
      key = Buffer.from(value, 'base64');
    } catch {
      key = Buffer.alloc(0);
    }
  }
  if (key.length !== 32) {
    throw new IntegrationCredentialCryptoError(
      'KEY_INVALID',
      'APP_INTEGRATION_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters or Base64.',
    );
  }
  return key;
}

function serializeCredentials(credentials) {
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
    throw new IntegrationCredentialCryptoError(
      'CREDENTIALS_INVALID',
      'credentials must be a JSON object.',
    );
  }
  const plaintext = JSON.stringify(credentials);
  if (Buffer.byteLength(plaintext, 'utf8') > MAX_CREDENTIAL_BYTES) {
    throw new IntegrationCredentialCryptoError(
      'CREDENTIALS_TOO_LARGE',
      `credentials cannot exceed ${MAX_CREDENTIAL_BYTES} bytes.`,
    );
  }
  return plaintext;
}

function associatedData(id, provider) {
  return Buffer.from(`${id}\u0000${provider}`, 'utf8');
}

function encryptIntegrationCredentials({ id, provider, credentials, keyValue }) {
  const key = parseEncryptionKey(keyValue);
  const plaintext = serializeCredentials(credentials);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(associatedData(id, provider));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const envelope = {
    version: ENVELOPE_VERSION,
    algorithm: 'aes-256-gcm',
    nonce: nonce.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
  return {
    encryptedData: JSON.stringify(envelope),
    iv: STORAGE_MARKER,
  };
}

function decryptIntegrationCredentials({ id, provider, encryptedData, iv, keyValue }) {
  if (iv !== STORAGE_MARKER) {
    throw new IntegrationCredentialCryptoError(
      'LEGACY_RECORD',
      'This integration was encrypted by an older browser and must be saved again.',
    );
  }
  const key = parseEncryptionKey(keyValue);
  try {
    const envelope = JSON.parse(encryptedData);
    if (
      envelope?.version !== ENVELOPE_VERSION
      || envelope?.algorithm !== 'aes-256-gcm'
      || typeof envelope?.nonce !== 'string'
      || typeof envelope?.authTag !== 'string'
      || typeof envelope?.ciphertext !== 'string'
    ) {
      throw new Error('invalid envelope');
    }
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(envelope.nonce, 'base64'),
    );
    decipher.setAAD(associatedData(id, provider));
    decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(plaintext);
  } catch (error) {
    if (error instanceof IntegrationCredentialCryptoError) throw error;
    throw new IntegrationCredentialCryptoError(
      'DECRYPTION_FAILED',
      'Stored integration credentials could not be decrypted.',
    );
  }
}

module.exports = {
  ENVELOPE_VERSION,
  IntegrationCredentialCryptoError,
  MAX_CREDENTIAL_BYTES,
  STORAGE_MARKER,
  decryptIntegrationCredentials,
  encryptIntegrationCredentials,
  parseEncryptionKey,
};
