import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import type { Db } from './db/client';
import { downloads, titles, type Download } from './db/schema';
import type { Qbit, QbitTorrent } from './qbit';
import { CATEGORY, type Paths } from './downloads';
import { toLocalPath } from './library-path';
import { getSetting } from './settings';

// Уборка в qBittorrent (spec §7): убрать торрент после импорта / после раздачи, заменённые раздачи, брошенные файлы.
// Файлы удаляет сам Dublyarr и только внутри {downloads}/dublyarr; файлы живых торрентов не трогаются.

export type CleanupSettings = { remove: 'import' | 'seeded' | 'never'; seedDays: number; seedRatio: number; deleteFiles: boolean; replaced: boolean; orphans: boolean };
export const DEFAULT_CLEANUP: CleanupSettings = { remove: 'seeded', seedDays: 3, seedRatio: 2, deleteFiles: true, replaced: true, orphans: true };
export const getCleanup = (db: Db): CleanupSettings => ({ ...DEFAULT_CLEANUP, ...getSetting<Partial<CleanupSettings>>(db, 'cleanup') });

export function parseCleanupForm(form: FormData): CleanupSettings | { error: string } {
  const remove = String(form.get('remove') ?? '') as CleanupSettings['remove'];
  if (!['import', 'seeded', 'never'].includes(remove)) return { error: 'Неизвестный режим уборки' };
  const seedDays = Number(form.get('seedDays'));
  if (!Number.isInteger(seedDays) || seedDays < 0 || seedDays > 365) return { error: 'Дни раздачи — от 0 до 365' };
  const seedRatio = Number(String(form.get('seedRatio') ?? '').replace(',', '.'));
  if (!Number.isFinite(seedRatio) || seedRatio < 0 || seedRatio > 100) return { error: 'Рейтинг — от 0 до 100' };
  const on = (k: string) => form.get(k) === 'on';
  return { remove, seedDays, seedRatio, deleteFiles: on('deleteFiles'), replaced: on('replaced'), orphans: on('orphans') };
}

export type CleanupItem =
  | { kind: 'torrent'; key: string; downloadId: number; title: string; name: string; reason: string; files: string[]; size: number; inClient: boolean }
  | { kind: 'orphan'; key: string; path: string; size: number };

const DAY = 86_400_000;
const LIVE: Download['state'][] = ['adding', 'downloading', 'paused', 'stalled', 'completed'];
const comma = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

/** Абсолютный путь внутри {downloads}/dublyarr, иначе null. */
function insideOurs(paths: Paths, p: string): string | null {
  const root = path.resolve(paths.downloads, CATEGORY);
  const abs = path.resolve(p);
  const r = path.relative(root, abs);
  return r && !r.startsWith('..') && !path.isAbsolute(r) ? abs : null;
}

const localOf = (paths: Paths, savePath: string, name: string) => {
  try {
    return toLocalPath(`${savePath.replace(/\/+$/, '')}/${name}`, paths.qbitDownloads ?? paths.downloads, paths.downloads);
  } catch {
    return null;
  }
};

const sizeOf = (p: string) =>
  stat(p).then(
    (s) => ({ size: s.size, mtime: s.mtimeMs }),
    () => null,
  );

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

function seedReason(t: QbitTorrent, s: CleanupSettings, now: number): string | null {
  if (s.remove === 'import') return 'Убран после импорта';
  if (s.remove !== 'seeded') return null;
  if ((t.ratio ?? 0) >= s.seedRatio) return `Рейтинг ${comma(t.ratio ?? 0)}`;
  const done = t.completion_on && t.completion_on > 0 ? t.completion_on * 1000 : null;
  if (done !== null && now - done >= s.seedDays * DAY) return `Раздача ${Math.floor((now - done) / DAY)} дн`;
  return null;
}

/** Что уберётся сейчас (без выполнения). */
export async function cleanupPlan(db: Db, qbit: Qbit, paths: Paths, s: CleanupSettings, now: number): Promise<CleanupItem[]> {
  const inClient = new Map((await qbit.list(CATEGORY)).map((t) => [t.hash, t]));
  const rows = db
    .select({ d: downloads, title: titles.nameRu })
    .from(downloads)
    .innerJoin(titles, eq(titles.id, downloads.titleId))
    .where(inArray(downloads.state, [...LIVE, 'imported', 'replaced']))
    .all();
  const savePath = `${(paths.qbitDownloads ?? paths.downloads).replace(/\/+$/, '')}/${CATEGORY}`;

  // файлы торрентов, которые останутся в клиенте
  const filesOf = new Map<string, string[]>();
  for (const t of inClient.values()) {
    const fs = await qbit.files(t.hash).catch(() => []);
    filesOf.set(
      t.hash,
      fs.map((f) => localOf(paths, t.save_path, f.name)).filter((x): x is string => !!x),
    );
  }
  const items: CleanupItem[] = [];
  const leaving = new Set<string>();
  // файлы, о которых Dublyarr знает (заменённые раздачи), — не «брошенные», даже если их уборка выключена
  const known = new Set<string>();
  const candidates: { d: Download; title: string; reason: string; files: string[]; inClient: boolean }[] = [];
  for (const { d, title } of rows) {
    const t = inClient.get(d.hash);
    if (d.state === 'imported' && t) {
      const reason = seedReason(t, s, now);
      if (reason) candidates.push({ d, title, reason, files: filesOf.get(d.hash) ?? [], inClient: true });
    } else if (d.state === 'replaced') {
      const files = (d.files ?? []).map((f) => localOf(paths, savePath, f.name)).filter((x): x is string => !!x);
      for (const f of files) known.add(path.resolve(f));
      if (s.replaced) candidates.push({ d, title, reason: 'Заменённая раздача', files, inClient: !!t });
    }
  }
  for (const c of candidates) if (c.inClient) leaving.add(c.d.hash);
  // файлы, которые нужны торрентам, остающимся в клиенте, — не удаляем
  const kept = new Set([...filesOf].filter(([h]) => !leaving.has(h)).flatMap(([, f]) => f));
  const planned = new Set<string>();
  for (const c of candidates) {
    const files: string[] = [];
    let size = 0;
    if (s.deleteFiles)
      for (const f of c.files) {
        const abs = insideOurs(paths, f);
        if (!abs || kept.has(abs) || planned.has(abs)) continue;
        const st = await sizeOf(abs);
        if (!st) continue;
        files.push(abs);
        planned.add(abs);
        size += st.size;
      }
    if (!c.inClient && !files.length) continue; // торрента нет и удалять нечего
    items.push({ kind: 'torrent', key: `t:${c.d.id}`, downloadId: c.d.id, title: c.title, name: c.d.name, reason: c.reason, files, size, inClient: c.inClient });
  }

  if (s.orphans && s.deleteFiles) {
    const all = new Set([...filesOf.values()].flat());
    const root = path.resolve(paths.downloads, CATEGORY);
    for (const f of await walk(root)) {
      if (all.has(f) || planned.has(f) || known.has(f)) continue;
      const st = await sizeOf(f);
      if (!st || now - st.mtime < DAY) continue;
      items.push({ kind: 'orphan', key: `o:${path.relative(root, f)}`, path: f, size: st.size });
    }
  }
  return items;
}

