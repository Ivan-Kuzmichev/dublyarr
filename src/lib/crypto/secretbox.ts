import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getMasterKey } from './key';

export class SecretDecryptError extends Error {
  constructor() {
    super('Не удалось расшифровать секрет: ключ шифрования не подходит или данные повреждены');
  }
}

/** AES-256-GCM, формат `v1:base64(iv[12] | tag[16] | ciphertext)`. */
export function encrypt(plain: string, key: Buffer = getMasterKey()): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

export function decrypt(box: string, key: Buffer = getMasterKey()): string {
  if (!box.startsWith('v1:')) throw new SecretDecryptError();
  const raw = Buffer.from(box.slice(3), 'base64');
  if (raw.length < 29) throw new SecretDecryptError();
  try {
    const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch {
    throw new SecretDecryptError();
  }
}
