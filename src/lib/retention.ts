import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from './db/client';
import { episodeFiles, episodes, oldCopies, seasons, subscriptions, titles } from './db/schema';
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
