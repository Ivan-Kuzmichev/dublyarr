import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from './db/client';
import path from 'node:path';
import { downloads, episodeFiles, releases, titles, wantedState, type Download, type DownloadFile, type EpisodeRef, type Release } from './db/schema';
import { DEFAULT_TEMPLATE, PathError, renderTemplate, toLocalPath } from './library-path';
import { importFile } from './importer';
import type { Qbit } from './qbit';
import { parseTorrent, magnetHash, TorrentFileError } from './torrent-file';
import { filesForEpisodes } from './episode-file';
import { decrypt } from './crypto/secretbox';
import type { ActiveDownload } from './plan';
import { log, redactUrl } from './log';

// Добавление раздач в qBittorrent: серия целиком или пак с выбором нужных файлов (spec §4).

export class DownloadError extends Error {}
export const CATEGORY = 'dublyarr';
const ACTIVE = ['adding', 'downloading', 'paused', 'stalled', 'completed'] as const;

export type DownloadDeps = {
  qbit: Qbit;
  fetchTorrent: (r: Release) => Promise<Buffer | { magnet: string }>;
  paths: { qbitDownloads: string };
  now?: number;
};

const code = (e: EpisodeRef) => `S${String(e.season).padStart(2, '0')}E${String(e.number).padStart(2, '0')}`;
const merge = (a: EpisodeRef[], b: EpisodeRef[]) =>
  [...a, ...b.filter((x) => !a.some((y) => y.season === x.season && y.number === x.number))].sort((x, y) => x.season - y.season || x.number - y.number);

/** .torrent по сохранённой (зашифрованной) ссылке; не вышло — magnet; нет и его — ошибка. */
export async function fetchTorrentFile(r: Release, fetchImpl: typeof fetch = fetch): Promise<Buffer | { magnet: string }> {
  if (r.downloadEnc) {
    const url = decrypt(r.downloadEnc);
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        parseTorrent(buf); // проверка, что это торрент
        return buf;
      }
    } catch (e) {
      if (!(e instanceof TorrentFileError)) log.warn({ url: redactUrl(url), err: e instanceof Error ? e.message : String(e) }, 'torrent fetch failed');
    }
  }
  if (r.magnet) return { magnet: r.magnet };
  throw new DownloadError('Не удалось получить торрент');
}

export function activeDownloads(db: Db, titleId: number): ActiveDownload[] {
  return db
    .select()
    .from(downloads)
    .where(and(eq(downloads.titleId, titleId), inArray(downloads.state, [...ACTIVE])))
    .all()
    .map((d) => ({ id: d.id, kind: d.kind, season: d.season, episodes: d.episodes, files: d.files, state: d.state }));
}

const update = (db: Db, id: number, set: Partial<Download>) => db.update(downloads).set(set).where(eq(downloads.id, id)).returning().get();

/** Добавить раздачу (или дополнить уже качающуюся с тем же хэшем) для нужных серий. */
export async function startRelease(
  db: Db,
  deps: DownloadDeps,
  release: Release,
  want: EpisodeRef[],
  kind: 'episode' | 'pack' | 'season',
  studioLabel: string | null,
): Promise<Download> {
  const now = deps.now ?? Date.now();
  const torrent = await deps.fetchTorrent(release);
  const meta = Buffer.isBuffer(torrent) ? parseTorrent(torrent) : { infohash: magnetHash(torrent.magnet), name: release.title, files: [] };
  if (!meta.infohash) throw new DownloadError('Не удалось получить торрент');

  const existing = db.select().from(downloads).where(eq(downloads.hash, meta.infohash)).get();
  if (existing && (ACTIVE as readonly string[]).includes(existing.state)) {
    await enableFiles(db, deps, existing.id, want);
    return db.select().from(downloads).where(eq(downloads.id, existing.id)).get()!;
  }
  // уже скачанная (или убранная только у нас) раздача всё ещё в клиенте — повторный add qBittorrent отвергнет
  if (existing && (await deps.qbit.list(CATEGORY)).some((t) => t.hash === existing.hash)) return resume(db, deps, existing, want);
  // новая версия уже скачиваемого топика — не второй торрент рядом, а смена версии
  const prev = Buffer.isBuffer(torrent) && !existing ? topicDownload(db, release) : undefined;
  if (prev && Buffer.isBuffer(torrent)) {
    const res = await switchTorrent(db, deps, prev, torrent, want);
    if (res.switched) return res.download;
    if (res.reason === 'no-new-episodes') throw new DownloadError(`В раздаче нет файла ${code(want[0])}`);
  }

  const savePath = `${deps.paths.qbitDownloads.replace(/\/+$/, '')}/${CATEGORY}`;
  await deps.qbit.ensureCategory(CATEGORY, savePath);
  const magnetPack = !Buffer.isBuffer(torrent) && kind === 'pack';
  try {
    await deps.qbit.add(torrent, { savePath, category: CATEGORY, paused: !magnetPack, stopOnMetadata: magnetPack });
  } catch (e) {
    // другой вызов (ручное «Скачать» и воркер одновременно) уже добавил этот торрент
    if (!(await deps.qbit.list(CATEGORY)).some((t) => t.hash === meta.infohash)) throw e;
  }
  let files: DownloadFile[] = meta.files.map((f) => ({ index: f.index, name: f.path, size: f.size, priority: 1 }));
  if (!files.length) files = (await deps.qbit.files(meta.infohash)).map((f) => ({ index: f.index, name: f.name, size: f.size, priority: f.priority }));
  const row = {
    hash: meta.infohash,
    titleId: release.titleId,
    releaseId: release.id,
    season: want[0]?.season ?? release.parsed.seasons[0] ?? 1,
    kind,
    episodes: want,
    files,
    state: 'adding' as const,
    progress: 0,
    size: release.size,
    name: release.title,
    studioLabel,
    resolution: release.parsed.resolution,
    addedAt: now,
    lastError: null,
    completedAt: null,
    importedAt: null,
  };
  let d: Download;
  try {
    d = existing ? update(db, existing.id, row) : db.insert(downloads).values(row).returning().get();
  } catch (e) {
    // запись с этим хэшем успел создать другой вызов — дополняем её
    const other = e instanceof Error && /UNIQUE/.test(e.message) ? db.select().from(downloads).where(eq(downloads.hash, meta.infohash)).get() : undefined;
    if (!other) throw e;
    await enableFiles(db, deps, other.id, want);
    return db.select().from(downloads).where(eq(downloads.id, other.id)).get()!;
  }
  // magnet-пак без метаданных: файлы выберет синхронизация, когда qBittorrent их получит
  if (kind === 'pack' && !files.length) return d;
  return selectAndStart(db, deps.qbit, d, files);
}

/** Пак: приоритет 0 всем, кроме файлов нужных серий; затем запуск. */
async function selectAndStart(db: Db, qbit: Qbit, d: Download, files: DownloadFile[]): Promise<Download> {
  if (d.kind === 'pack') {
    const map = filesForEpisodes(files, d.season, d.episodes.map((w) => w.number));
    const found = d.episodes.filter((w) => map.has(w.number));
    if (!found.length) {
      await qbit.remove([d.hash]);
      return update(db, d.id, { state: 'error', files, lastError: `В раздаче нет файла ${code(d.episodes[0])}` });
    }
    const keep = new Set(found.flatMap((w) => map.get(w.number)!));
    const off = files.filter((f) => !keep.has(f.index)).map((f) => f.index);
    await qbit.setFilePriority(d.hash, off, 0);
    d = update(db, d.id, { episodes: found, files: files.map((f) => ({ ...f, priority: keep.has(f.index) ? 1 : 0 })) });
  }
  await qbit.start([d.hash]);
  return update(db, d.id, { state: 'downloading' });
}

/** Снова качать из раздачи, которая уже есть в клиенте: включить файлы новых серий (прежние скачаны и остаются как есть). */
async function resume(db: Db, deps: DownloadDeps, d: Download, want: EpisodeRef[]): Promise<Download> {
  const files = d.files?.length ? d.files : (await deps.qbit.files(d.hash)).map((f) => ({ index: f.index, name: f.name, size: f.size, priority: f.priority }));
  let episodes = want;
  let next = files;
  if (d.kind === 'pack') {
    const map = filesForEpisodes(files, d.season, want.map((w) => w.number));
    episodes = want.filter((w) => map.has(w.number));
    if (!episodes.length) throw new DownloadError(`В раздаче нет файла ${code(want[0])}`);
    const on = new Set(episodes.flatMap((w) => map.get(w.number)!));
    await deps.qbit.setFilePriority(d.hash, [...on], 1);
    next = files.map((f) => (on.has(f.index) ? { ...f, priority: 1 } : f));
  }
  await deps.qbit.start([d.hash]);
  return update(db, d.id, { episodes, files: next, state: 'downloading', lastError: null, completedAt: null, progress: 0 });
}

const LIVE: Download['state'][] = ['adding', 'downloading', 'paused', 'stalled', 'completed', 'imported'];

/** Живая загрузка-пак сериала с раздачей того же топика (того же адреса на трекере). */
export function topicDownload(db: Db, release: Release): Download | undefined {
  if (!release.detailsUrl) return undefined;
  return db
    .select({ d: downloads })
    .from(downloads)
    .innerJoin(releases, eq(releases.id, downloads.releaseId))
    .where(and(eq(downloads.titleId, release.titleId), eq(downloads.kind, 'pack'), eq(releases.detailsUrl, release.detailsUrl), inArray(downloads.state, LIVE)))
    .orderBy(desc(downloads.addedAt))
    .get()?.d;
}

export type SwitchResult = { switched: true; download: Download; added: EpisodeRef[] } | { switched: false; reason: 'same-hash' | 'no-new-episodes' };

/** «+серия 6», «+серии 6–7», «+серии 6, 8». */
function addedNote(eps: EpisodeRef[]) {
  const n = eps.map((e) => e.number).sort((a, b) => a - b);
  if (n.length === 1) return `Обновлена: +серия ${n[0]}`;
  const run = n.every((x, i) => i === 0 || x === n[i - 1] + 1);
  return `Обновлена: +серии ${run ? `${n[0]}–${n.at(-1)}` : n.join(', ')}`;
}

/** Новая версия топика: торрент в ту же папку, включены только нужные серии, старый торрент убирается из клиента (файлы остаются). */
export async function switchTorrent(db: Db, deps: DownloadDeps, old: Download, torrent: Buffer, want: EpisodeRef[]): Promise<SwitchResult> {
  const meta = parseTorrent(torrent);
  if (meta.infohash === old.hash) return { switched: false, reason: 'same-hash' };
  const have = new Set(
    db
      .select()
      .from(episodeFiles)
      .where(eq(episodeFiles.titleId, old.titleId))
      .all()
      .map((f) => `${f.season}:${f.number}`),
  );
  const carry = old.state === 'imported' ? [] : old.episodes.filter((e) => !have.has(`${e.season}:${e.number}`));
  const all = merge(carry, want);
  const files: DownloadFile[] = meta.files.map((f) => ({ index: f.index, name: f.path, size: f.size, priority: 1 }));
  const map = filesForEpisodes(files, old.season, all.filter((e) => e.season === old.season).map((e) => e.number));
  const found = all.filter((e) => e.season === old.season && map.has(e.number));
  if (!found.length) return { switched: false, reason: 'no-new-episodes' };

  const savePath = `${deps.paths.qbitDownloads.replace(/\/+$/, '')}/${CATEGORY}`;
  await deps.qbit.ensureCategory(CATEGORY, savePath);
  await deps.qbit.add(torrent, { savePath, category: CATEGORY, paused: true });
  const keep = new Set(found.flatMap((e) => map.get(e.number)!));
  await deps.qbit.setFilePriority(meta.infohash, files.filter((f) => !keep.has(f.index)).map((f) => f.index), 0);
  const now = deps.now ?? Date.now();
  const fresh = db
    .insert(downloads)
    .values({
      hash: meta.infohash,
      titleId: old.titleId,
      releaseId: old.releaseId,
      season: old.season,
      kind: 'pack',
      episodes: found,
      files: files.map((f) => ({ ...f, priority: keep.has(f.index) ? 1 : 0 })),
      state: 'adding',
      progress: 0,
      size: meta.files.reduce((n, f) => n + f.size, 0),
      name: old.name,
      studioLabel: old.studioLabel,
      resolution: old.resolution,
      addedAt: now,
    })
    .returning()
    .get();
  try {
    await deps.qbit.remove([old.hash]);
  } catch (e) {
    log.warn({ download: old.id, err: e instanceof Error ? e.message : String(e) }, 'old torrent remove failed');
  }
  const added = found.filter((e) => want.some((w) => w.season === e.season && w.number === e.number));
  update(db, old.id, { state: 'replaced', replacedById: fresh.id, note: addedNote(added.length ? added : found) });
  await deps.qbit.start([meta.infohash]);
  return { switched: true, download: update(db, fresh.id, { state: 'downloading' }), added };
}

/** Включить файлы ещё нужных серий в уже качающемся паке. */
export async function enableFiles(db: Db, deps: DownloadDeps, downloadId: number, want: EpisodeRef[]) {
  const d = db.select().from(downloads).where(eq(downloads.id, downloadId)).get();
  if (!d) return;
  const episodes = merge(d.episodes, want);
  if (!d.files?.length || d.kind !== 'pack') {
    update(db, d.id, { episodes });
    return;
  }
  const map = filesForEpisodes(d.files, d.season, want.map((w) => w.number));
  const idx = [...map.values()].flat();
  if (idx.length) {
    await deps.qbit.setFilePriority(d.hash, idx, 1);
    if (d.state === 'completed') await deps.qbit.start([d.hash]);
  }
  update(db, d.id, {
    episodes: merge(d.episodes, want.filter((w) => map.has(w.number))),
    files: d.files.map((f) => (idx.includes(f.index) ? { ...f, priority: 1 } : f)),
    ...(idx.length && d.state === 'completed' ? { state: 'downloading' as const } : {}),
  });
}

// --- синхронизация и импорт ---

export type Paths = { qbitDownloads?: string; downloads: string; media: string; template?: string };
const DAY = 86_400_000;

/** Состояние загрузок из qBittorrent; завершённые — импорт нужных файлов в медиатеку. */
export async function syncDownloads(db: Db, deps: { qbit: Qbit; paths: Paths; now?: number }) {
  const now = deps.now ?? Date.now();
  const res = { updated: 0, imported: 0, errors: 0 };
  const active = db.select().from(downloads).where(inArray(downloads.state, [...ACTIVE])).all();
  if (!active.length) return res;
  const byHash = new Map((await deps.qbit.list(CATEGORY)).map((t) => [t.hash, t]));
  for (const d of active) {
    const t = byHash.get(d.hash);
    if (!t) {
      update(db, d.id, { state: 'removed' });
      res.updated++;
      continue;
    }
    const qfiles = await deps.qbit.files(d.hash);
    if (d.state === 'adding' && d.kind === 'pack' && !d.files?.length) {
      if (qfiles.length) await selectAndStart(db, deps.qbit, d, qfiles.map((f) => ({ index: f.index, name: f.name, size: f.size, priority: f.priority })));
      continue;
    }
    const wanted = d.kind === 'pack' ? qfiles.filter((f) => f.priority > 0) : qfiles;
    const total = wanted.reduce((n, f) => n + f.size, 0);
    const progress = d.kind === 'pack' && total > 0 ? wanted.reduce((n, f) => n + f.progress * f.size, 0) / total : t.progress;
    const done = d.kind === 'pack' ? wanted.length > 0 && wanted.every((f) => f.progress >= 1) : t.progress >= 1;
    const lastSeededAt = t.num_seeds > 0 ? now : d.lastSeededAt;
    const paused = /^(stopped|paused)/i.test(t.state);
    const stalled = !done && t.num_seeds === 0 && now - (lastSeededAt ?? d.addedAt) > DAY;
    const state = done ? 'completed' : paused ? 'paused' : stalled ? 'stalled' : 'downloading';
    update(db, d.id, { progress, dlSpeed: t.dlspeed, eta: t.eta, contentPath: t.content_path, lastSeededAt, state, ...(done && !d.completedAt ? { completedAt: now } : {}) });
    res.updated++;
    if (!done) continue;
    try {
      const got = await importDownload(db, d, t.save_path, qfiles, deps.paths, now);
      update(db, d.id, { state: 'imported', importedAt: now, lastError: null, episodes: got });
      res.imported++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      update(db, d.id, { lastError: e instanceof PathError ? msg : `Ошибка импорта: ${msg}` });
      log.warn({ download: d.id, err: msg }, 'import failed');
      res.errors++;
    }
  }
  return res;
}

async function importDownload(db: Db, d: Download, savePath: string, files: { index: number; name: string; size: number }[], paths: Paths, now: number): Promise<EpisodeRef[]> {
  const title = db.select().from(titles).where(eq(titles.id, d.titleId)).get();
  if (!title) throw new Error('Сериал удалён');
  const map = filesForEpisodes(files, d.season, d.episodes.filter((e) => e.season === d.season).map((e) => e.number));
  const found = d.episodes.filter((ep) => map.has(ep.number) && files.some((f) => f.index === map.get(ep.number)![0]));
  if (!found.length) throw new Error(`нет файла ${code(d.episodes[0])}`);
  // серии без файла в раздаче — не ждать их здесь, а искать заново
  for (const ep of d.episodes.filter((e) => !found.includes(e))) {
    const row = { titleId: d.titleId, season: ep.season, number: ep.number, state: 'missing' as const, reason: `В раздаче нет файла ${code(ep)}`, until: null, checkedAt: now };
    db.insert(wantedState)
      .values(row)
      .onConflictDoUpdate({ target: [wantedState.titleId, wantedState.season, wantedState.number], set: row })
      .run();
  }
  for (const ep of found) {
    const file = files.find((f) => f.index === map.get(ep.number)![0])!;
    const src = toLocalPath(`${savePath.replace(/\/+$/, '')}/${file.name}`, paths.qbitDownloads ?? paths.downloads, paths.downloads);
    const rel = renderTemplate(
      paths.template || DEFAULT_TEMPLATE,
      { name: title.nameRu, original: title.nameOriginal, year: title.year, season: ep.season, episode: ep.number, studio: d.studioLabel ?? '', quality: d.resolution ? `${d.resolution}p` : '' },
      path.extname(file.name),
    );
    const r = await importFile(src, paths.media, rel);
    const row = { titleId: d.titleId, season: ep.season, number: ep.number, path: rel, size: file.size, downloadId: d.id, studioLabel: d.studioLabel, resolution: d.resolution, method: r.method, importedAt: now };
    db.insert(episodeFiles)
      .values(row)
      .onConflictDoUpdate({ target: [episodeFiles.titleId, episodeFiles.season, episodeFiles.number], set: row })
      .run();
    db.delete(wantedState)
      .where(and(eq(wantedState.titleId, d.titleId), eq(wantedState.season, ep.season), eq(wantedState.number, ep.number)))
      .run();
  }
  return found;
}
