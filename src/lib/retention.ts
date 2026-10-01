import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from './db/client';
import { deletions, episodeFiles, episodes, oldCopies, seasons, subscriptions, titles } from './db/schema';
import { readdir, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { getSetting, setSetting } from './settings';
import { OLD_DIR } from './old-copies';
import { notifyPendingConfirm } from './notify-events';
import { formatSize } from './format';
import { log } from './log';
import type { RetentionSettings } from './retention-settings';

// Правила хранения (spec §8): что удалило бы каждое правило. Удаляются только файлы, записанные Dublyarr.

export type RetentionRule = 'seasons' | 'oldCopy' | 'age';
export type RetentionFile = { episodeFileId?: number; oldCopyId?: number; path: string; size: number };
export type RetentionItem = { key: string; rule: RetentionRule; titleId: number; label: string; why: string; files: RetentionFile[]; size: number };

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const sRange = (a: number, b: number) => (a === b ? `S${pad(a)}` : `S${pad(a)}–S${pad(b)}`);

/** Подпись правила сезонов для сериала и сезоны, которые оно удалило бы сейчас. */
export function seasonRule(db: Db, titleId: number, settings: RetentionSettings, today: string): { label: string; drop: number[] } {
  const sub = db.select().from(subscriptions).where(eq(subscriptions.titleId, titleId)).get();
  const t = db.select().from(titles).where(eq(titles.id, titleId)).get();
  if (!sub || !t) return { label: '', drop: [] };
  if (sub.keepAll) return { label: 'исключение: все', drop: [] };
  const eps = db.select().from(episodes).where(eq(episodes.titleId, titleId)).all().filter((e) => e.season > 0);
  const nums = [...new Set(db.select().from(seasons).where(eq(seasons.titleId, titleId)).all().map((s) => s.number))].filter((n) => n > 0).sort((a, b) => a - b);
  if (!nums.length) return { label: '', drop: [] };
  const ended = t.status === 'ended' || t.status === 'canceled';
  if (!settings.seasons.on) return { label: ended ? 'завершён' : 'все сезоны', drop: [] };
  if (ended && settings.seasons.ended === 'keep') return { label: 'завершён', drop: [] };

  const files = db.select().from(episodeFiles).where(eq(episodeFiles.titleId, titleId)).all();
  const complete = (s: number) => {
    const aired = eps.filter((e) => e.season === s && e.airDate && e.airDate <= today);
    return aired.length > 0 && aired.every((e) => files.some((f) => f.season === s && f.number === e.number && (f.dubPosition === null || f.dubPosition === 0)));
  };
  const keep = settings.seasons.keep;
  if (ended) {
    const last = nums.at(-1)!;
    const kept = nums.slice(-keep);
    return { label: keep === 1 ? 'последний' : `последние ${keep}`, drop: complete(last) ? nums.filter((n) => !kept.includes(n)) : [] };
  }
  // выходящий — последний сезон с будущими или недатированными сериями; в перерыве — просто последний
  const upcoming = [...nums].reverse().find((n) => eps.some((e) => e.season === n && (!e.airDate || e.airDate > today))) ?? nums.at(-1)!;
  const before = nums.filter((n) => n < upcoming);
  const kept = before.slice(-keep);
  const label = kept.length ? `${sRange(kept[0], kept.at(-1)!)} + выходящий` : 'выходящий';
  return { label, drop: complete(upcoming) ? before.filter((n) => !kept.includes(n)) : [] };
}

export function retentionPlan(db: Db, settings: RetentionSettings, now: number, today: string): RetentionItem[] {
  const items: RetentionItem[] = [];
  const subs = db.select({ s: subscriptions, title: titles.nameRu }).from(subscriptions).innerJoin(titles, eq(titles.id, subscriptions.titleId)).all();
  const name = new Map(db.select({ id: titles.id, n: titles.nameRu }).from(titles).all().map((x) => [x.id, x.n]));

  for (const { s, title } of subs) {
    const { drop } = seasonRule(db, s.titleId, settings, today);
    if (!drop.length) continue;
    const files = db.select().from(episodeFiles).where(and(eq(episodeFiles.titleId, s.titleId), inArray(episodeFiles.season, drop))).all();
    if (!files.length) continue;
    const ended = db.select({ st: titles.status }).from(titles).where(eq(titles.id, s.titleId)).get()?.st;
    items.push({
      key: `s:${s.titleId}:${drop.join(',')}`,
      rule: 'seasons',
      titleId: s.titleId,
      label: `${title} · ${sRange(Math.min(...drop), Math.max(...drop))}`,
      why: ended === 'ended' || ended === 'canceled' ? 'сериал завершён, остаются последние сезоны' : 'старше последнего вышедшего сезона',
      files: files.map((f) => ({ episodeFileId: f.id, path: f.path, size: f.size })),
      size: files.reduce((n, f) => n + f.size, 0),
    });
  }

  const minAge = settings.oldCopy === '3days' ? 3 * DAY : 0;
  for (const c of db.select().from(oldCopies).all()) {
    if (now - c.createdAt < minAge) continue;
    items.push({
      key: `o:${c.id}`,
      rule: 'oldCopy',
      titleId: c.titleId,
      label: `${name.get(c.titleId) ?? '?'} · S${pad(c.season)}E${pad(c.number)}`,
      why: `старая копия: ${c.reason}`,
      files: [{ oldCopyId: c.id, path: c.path, size: c.size }],
      size: c.size,
    });
  }

  const cutoff = now - settings.age.days * DAY;
  for (const { s, title } of subs.filter((x) => x.s.autoDelete)) {
    for (const f of db.select().from(episodeFiles).where(eq(episodeFiles.titleId, s.titleId)).all()) {
      if (f.importedAt > cutoff) continue;
      items.push({
        key: `a:${f.id}`,
        rule: 'age',
        titleId: s.titleId,
        label: `${title} · S${pad(f.season)}E${pad(f.number)}`,
        why: `скачано больше ${settings.age.days} дн назад`,
        files: [{ episodeFileId: f.id, path: f.path, size: f.size }],
        size: f.size,
      });
    }
  }
  return items;
}

const CONFIRMED: Record<RetentionRule, string> = { seasons: 'retention.seasons.confirmed', oldCopy: 'retention.oldCopy.confirmed', age: 'retention.age.confirmed' };
const DECLINED = 'retention.declined';

export const retentionConfirmed = (db: Db): Record<RetentionRule, boolean> => ({
  seasons: getSetting<boolean>(db, CONFIRMED.seasons) === true,
  oldCopy: getSetting<boolean>(db, CONFIRMED.oldCopy) === true,
  age: getSetting<boolean>(db, CONFIRMED.age) === true,
});

/** Абсолютный путь строго внутри корня, иначе null. */
function inside(root: string, rel: string): string | null {
  const r = path.resolve(root);
  const abs = path.resolve(r, rel);
  const x = path.relative(r, abs);
  return x && !x.startsWith('..') && !path.isAbsolute(x) && !path.isAbsolute(rel) ? abs : null;
}

/** Удалить файл медиатеки (только внутри неё) и опустевшие папки над ним. false — путь вне медиатеки или файла нет. */
export async function deleteMediaFile(media: string, rel: string, under = ''): Promise<boolean> {
  const root = under ? path.join(media, under) : media;
  const abs = inside(root, under ? path.relative(under, rel) : rel);
  if (!abs) return false;
  await rm(abs, { force: true });
  const top = path.resolve(media);
  for (let dir = path.dirname(abs); dir.startsWith(`${top}${path.sep}`) && dir !== top; dir = path.dirname(dir)) {
    if ((await readdir(dir).catch(() => ['?'])).length) break;
    await rmdir(dir).catch(() => undefined);
  }
  return true;
}

/**
 * Уборка медиатеки. Без confirmKeys — по подтверждённым правилам (остальное ждёт и попадает в сводку «Требует внимания»);
 * с confirmKeys — выполнить отмеченное на странице, включить затронутые правила; неотмеченное — «не удалять».
 */
export async function runRetention(db: Db, media: string, settings: RetentionSettings, now: number, opts: { confirmKeys?: string[] } = {}) {
  const res = { deleted: 0, freed: 0, pending: 0 };
  const today = new Date(now).toLocaleDateString('sv-SE');
  const plan = retentionPlan(db, settings, now, today);
  const confirmed = retentionConfirmed(db);
  const keys = opts.confirmKeys ? new Set(opts.confirmKeys) : null;
  const declined = new Set(getSetting<string[]>(db, DECLINED) ?? []);
  if (keys) {
    for (const i of plan) if (!confirmed[i.rule] && !keys.has(i.key)) declined.add(i.key);
    for (const k of keys) declined.delete(k);
    setSetting(db, DECLINED, [...declined]);
  }
  let pendingSize = 0;
  for (const i of plan) {
    if (declined.has(i.key)) continue;
    if (keys ? !keys.has(i.key) : !confirmed[i.rule]) {
      if (!keys) {
        res.pending++;
        pendingSize += i.size;
      }
      continue;
    }
    if (keys) setSetting(db, CONFIRMED[i.rule], true);
    let freed = 0;
    for (const f of i.files) {
      const ok = f.oldCopyId ? await deleteMediaFile(media, f.path, OLD_DIR) : await deleteMediaFile(media, f.path);
      if (!ok) {
        log.warn({ item: i.key, path: f.path }, 'retention: path outside media library');
        continue;
      }
      if (f.episodeFileId) db.delete(episodeFiles).where(eq(episodeFiles.id, f.episodeFileId)).run();
      if (f.oldCopyId) db.delete(oldCopies).where(eq(oldCopies.id, f.oldCopyId)).run();
      res.deleted++;
      freed += f.size;
    }
    if (freed) db.insert(deletions).values({ titleId: i.titleId, label: i.label, why: i.why, size: freed, at: now }).run();
    res.freed += freed;
  }
  if (!keys) {
    setSetting(db, 'retention.pending', { count: res.pending, size: pendingSize });
    if (res.pending) notifyPendingConfirm(db, 'retention', `🗄 Уборка медиатеки ждёт подтверждения: ${res.pending} · ${formatSize(pendingSize)}`, now);
  } else setSetting(db, 'retention.pending', { count: 0, size: 0 });
  return res;
}
