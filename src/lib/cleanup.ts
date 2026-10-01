import { readdir, rm, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import type { Db } from './db/client';
import { downloads, titles, type Download } from './db/schema';
import type { Qbit, QbitTorrent } from './qbit';
import { CATEGORY, type Paths } from './downloads';
import { toLocalPath } from './library-path';
import { getSetting, setSetting } from './settings';
import { notifyPendingConfirm } from './notify-events';
import { formatSize } from './format';

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
  const root = norm(path.join(paths.downloads, CATEGORY));
  const abs = norm(p);
  const r = path.relative(root, abs);
  return r && !r.startsWith('..') && !path.isAbsolute(r) ? abs : null;
}

/** Один вид пути для сравнений: абсолютный, без «//» и «./», в NFC. */
const norm = (p: string) => path.resolve(p).normalize('NFC');

const localOf = (paths: Paths, savePath: string, name: string) => {
  try {
    return norm(toLocalPath(`${savePath.replace(/\/+$/, '')}/${name}`, paths.qbitDownloads ?? paths.downloads, paths.downloads));
  } catch {
    return null;
  }
};

/** Служебные файлы qBittorrent: «.<hash>.parts» и прочие скрытые; недокачанное «x.!qB» относится к «x». */
const isSidecar = (p: string) => path.basename(p).startsWith('.');
const realName = (p: string) => p.replace(/\.!qB$/, '');

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
    else if (e.isFile()) out.push(norm(p));
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
  const allTorrents = await qbit.list();
  const inClient = new Map(allTorrents.filter((t) => t.category === CATEGORY).map((t) => [t.hash, t]));
  const rows = db
    .select({ d: downloads, title: titles.nameRu })
    .from(downloads)
    .innerJoin(titles, eq(titles.id, downloads.titleId))
    .where(inArray(downloads.state, [...LIVE, 'imported', 'replaced']))
    .all();
  const savePath = `${(paths.qbitDownloads ?? paths.downloads).replace(/\/+$/, '')}/${CATEGORY}`;

  // файлы торрентов, которые останутся в клиенте (любой категории, если они лежат в нашей папке).
  // Список файлов не получен — уборка не идёт вовсе: иначе файлы живого торрента сочлись бы брошенными.
  const filesOf = new Map<string, string[]>();
  const ours = norm(path.join(paths.downloads, CATEGORY));
  for (const t of allTorrents) {
    const save = localOf(paths, t.save_path, '.');
    if (t.category !== CATEGORY && !(save && (save === ours || save.startsWith(`${ours}/`)))) continue;
    const fs = await qbit.files(t.hash).catch((e: unknown) => {
      throw new Error(`qBittorrent не отдал список файлов: ${e instanceof Error ? e.message : String(e)}`);
    });
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
      for (const f of files) known.add(f);
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
    const root = norm(path.join(paths.downloads, CATEGORY));
    for (const f of await walk(root)) {
      if (isSidecar(f) || all.has(realName(f)) || all.has(f) || planned.has(f) || known.has(f)) continue;
      const st = await sizeOf(f);
      if (!st || now - st.mtime < DAY) continue;
      items.push({ kind: 'orphan', key: `o:${path.relative(root, f)}`, path: f, size: st.size });
    }
  }
  return items;
}


const FILES = 'cleanup.files.confirmed';
const ORPHANS = 'cleanup.orphans.confirmed';
export const cleanupConfirmed = (db: Db) => ({ files: getSetting<boolean>(db, FILES) === true, orphans: getSetting<boolean>(db, ORPHANS) === true });

/** Удалить файл (только внутри {downloads}/dublyarr) и опустевшие папки до неё. */
async function removeFile(paths: Paths, abs: string): Promise<boolean> {
  if (!insideOurs(paths, abs)) return false;
  try {
    await rm(abs);
  } catch {
    return false; // уже удалён руками
  }
  const root = path.resolve(paths.downloads, CATEGORY);
  for (let dir = path.dirname(abs); dir !== root && insideOurs(paths, dir); dir = path.dirname(dir)) {
    if ((await readdir(dir).catch(() => ['?'])).length) break;
    await rmdir(dir).catch(() => undefined);
  }
  return true;
}

/** До подтверждения правила: брошенные — всегда ждут; торрент — ждёт, если включено удаление файлов (даже когда удалять у него сейчас нечего). */
const needsConfirm = (i: CleanupItem, c: { files: boolean; orphans: boolean }, s: CleanupSettings) => (i.kind === 'orphan' ? !c.orphans : s.deleteFiles && !c.files);
const DECLINED = 'cleanup.declined';

/** Что ждёт подтверждения первого срабатывания (для страницы /cleanup). */
export async function pendingCleanup(db: Db, qbit: Qbit, paths: Paths, now: number): Promise<CleanupItem[]> {
  const c = cleanupConfirmed(db);
  const s = getCleanup(db);
  return (await cleanupPlan(db, qbit, paths, s, now)).filter((i) => needsConfirm(i, c, s));
}

/**
 * Уборка. Без confirmKeys — по подтверждённым правилам (неподтверждённое ждёт и попадает в сводку «Требует внимания»).
 * С confirmKeys — выполнить отмеченное на странице и включить затронутые правила.
 */
export async function runCleanup(db: Db, qbit: Qbit, paths: Paths, s: CleanupSettings, now: number, opts: { confirmKeys?: string[] } = {}) {
  const res = { removed: 0, deletedFiles: 0, freed: 0, pending: 0 };
  const plan = await cleanupPlan(db, qbit, paths, s, now);
  const confirmed = cleanupConfirmed(db);
  const keys = opts.confirmKeys ? new Set(opts.confirmKeys) : null;
  // снятые на странице галочки — «не удалять»: автоматическая уборка их потом не трогает
  const declined = new Set(getSetting<string[]>(db, DECLINED) ?? []);
  if (keys) {
    for (const i of plan) if (needsConfirm(i, confirmed, s) && !keys.has(i.key)) declined.add(i.key);
    for (const k of keys) declined.delete(k);
    setSetting(db, DECLINED, [...declined]);
  }
  let pendingSize = 0;
  for (const i of plan) {
    if (!keys && declined.has(i.key)) continue;
    if (keys ? !keys.has(i.key) : needsConfirm(i, confirmed, s)) {
      if (!keys) {
        res.pending++;
        pendingSize += i.size;
      }
      continue;
    }
    if (i.kind === 'torrent') {
      if (i.inClient) await qbit.remove([db.select().from(downloads).where(eq(downloads.id, i.downloadId)).get()!.hash]);
      db.update(downloads).set({ state: 'removed', note: i.reason }).where(eq(downloads.id, i.downloadId)).run();
      res.removed++;
      if (keys && s.deleteFiles) setSetting(db, FILES, true);
    } else if (keys) setSetting(db, ORPHANS, true);
    for (const f of i.kind === 'torrent' ? i.files : [i.path]) {
      const st = await stat(f).catch(() => null);
      if (await removeFile(paths, f)) {
        res.deletedFiles++;
        res.freed += st?.size ?? 0;
      }
    }
  }
  if (!keys) setSetting(db, 'cleanup.pending', { count: res.pending, size: pendingSize });
  if (!keys && res.pending) notifyPendingConfirm(db, 'cleanup', `🧹 Уборка загрузок ждёт подтверждения: ${res.pending} · ${formatSize(pendingSize)}`, now);
  else setSetting(db, 'cleanup.pending', { count: 0, size: 0 });
  return res;
}

/**
 * Убрать торренты из клиента (без файлов) и удалить их файлы внутри {downloads}/dublyarr,
 * кроме файлов, нужных другим торрентам в клиенте. Не получили список файлов — ничего не удаляем.
 */
export async function dropTorrents(db: Db, qbit: Qbit, paths: Paths, rows: Download[], note: string) {
  const res = { torrents: 0, files: 0, freed: 0 };
  const all = await qbit.list();
  const dropping = new Set(rows.map((r) => r.hash));
  const ours = norm(path.join(paths.downloads, CATEGORY));
  const kept = new Set<string>();
  const filesOf = new Map<string, string[]>();
  const inClient = new Set<string>();
  let unsafe = false;
  for (const t of all) {
    const save = localOf(paths, t.save_path, '.');
    if (!dropping.has(t.hash) && t.category !== CATEGORY && !(save && (save === ours || save.startsWith(`${ours}/`)))) continue;
    const listed = await qbit.files(t.hash).catch(() => null);
    if (!listed) {
      // файлы чужого торрента не прочитать — не удалять ничего, что может быть общим
      if (!dropping.has(t.hash)) unsafe = true;
      else inClient.add(t.hash);
      continue;
    }
    const fs = listed.map((f) => localOf(paths, t.save_path, f.name)).filter((x): x is string => !!x);
    if (dropping.has(t.hash)) filesOf.set(t.hash, fs);
    else for (const f of fs) kept.add(f);
  }
  const savePath = `${(paths.qbitDownloads ?? paths.downloads).replace(/\/+$/, '')}/${CATEGORY}`;
  for (const d of rows) {
    const present = filesOf.has(d.hash) || inClient.has(d.hash);
    const files = unsafe ? [] : (filesOf.get(d.hash) ?? (d.files ?? []).map((f) => localOf(paths, savePath, f.name)).filter((x): x is string => !!x));
    if (present) {
      await qbit.remove([d.hash]);
      res.torrents++;
    }
    for (const f of files) {
      if (kept.has(f)) continue;
      const st = await stat(f).catch(() => null);
      if (st && (await removeFile(paths, f))) {
        res.files++;
        res.freed += st.size;
      }
    }
    db.update(downloads).set({ state: 'removed', note }).where(eq(downloads.id, d.id)).run();
  }
  return res;
}
