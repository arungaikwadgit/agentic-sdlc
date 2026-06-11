// tests/unit/crypto.test.ts
import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../../frontend/src/utils/crypto';

describe('crypto.encrypt / decrypt', () => {
  it('round-trips plaintext through encrypt then decrypt (TS-17)', async () => {
    const plaintext = 'super-secret-token';
    const password = 'correct-horse-battery-staple';

    const payload = await encrypt(plaintext, password);
    const result = await decrypt(payload, password);

    expect(result).toBe(plaintext);
  });

  it('produces a payload with non-empty base64 ciphertext, iv, and salt (TS-18)', async () => {
    const payload = await encrypt('hello world', 'pw');

    expect(typeof payload.ciphertext).toBe('string');
    expect(typeof payload.iv).toBe('string');
    expect(typeof payload.salt).toBe('string');
    expect(payload.ciphertext.length).toBeGreaterThan(0);
    expect(payload.iv.length).toBeGreaterThan(0);
    expect(payload.salt.length).toBeGreaterThan(0);

    // base64 strings only contain these characters
    const base64Pattern = /^[A-Za-z0-9+/]+=*$/;
    expect(payload.ciphertext).toMatch(base64Pattern);
    expect(payload.iv).toMatch(base64Pattern);
    expect(payload.salt).toMatch(base64Pattern);
  });

  it('produces different ciphertext, iv, and salt across two encryptions of the same plaintext (TS-19)', async () => {
    const plaintext = 'repeat-me';
    const password = 'same-password';

    const first = await encrypt(plaintext, password);
    const second = await encrypt(plaintext, password);

    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.iv).not.toBe(second.iv);
    expect(first.salt).not.toBe(second.salt);

    // but both still decrypt correctly
    expect(await decrypt(first, password)).toBe(plaintext);
    expect(await decrypt(second, password)).toBe(plaintext);
  });

  it('rejects when decrypting with the wrong password (TS-20)', async () => {
    const payload = await encrypt('top-secret', 'right-password');

    await expect(decrypt(payload, 'wrong-password')).rejects.toThrow();
  });

  it('rejects when the ciphertext has been tampered with (TS-21)', async () => {
    const payload = await encrypt('top-secret', 'a-password');

    // Flip the payload's ciphertext to corrupt the GCM auth tag / data
    const tampered = {
      ...payload,
      ciphertext: payload.ciphertext.slice(0, -4) + (payload.ciphertext.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA'),
    };

    await expect(decrypt(tampered, 'a-password')).rejects.toThrow();
  });

  it('round-trips an empty string and unicode/multi-byte content (TS-22)', async () => {
    const password = 'pw';

    const emptyPayload = await encrypt('', password);
    expect(await decrypt(emptyPayload, password)).toBe('');

    const unicodeText = '密码 🔐 emoji and accénts';
    const unicodePayload = await encrypt(unicodeText, password);
    expect(await decrypt(unicodePayload, password)).toBe(unicodeText);
  });
});
