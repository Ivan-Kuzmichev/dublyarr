import { readdir, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';

// Служебное, что NAS и клиенты кладут в папки сами: Synology (@eaDir — миниатюры индексации), macOS по SMB (.DS_Store, ._*),
// Windows (Thumbs.db, desktop.ini), QNAP (.@__thumb). Папка, где осталось только это, для Dublyarr пуста.
const JUNK = /^(?:@eaDir|\.@__thumb|\.DS_Store|\._.+|Thumbs\.db|desktop\.ini)$/i;

export const isJunk = (name: string) => JUNK.test(name);

/** Убрать папку, если в ней ничего, кроме служебного: служебное — вместе с ней. true — убрана. */
export async function removeIfEmpty(dir: string): Promise<boolean> {
  const names = await readdir(dir).catch(() => null);
  if (!names || names.some((n) => !isJunk(n))) return false;
  for (const n of names) await rm(path.join(dir, n), { recursive: true, force: true });
  return rmdir(dir).then(
    () => true,
    () => false,
  );
}

/** От папки вверх до top (не включая его): убирать, пока пусто (или только служебное). */
export async function pruneUp(fromDir: string, top: string) {
  const stop = path.resolve(top);
  for (let dir = path.resolve(fromDir); dir.startsWith(`${stop}${path.sep}`); dir = path.dirname(dir)) {
    if (!(await removeIfEmpty(dir))) break;
  }
}
