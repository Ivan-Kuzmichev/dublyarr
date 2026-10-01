import { access, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import type { Db } from './db/client';
import { oldCopies } from './db/schema';
import { getSetting, setSetting } from './settings';
import { log } from './log';
import { notifyPendingConfirm } from './notify-events';
import { formatSize } from './format';

// Правило «Старая копия после улучшения» (spec §8): удалять сразу; первое срабатывание — через подтверждение.
// До подтверждения старая копия лежит в скрытой папке медиатеки (VidHub её не показывает) и ждёт в списке.

export const OLD_DIR = '.dublyarr-old';
const CONFIRMED = 'retention.oldCopy.confirmed';

export const oldCopyRuleConfirmed = (db: Db) => getSetting<boolean>(db, CONFIRMED) === true;

/** Абсолютный путь внутри `{media}/.dublyarr-old`, иначе null. */
function insideOld(media: string, rel: string): string | null {
  const root = path.resolve(media, OLD_DIR);
  const abs = path.resolve(media, rel);
  const r = path.relative(root, abs);
  return r && !r.startsWith('..') && !path.isAbsolute(r) ? abs : null;
}

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

/** Убрать файл серии из медиатеки в скрытую папку; вернуть относительный путь там. */
export async function stashOldCopy(media: string, rel: string): Promise<string> {
  // только файл внутри медиатеки и не из самой скрытой папки — иначе испорченная запись могла бы утащить чужой файл
  const root = path.resolve(media);
  const r = path.relative(root, path.resolve(root, rel));
  if (path.isAbsolute(rel) || !r || r.startsWith('..') || path.isAbsolute(r) || r.split(path.sep)[0] === OLD_DIR) throw new Error('Путь старой копии вне медиатеки');
  let dest = path.join(OLD_DIR, r);
  for (let i = 2; await exists(path.resolve(media, dest)); i++) dest = path.join(OLD_DIR, `${r}.${i}`);
  if (!insideOld(media, dest)) throw new Error('Путь старой копии вне медиатеки');
  await mkdir(path.dirname(path.resolve(media, dest)), { recursive: true });
  await rename(path.resolve(media, rel), path.resolve(media, dest));
  return dest;
}

/** Вернуть старую копию на место (импорт новой не удался). */
export const restoreOldCopy = (media: string, stashed: string, rel: string) => rename(path.resolve(media, stashed), path.resolve(media, rel));

/** Спрятанная старая копия: правило подтверждено — удалить, иначе — в список на подтверждение. */
export async function settleOldCopy(db: Db, media: string, stashed: string, row: { titleId: number; season: number; number: number }, reason: string, now: number) {
  const abs = insideOld(media, stashed);
  if (!abs) throw new Error('Путь старой копии вне скрытой папки');
  if (oldCopyRuleConfirmed(db)) {
    await rm(abs, { force: true });
    return;
  }
  const size = await stat(abs).then(
    (s) => s.size,
    () => 0,
  );
  db.insert(oldCopies).values({ ...row, path: stashed, size, reason, createdAt: now }).run();
  const sum = oldCopiesSummary(db);
  notifyPendingConfirm(db, 'old-copies', `🗂 Старые копии после улучшения ждут подтверждения удаления: ${sum.count} · ${formatSize(sum.size)}`, now);
}

/** Подтверждение правила: удалить отмеченные старые копии; дальше правило работает само. */
export async function confirmOldCopies(db: Db, media: string, deleteIds: number[]) {
  const res = { deleted: 0, freed: 0, refused: 0 };
  const rows = deleteIds.length ? db.select().from(oldCopies).where(inArray(oldCopies.id, deleteIds)).all() : [];
  for (const r of rows) {
    const abs = insideOld(media, r.path);
    if (!abs) {
      res.refused++;
      log.warn({ oldCopy: r.id }, 'old copy path outside hidden folder');
      continue;
    }
    await rm(abs, { force: true });
    db.delete(oldCopies).where(eq(oldCopies.id, r.id)).run();
    res.deleted++;
    res.freed += r.size;
  }
  setSetting(db, CONFIRMED, true);
  return res;
}

export function oldCopiesSummary(db: Db) {
  const rows = db.select().from(oldCopies).all();
  return { count: rows.length, size: rows.reduce((n, r) => n + r.size, 0) };
}
