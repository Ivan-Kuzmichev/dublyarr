import { statfs as fsStatfs } from 'node:fs/promises';
import { desc } from 'drizzle-orm';
import type { Db } from './db/client';
import { deletions, episodeFiles, oldCopies, subscriptions, titles } from './db/schema';
import { retentionConfirmed, retentionPlan, seasonRule } from './retention';
import { getSetting, setSetting } from './settings';
import { notify } from './notify';
import type { RetentionSettings } from './retention-settings';

// Диск медиатеки и защита от переполнения (spec §8).

export type Disk = { total: number; free: number; used: number; pct: number };

export async function diskUsage(media: string, statfs: typeof fsStatfs = fsStatfs): Promise<Disk | null> {
  try {
    const s = await statfs(media);
    // как df: занято = blocks − bfree; процент — от доступного пользователю (без блоков, зарезервированных за root)
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    const used = (s.blocks - s.bfree) * s.bsize;
    return { total, free, used, pct: used + free ? Math.round((used / (used + free)) * 100) : 0 };
  } catch {
    return null;
  }
}

export type DiskLevel = 'ok' | 'warn' | 'pause';
export const storageState = (db: Db) => getSetting<{ pct: number; level: DiskLevel }>(db, 'storage.state');
export const storagePaused = (db: Db) => getSetting<boolean>(db, 'storage.paused') === true;

/** Порог предупреждения — сообщение раз в сутки; порог паузы — загрузки Dublyarr на паузе (applySpeed), ниже — снимается. */
export function checkDisk(db: Db, disk: Disk | null, settings: RetentionSettings, now: number): DiskLevel {
  const o = settings.overflow;
  const level: DiskLevel = !o.on || !disk ? 'ok' : disk.pct >= o.pause ? 'pause' : disk.pct >= o.warn ? 'warn' : 'ok';
  setSetting(db, 'storage.paused', level === 'pause');
  setSetting(db, 'storage.state', disk ? { pct: disk.pct, level } : null);
  if (level !== 'ok') {
    const day = new Date(now).toISOString().slice(0, 10);
    notify(db, { key: `disk:${level}:${day}`, kind: 'stuck', text: `💾 Диск медиатеки заполнен на ${disk!.pct} %${level === 'pause' ? ' — загрузки на паузе' : ''}` }, now);
  }
  return level;
}

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

export type StorageShow = { tmdbId: number; title: string; posterPath: string | null; seasons: string; quality: string; size: number; rule: string; keepPct: number; dropPct: number; lastAt: number };

/** Данные экрана «Хранилище»: диск, сериалы, первая уборка, прогноз, история. */
export function storageData(db: Db, disk: Disk | null, settings: RetentionSettings, now: number, today: string) {
  const files = db.select().from(episodeFiles).all();
  const copies = db.select().from(oldCopies).all();
  const meta = new Map(db.select().from(titles).all().map((t) => [t.id, t]));
  const subs = new Map(db.select().from(subscriptions).all().map((s) => [s.titleId, s]));
  const sizeOf = (kind: string) =>
    [...files, ...copies].filter((f) => meta.get(f.titleId)?.kind === kind).reduce((n, f) => n + f.size, 0);
  const series = sizeOf('series');
  const anime = sizeOf('anime');
  const total = disk?.total ?? series + anime;
  const seg = (name: string, size: number) => ({ name, size, pct: total ? (size / total) * 100 : 0 });
  const segments = [seg('Сериалы', series), seg('Аниме', anime)];
  if (disk) segments.push(seg('Не Dublyarr', Math.max(0, disk.used - series - anime)), seg('Свободно', disk.free));

  const plan = retentionPlan(db, settings, now, today);
  const confirmed = retentionConfirmed(db);
  const declined = new Set(getSetting<string[]>(db, 'retention.declined') ?? []);
  const pending = plan.filter((i) => !confirmed[i.rule] && !declined.has(i.key));
  const dropBy = new Map<number, number>();
  for (const i of plan.filter((x) => !declined.has(x.key))) dropBy.set(i.titleId, (dropBy.get(i.titleId) ?? 0) + i.size);

  const byTitle = new Map<number, typeof files>();
  for (const f of files) byTitle.set(f.titleId, [...(byTitle.get(f.titleId) ?? []), f]);
  const shows: StorageShow[] = [...byTitle].map(([titleId, fs]) => {
    const t = meta.get(titleId)!;
    const ss = [...new Set(fs.map((f) => f.season))].sort((a, b) => a - b);
    const res = new Map<number, number>();
    for (const f of fs) if (f.resolution) res.set(f.resolution, (res.get(f.resolution) ?? 0) + 1);
    const q = [...res].sort((a, b) => b[1] - a[1])[0]?.[0];
    const size = fs.reduce((n, f) => n + f.size, 0) + copies.filter((c) => c.titleId === titleId).reduce((n, c) => n + c.size, 0);
    const sub = subs.get(titleId);
    const rule = sub?.autoDelete ? `через ${settings.age.days} дн` : sub ? seasonRule(db, titleId, settings, today).label : 'без подписки';
    const dropPct = size ? Math.round(((dropBy.get(titleId) ?? 0) / size) * 100) : 0;
    return {
      tmdbId: t.tmdbId,
      title: t.nameRu,
      posterPath: t.posterPath,
      seasons: ss.length > 1 ? `S${pad(ss[0])}–S${pad(ss.at(-1)!)}` : `S${pad(ss[0])}`,
      quality: q ? `${q}p` : '—',
      size,
      rule,
      keepPct: 100 - dropPct,
      dropPct,
      lastAt: Math.max(...fs.map((f) => f.importedAt)),
    };
  });
  shows.sort((a, b) => b.size - a.size);

  const month = files.filter((f) => f.importedAt >= now - 30 * DAY).reduce((n, f) => n + f.size, 0);
  const perWeek = (month * 7) / 30;
  const freeable = plan.filter((i) => !declined.has(i.key)).reduce((n, i) => n + i.size, 0);
  const forecast = {
    perWeek,
    weeksLeft: disk && perWeek > 0 ? disk.free / perWeek : null,
    weeksAfter: disk && perWeek > 0 ? (disk.free + freeable) / perWeek : null,
  };
  const history = db.select().from(deletions).orderBy(desc(deletions.at)).limit(10).all();
  return { disk, segments, shows, pending, pendingRule: pending[0]?.rule ?? null, forecast, history };
}
