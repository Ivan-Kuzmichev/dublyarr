import { stat, writeFile, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

/** Папка существует и в неё можно писать (пробный файл создаётся и сразу удаляется). */
export async function checkWritableDir(p: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!path.isAbsolute(p)) return { ok: false, error: 'Нужен абсолютный путь' };
  try {
    if (!(await stat(p)).isDirectory()) return { ok: false, error: 'Это не папка' };
  } catch {
    return { ok: false, error: 'Папка не найдена' };
  }
  const probe = path.join(p, `.dublyarr-write-test-${randomBytes(4).toString('hex')}`);
  try {
    await writeFile(probe, '');
    await unlink(probe);
    return { ok: true };
  } catch {
    return { ok: false, error: 'Нет прав на запись' };
  }
}
