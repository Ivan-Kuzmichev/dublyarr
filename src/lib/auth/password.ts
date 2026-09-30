import { hash, verify } from '@node-rs/argon2';

/** argon2id с параметрами библиотеки по умолчанию. */
export const hashPassword = (p: string) => hash(p);

export async function verifyPassword(h: string, p: string): Promise<boolean> {
  try {
    return await verify(h, p);
  } catch {
    return false;
  }
}

export function validateNewPassword(p: string): string | null {
  return p.length < 10 ? 'Пароль — не короче 10 символов' : null;
}
