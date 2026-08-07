/**
 * Copyright 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
export {};
const {
  decryptIntegrationCredentials,
  encryptIntegrationCredentials,
  parseEncryptionKey,
} = require('./integrationCredentialCrypto');

describe('integration credential envelope encryption', () => {
  const key = '11'.repeat(32);

  it('round-trips credentials with authenticated encryption without plaintext leakage', () => {
    const credentials = { token: 'secret-token', owner: 'team', repo: 'app' };
    const encrypted = encryptIntegrationCredentials({
      id: 'integration-1',
      provider: 'github',
      credentials,
      keyValue: key,
    });

    expect(encrypted.iv).toBe('server:aes-256-gcm:v1');
    expect(encrypted.encryptedData).not.toContain('secret-token');
    expect(decryptIntegrationCredentials({
      id: 'integration-1',
      provider: 'github',
      ...encrypted,
      keyValue: key,
    })).toEqual(credentials);
  });

  it('binds ciphertext to the integration identity and rejects tampering', () => {
    const encrypted = encryptIntegrationCredentials({
      id: 'integration-1',
      provider: 'github',
      credentials: { token: 'secret' },
      keyValue: key,
    });
    expect(() => decryptIntegrationCredentials({
      id: 'integration-2',
      provider: 'github',
      ...encrypted,
      keyValue: key,
    })).toThrow(/could not be decrypted/i);
  });

  it('rejects missing, weak, malformed, and legacy encryption state', () => {
    expect(() => parseEncryptionKey('')).toThrow(/not configured/i);
    expect(() => parseEncryptionKey('too-short')).toThrow(/32 bytes/i);
    expect(() => encryptIntegrationCredentials({
      id: 'i1',
      provider: 'github',
      credentials: [],
      keyValue: key,
    })).toThrow(/JSON object/i);
    expect(() => decryptIntegrationCredentials({
      id: 'i1',
      provider: 'github',
      encryptedData: '{}',
      iv: 'browser-iv',
      keyValue: key,
    })).toThrow(/older browser/i);
  });
});
