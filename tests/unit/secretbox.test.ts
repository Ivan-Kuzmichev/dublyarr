import { expect, test } from 'vitest';
import { mkdtempSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt, SecretDecryptError } from '@/lib/crypto/secretbox';
import { loadMasterKey } from '@/lib/crypto/key';

const key = randomBytes(32);

test('шифрование туда-обратно, каждый раз разный шифротекст', () => {
  const a = encrypt('токен', key);
  const b = encrypt('токен', key);
  expect(a).toMatch(/^v1:/);
  expect(a).not.toBe(b);
  expect(decrypt(a, key)).toBe('токен');
});

test('чужой ключ или испорченные данные — SecretDecryptError', () => {
  const box = encrypt('x', key);
  expect(() => decrypt(box, randomBytes(32))).toThrow(SecretDecryptError);
  expect(() => decrypt('v1:AAAA', key)).toThrow(SecretDecryptError);
  expect(() => decrypt('plain', key)).toThrow(SecretDecryptError);
});

test('ключ из env: base64 32 байта', () => {
  const k = randomBytes(32);
  expect(loadMasterKey({ dataDir: '/nonexistent', secretKeyEnv: k.toString('base64') }).equals(k)).toBe(true);
  expect(() => loadMasterKey({ dataDir: '/nonexistent', secretKeyEnv: 'short' })).toThrow(/32 байт/);
});

test('без env ключ генерируется в файл 0600 и переживает перезапуск', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dy-'));
  const k1 = loadMasterKey({ dataDir: dir, secretKeyEnv: undefined });
  const file = path.join(dir, 'secret.key');
  expect(statSync(file).mode & 0o777).toBe(0o600);
  const k2 = loadMasterKey({ dataDir: dir, secretKeyEnv: undefined });
  expect(k2.equals(k1)).toBe(true);
  expect(readFileSync(file, 'utf8').trim()).toBe(k1.toString('base64'));
});
