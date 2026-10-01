import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from './db/client';
import path from 'node:path';
import { downloads, episodeFiles, episodes, oldCopies, releases, studios, subscriptions, titles, wantedState, type Download, type DownloadFile, type EpisodeRef, type Release } from './db/schema';
import { DEFAULT_TEMPLATE, PathError, renderTemplate, toLocalPath } from './library-path';
import { DEFAULT_MOVIE_TEMPLATE, mediaRoot, pickMovieFile } from './movie-files';
import { MOVIE_EP } from './movies';
import { importFile } from './importer';
import { access } from 'node:fs/promises';
import { restoreOldCopy, settleOldCopy, stashOldCopy } from './old-copies';
import { notifyGone, notifyImported, notifyStalled } from './notify-events';
import { mkdir, rm, stat } from 'node:fs/promises';
import { processEpisode, RemuxDeferred, WrongEpisodeError, type ProcessResult } from './media/process';
import { systemRunner, type Runner } from './media/runner';
import { findExternal, getProcessing, describePlan, type External } from './media/tracks';
import { hdrOf, resolutionOf } from './media/probe';
import { normalizeStudio } from './studios-normalize';
import { enqueue } from '../worker/jobs';

const fileExists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );
import type { Qbit } from './qbit';
import { parseTorrent, magnetHash, TorrentFileError } from './torrent-file';
import { filesForEpisodes, filesForEpisodesStrict, isVideo, otherSeasonInPath } from './episode-file';
import { decrypt } from './crypto/secretbox';
import type { ActiveDownload } from './plan';
import { logger, redactUrl } from './log';

// Добавление раздач в qBittorrent: серия целиком или пак с выбором нужных файлов (spec §4).

export class DownloadError extends Error {}

/** Имя файла так, как его показывает qBittorrent: у многофайловой раздачи — с корневой папкой. */
const qbitName = (meta: { name: string; files: unknown[] }, p: string) => (meta.files.length > 1 || p !== meta.name ? `${meta.name}/${p}` : p);
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
      if (!(e instanceof TorrentFileError)) dlog.warn({ url: redactUrl(url), err: e instanceof Error ? e.message : String(e) }, 'torrent fetch failed');
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

const dlog = logger('downloads');

/** Запись загрузки; смена состояния — в журнал (откуда, куда, ошибка/заметка). */
function update(db: Db, id: number, set: Partial<Download>): Download {
  const before = set.state ? db.select({ state: downloads.state }).from(downloads).where(eq(downloads.id, id)).get()?.state : undefined;
  const row = db.update(downloads).set(set).where(eq(downloads.id, id)).returning().get();
  if (set.state && before !== set.state)
    dlog.info({ download: id, hash: row.hash, from: before, to: set.state, ...(row.lastError ? { lastError: row.lastError } : {}), ...(row.note ? { note: row.note } : {}) }, 'state');
  return row;
}

/** Добавить раздачу (или дополнить уже качающуюся с тем же хэшем) для нужных серий. */
export async function startRelease(
  db: Db,
  deps: DownloadDeps,
  release: Release,
  want: EpisodeRef[],
  kind: 'episode' | 'pack' | 'season' | 'movie',
  studioLabel: string | null,
  opts: { dubPosition?: number | null; note?: string } = {},
): Promise<Download> {
  const now = deps.now ?? Date.now();
  const torrent = await deps.fetchTorrent(release);
  const meta = Buffer.isBuffer(torrent) ? parseTorrent(torrent) : { infohash: magnetHash(torrent.magnet), name: release.title, files: [] };
  if (!meta.infohash) throw new DownloadError('Не удалось получить торрент');

  const existing = db.select().from(downloads).where(eq(downloads.hash, meta.infohash)).get();
  const tag = { ...(opts.dubPosition !== undefined ? { dubPosition: opts.dubPosition } : {}), ...(opts.note ? { note: opts.note } : {}) };
  if (existing && (ACTIVE as readonly string[]).includes(existing.state)) {
    await enableFiles(db, deps, existing.id, want);
    return Object.keys(tag).length ? update(db, existing.id, tag) : db.select().from(downloads).where(eq(downloads.id, existing.id)).get()!;
  }
  // уже скачанная (или убранная только у нас) раздача всё ещё в клиенте — повторный add qBittorrent отвергнет
  if (existing && (await deps.qbit.list(CATEGORY)).some((t) => t.hash === existing.hash)) {
    const d = await resume(db, deps, existing, want);
    return Object.keys(tag).length ? update(db, d.id, tag) : d;
  }
  // новая версия уже скачиваемого топика — не второй торрент рядом, а смена версии
  const prev = Buffer.isBuffer(torrent) && !existing && kind !== 'movie' ? topicDownload(db, release, want[0]?.season) : undefined;
  if (prev && Buffer.isBuffer(torrent) && want.every((w) => w.season === prev.season)) {
    const res = await switchTorrent(db, deps, prev, torrent, want);
    if (res.switched) return res.download;
    if (res.reason === 'no-new-episodes') throw new DownloadError(`В раздаче нет файла ${code(want[0])}`);
  }

  const savePath = `${deps.paths.qbitDownloads.replace(/\/+$/, '')}/${CATEGORY}`;
  await deps.qbit.ensureCategory(CATEGORY, savePath);
  const magnetPack = !Buffer.isBuffer(torrent) && (kind === 'pack' || kind === 'movie'); // файлы выберем, когда будут метаданные
  try {
    await deps.qbit.add(torrent, { savePath, category: CATEGORY, paused: !magnetPack, stopOnMetadata: magnetPack });
  } catch (e) {
    // другой вызов (ручное «Скачать» и воркер одновременно) уже добавил этот торрент
    if (!(await deps.qbit.list(CATEGORY)).some((t) => t.hash === meta.infohash)) throw e;
  }
  let files: DownloadFile[] = meta.files.map((f) => ({ index: f.index, name: qbitName(meta, f.path), size: f.size, priority: 1 }));
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
    dubPosition: opts.dubPosition ?? null,
    note: opts.note ?? null,
    addedAt: now,
    lastError: null,
    completedAt: null,
    importedAt: null,
  };
  let d: Download;
  try {
    d = existing ? update(db, existing.id, row) : db.insert(downloads).values(row).returning().get();
    if (!existing) dlog.info({ download: d.id, hash: d.hash, to: d.state, kind, episodes: want }, 'state');
  } catch (e) {
    // запись с этим хэшем успел создать другой вызов — дополняем её
    const other = e instanceof Error && /UNIQUE/.test(e.message) ? db.select().from(downloads).where(eq(downloads.hash, meta.infohash)).get() : undefined;
    if (!other) throw e;
    await enableFiles(db, deps, other.id, want);
    return db.select().from(downloads).where(eq(downloads.id, other.id)).get()!;
  }
  // magnet-пак без метаданных: файлы выберет синхронизация, когда qBittorrent их получит
  if ((kind === 'pack' || kind === 'movie') && !files.length) return d;
  return selectAndStart(db, deps.qbit, d, files);
}

/** Внешние .mka/.srt этих серий в раздаче (их тоже нужно качать, чтобы вшить). */
function externalIndexes(files: { index: number; name: string }[], season: number, map: Map<number, number[]>): number[] {
  const names = files.map((f) => f.name);
  const videos = files.filter((f) => isVideo(f.name)).length;
  const out: number[] = [];
  for (const [ep, idx] of map) {
    const video = files.find((f) => f.index === idx[0]);
    if (!video) continue;
    for (const e of findExternal(names, video.name, season, ep, videos === 1)) {
      const f = files.find((x) => x.name === e.path);
      if (f) out.push(f.index);
    }
  }
  return out;
}

/** Пак: приоритет 0 всем, кроме файлов нужных серий; затем запуск. */
async function selectAndStart(db: Db, qbit: Qbit, d: Download, files: DownloadFile[]): Promise<Download> {
  if (d.kind === 'movie') {
    // фильм: только основной видеофайл и внешние дорожки; сэмплы, трейлеры и бонусы не качаем
    const pick = pickMovieFile(files);
    if ('error' in pick) {
      await qbit.remove([d.hash]);
      return update(db, d.id, { state: 'error', files, lastError: pick.error });
    }
    const keep = new Set([pick.main, ...pick.external]);
    const off = files.filter((f) => !keep.has(f.index)).map((f) => f.index);
    if (off.length) await qbit.setFilePriority(d.hash, off, 0);
    d = update(db, d.id, { files: files.map((f) => ({ ...f, priority: keep.has(f.index) ? 1 : 0 })) });
  }
  if (d.kind === 'pack') {
    const map = filesForEpisodes(files, d.season, d.episodes.map((w) => w.number));
    const found = d.episodes.filter((w) => map.has(w.number));
    if (!found.length) {
      await qbit.remove([d.hash]);
      return update(db, d.id, { state: 'error', files, lastError: `В раздаче нет файла ${code(d.episodes[0])}` });
    }
    const keep = new Set([...found.flatMap((w) => map.get(w.number)!), ...externalIndexes(files, d.season, map)]);
    const off = files.filter((f) => !keep.has(f.index)).map((f) => f.index);
    await qbit.setFilePriority(d.hash, off, 0);
    d = update(db, d.id, { episodes: found, files: files.map((f) => ({ ...f, priority: keep.has(f.index) ? 1 : 0 })) });
  }
  dlog.info({ download: d.id, hash: d.hash, on: (d.files ?? []).filter((f) => f.priority > 0).map((f) => f.index) }, 'files selected');
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
    const on = new Set([...episodes.flatMap((w) => map.get(w.number)!), ...externalIndexes(files, d.season, map)]);
    await deps.qbit.setFilePriority(d.hash, [...on], 1);
    next = files.map((f) => (on.has(f.index) ? { ...f, priority: 1 } : f));
  }
  await deps.qbit.start([d.hash]);
  return update(db, d.id, { episodes, files: next, state: 'downloading', lastError: null, completedAt: null, progress: 0 });
}

const LIVE: Download['state'][] = ['adding', 'downloading', 'paused', 'stalled', 'completed', 'imported'];

/** Живая загрузка-пак сериала с раздачей того же топика (того же адреса на трекере). */
export function topicDownload(db: Db, release: Release, season?: number): Download | undefined {
  if (!release.detailsUrl) return undefined;
  if (season === undefined) return undefined;
  return db
    .select({ d: downloads })
    .from(downloads)
    .innerJoin(releases, eq(releases.id, downloads.releaseId))
    .where(and(eq(downloads.titleId, release.titleId), eq(downloads.kind, 'pack'), eq(downloads.season, season), eq(releases.detailsUrl, release.detailsUrl), inArray(downloads.state, LIVE)))
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
  const files: DownloadFile[] = meta.files.map((f) => ({ index: f.index, name: qbitName(meta, f.path), size: f.size, priority: 1 }));
  // топик могли переделать под другой сезон: строгое сопоставление и проверка имени раздачи
  if (otherSeasonInPath(meta.name, old.season)) return { switched: false, reason: 'no-new-episodes' };
  const map = filesForEpisodesStrict(files, old.season, all.filter((e) => e.season === old.season).map((e) => e.number));
  const found = all.filter((e) => e.season === old.season && map.has(e.number));
  if (!found.length) return { switched: false, reason: 'no-new-episodes' };
  // эта версия уже есть у нас — дополняем её, а не добавляем заново
  const known = db.select().from(downloads).where(eq(downloads.hash, meta.infohash)).get();
  if (known) {
    await enableFiles(db, deps, known.id, found);
    return { switched: false, reason: 'same-hash' };
  }

  const savePath = `${deps.paths.qbitDownloads.replace(/\/+$/, '')}/${CATEGORY}`;
  await deps.qbit.ensureCategory(CATEGORY, savePath);
  // прерванная прошлая смена могла оставить торрент в клиенте без записи — подхватываем его
  if (!(await deps.qbit.list(CATEGORY)).some((t) => t.hash === meta.infohash)) await deps.qbit.add(torrent, { savePath, category: CATEGORY, paused: true });
  const keep = new Set([...found.flatMap((e) => map.get(e.number)!), ...externalIndexes(files, old.season, map)]);
  try {
    await deps.qbit.setFilePriority(meta.infohash, files.filter((f) => !keep.has(f.index)).map((f) => f.index), 0);
  } catch (e) {
    // не оставлять в клиенте торрент без записи: следующая попытка начнёт заново
    await deps.qbit.remove([meta.infohash]).catch(() => undefined);
    throw e;
  }
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
      dubPosition: old.dubPosition,
      addedAt: now,
    })
    .returning()
    .get();
  try {
    await deps.qbit.remove([old.hash]);
  } catch (e) {
    dlog.warn({ download: old.id, err: e instanceof Error ? e.message : String(e) }, 'old torrent remove failed');
  }
  const added = found.filter((e) => want.some((w) => w.season === e.season && w.number === e.number));
  update(db, old.id, { state: 'replaced', replacedById: fresh.id, note: addedNote(added.length ? added : found) });
  await deps.qbit.start([meta.infohash]);
  return { switched: true, download: update(db, fresh.id, { state: 'downloading' }), added };
}

/** Серии застрявшей загрузки перешли в замену; не осталось ни одной — торрент убирается из клиента (файлы остаются). */
export async function releaseStalled(db: Db, stalledId: number, moved: EpisodeRef[], replacedById: number, qbit: Qbit) {
  const d = db.select().from(downloads).where(eq(downloads.id, stalledId)).get();
  if (!d) return;
  const left = d.episodes.filter((e) => !moved.some((m) => m.season === e.season && m.number === e.number));
  if (left.length) {
    update(db, d.id, { episodes: left });
    return;
  }
  try {
    await qbit.remove([d.hash]);
  } catch (e) {
    dlog.warn({ download: d.id, err: e instanceof Error ? e.message : String(e) }, 'stalled remove failed');
  }
  update(db, d.id, { state: 'replaced', replacedById, note: 'Заменена: нет сидов' });
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
  const idx = [...[...map.values()].flat(), ...externalIndexes(d.files, d.season, map)];
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

export type Paths = { qbitDownloads?: string; downloads: string; media: string; template?: string; movies?: string; movieTemplate?: string };
const DAY = 86_400_000;

/** Состояние загрузок из qBittorrent; завершённые — импорт нужных файлов в медиатеку. */
export async function syncDownloads(db: Db, deps: { qbit: Qbit; paths: Paths; now?: number; runner?: Runner }) {
  const now = deps.now ?? Date.now();
  const res = { updated: 0, imported: 0, errors: 0 };
  const active = db.select().from(downloads).where(inArray(downloads.state, [...ACTIVE])).all();
  if (!active.length) return res;
  const byHash = new Map((await deps.qbit.list(CATEGORY)).map((t) => [t.hash, t]));
  for (const d of active) {
    const t = byHash.get(d.hash);
    if (!t) {
      update(db, d.id, { state: 'removed' });
      notifyGone(db, d, now);
      res.updated++;
      continue;
    }
    let qfiles: Awaited<ReturnType<Qbit['files']>>;
    try {
      qfiles = await deps.qbit.files(d.hash);
      if (d.state === 'adding' && (d.kind === 'pack' || d.kind === 'movie') && !d.files?.length) {
        if (qfiles.length) await selectAndStart(db, deps.qbit, d, qfiles.map((f) => ({ index: f.index, name: f.name, size: f.size, priority: f.priority })));
        continue;
      }
    } catch (e) {
      // сбой у одной загрузки не мешает остальным
      dlog.warn({ download: d.id, err: e instanceof Error ? e.message : String(e) }, 'qbit files failed');
      res.errors++;
      continue;
    }
    const partial = d.kind === 'pack' || d.kind === 'movie'; // включены не все файлы раздачи
    const wanted = partial ? qfiles.filter((f) => f.priority > 0) : qfiles;
    const total = wanted.reduce((n, f) => n + f.size, 0);
    const progress = partial && total > 0 ? wanted.reduce((n, f) => n + f.progress * f.size, 0) / total : t.progress;
    const done = partial ? wanted.length > 0 && wanted.every((f) => f.progress >= 1) : t.progress >= 1;
    const lastSeededAt = t.num_seeds > 0 ? now : d.lastSeededAt;
    const paused = /^(stopped|paused)/i.test(t.state);
    const stalled = !done && t.num_seeds === 0 && now - (lastSeededAt ?? d.addedAt) > DAY;
    const state = done ? 'completed' : paused ? 'paused' : stalled ? 'stalled' : 'downloading';
    if (state === 'stalled' && d.state !== 'stalled') notifyStalled(db, d, now);
    update(db, d.id, {
      progress,
      dlSpeed: t.dlspeed,
      eta: t.eta,
      contentPath: t.content_path,
      lastSeededAt,
      state,
      ...(state !== 'paused' ? { pausedBySchedule: false } : {}),
      ...(done && !d.completedAt ? { completedAt: now } : {}),
    });
    res.updated++;
    if (!done) continue;
    try {
      const got = await importDownload(db, d, t.save_path, qfiles, deps.paths, now, deps.runner ?? systemRunner);
      notifyImported(db, update(db, d.id, { state: 'imported', importedAt: now, lastError: null, episodes: got }), got, now);
      res.imported++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof RemuxDeferred) continue; // остальные серии пересоберутся в следующий проход
      if (e instanceof WrongEpisodeError) {
        // не та серия: раздача отвергнута для этих серий (ошибка загрузки), торрент убран из клиента без файлов, поиск заново
        const wrong = (e as WrongEpisodeError & { episodes?: EpisodeRef[] }).episodes ?? d.episodes;
        update(db, d.id, { state: 'error', lastError: msg, episodes: wrong, processing: false });
        await deps.qbit.remove([d.hash]).catch(() => undefined);
        enqueue(db, 'subscriptions.search');
        res.errors++;
        continue;
      }
      update(db, d.id, { lastError: e instanceof PathError ? msg : `Ошибка импорта: ${msg}`, processing: false });
      logger('import').warn({ download: d.id, err: msg }, 'import failed');
      res.errors++;
    }
  }
  return res;
}

async function importDownload(db: Db, d: Download, savePath: string, files: { index: number; name: string; size: number; progress?: number }[], paths: Paths, now: number, runner: Runner): Promise<EpisodeRef[]> {
  const title = db.select().from(titles).where(eq(titles.id, d.titleId)).get();
  if (!title) throw new Error('Сериал удалён');
  if (title.kind === 'movie') return importMovie(db, d, title, savePath, files, paths, now, runner);
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
  // каждая серия отдельно: сбой одной не мешает остальным, уже импортированные этой загрузкой не копируются заново
  let failure: unknown = null;
  let deferred = false;
  const wrong: EpisodeRef[] = [];
  const ctx = processingContext(db, d, title, files, savePath, paths, runner);
  update(db, d.id, { processing: true });
  for (const ep of found) {
    try {
      await importEpisode(db, d, ep, title, savePath, files.find((f) => f.index === map.get(ep.number)![0])!, paths, now, ctx);
    } catch (e) {
      if (e instanceof RemuxDeferred) {
        deferred = true;
        continue;
      }
      if (e instanceof WrongEpisodeError) wrong.push(ep);
      failure ??= e;
    }
  }
  update(db, d.id, { processing: false });
  if (deferred && !failure && !wrong.length) throw new RemuxDeferred('остальные серии — в следующий проход');
  if (wrong.length) throw Object.assign(new WrongEpisodeError((failure as Error).message), { episodes: wrong });
  if (failure) throw failure;
  return found;
}

// Фильм: в медиатеке — папка фильмов; файл — основной видеофайл раздачи под условным номером S00E00.
const MOVIE_AUDIO = [
  { id: -1, name: 'Дубляж', aliases: ['Dub', 'Dubbing', 'Дубляж', 'Дублированный', 'Дублирование'] },
  { id: -2, name: 'Многоголосый', aliases: ['MVO', 'DVO', 'Многоголосый', 'Двухголосый'] },
];

async function importMovie(db: Db, d: Download, title: typeof titles.$inferSelect, savePath: string, files: { index: number; name: string; size: number; progress?: number }[], paths: Paths, now: number, runner: Runner): Promise<EpisodeRef[]> {
  const root = mediaRoot(paths, 'movie');
  if (!root) throw new Error('не задана папка фильмов');
  const pick = pickMovieFile(files);
  if ('error' in pick) throw new Error(pick.error);
  const view: Paths = { ...paths, media: root, template: paths.movieTemplate || DEFAULT_MOVIE_TEMPLATE };
  const ctx = processingContext(db, d, title, files, savePath, view, runner);
  const ext = new Set(pick.external);
  const settings = getProcessing(db);
  const local = (name: string) => toLocalPath(`${savePath.replace(/\/+$/, '')}/${name}`, paths.qbitDownloads ?? paths.downloads, paths.downloads);
  const main = files.find((f) => f.index === pick.main)!;
  const movieCtx: ProcessingContext = {
    ...ctx,
    episodesInFile: () => 1,
    externalFor: () =>
      settings.external
        ? findExternal(files.filter((f) => ext.has(f.index) && (f.progress === undefined || f.progress >= 1)).map((f) => f.name), main.name, 0, 0, true).map((e) => ({ ...e, path: local(e.path) }))
        : [],
  };
  update(db, d.id, { processing: true });
  try {
    await importEpisode(db, d, MOVIE_EP, title, savePath, main, view, now, movieCtx);
  } catch (e) {
    if (e instanceof WrongEpisodeError) throw Object.assign(e, { episodes: [MOVIE_EP] });
    throw e;
  } finally {
    update(db, d.id, { processing: false });
  }
  return [MOVIE_EP];
}

type ProcessingContext = {
  base: Omit<Parameters<typeof processEpisode>[0], 'src' | 'targetDir' | 'runtime' | 'external' | 'episodesInFile' | 'allowRemux'>;
  externalFor: (fileName: string, ep: EpisodeRef) => External[];
  episodesInFile: (fileName: string) => number;
  budget: { remux: number };
};

/** Что нужно для пересборки: настройки, нужная и запасные студии, язык оригинала, внешние дорожки раздачи. */
function processingContext(db: Db, d: Download, title: typeof titles.$inferSelect, files: { index: number; name: string; size: number; progress?: number }[], savePath: string, paths: Paths, runner: Runner): ProcessingContext {
  const settings = getProcessing(db);
  const allStudios = db.select().from(studios).all();
  const sub = db.select().from(subscriptions).where(eq(subscriptions.titleId, d.titleId)).get();
  const dubs = sub?.profile.dubs ?? [];
  const pos = d.dubPosition !== null ? dubs[d.dubPosition] : undefined;
  const byLabel = allStudios.find((s) => d.studioLabel && [s.name, ...s.aliases].some((v) => normalizeStudio(v) === normalizeStudio(d.studioLabel!)));
  const movie = title.kind === 'movie';
  // фильм: нужная дорожка — по типу перевода («Dub …», «MVO …»), а не по студии
  const wanted = movie ? (pos?.kind === 'dub' ? [-1] : pos?.kind === 'mvo' ? [-2] : []) : pos?.kind === 'studio' ? [pos.studioId] : byLabel ? [byLabel.id] : [];
  const backups = movie ? [] : dubs.flatMap((x, i) => (x.kind === 'studio' && i !== d.dubPosition ? [x.studioId] : []));
  const local = (name: string) => toLocalPath(`${savePath.replace(/\/+$/, '')}/${name}`, paths.qbitDownloads ?? paths.downloads, paths.downloads);
  const videos = files.filter((f) => isVideo(f.name));
  return {
    base: { runner, settings, wanted, backups, originalLang: title.originalLanguage, studios: movie ? MOVIE_AUDIO : allStudios.map((s) => ({ id: s.id, name: s.name, aliases: s.aliases })) },
    episodesInFile: (fileName) => {
      const f = files.find((x) => x.name === fileName);
      if (!f) return 1;
      const map = filesForEpisodes(files, d.season, d.episodes.map((e) => e.number));
      return Math.max(1, [...map.values()].filter((idx) => idx.includes(f.index)).length);
    },
    budget: { remux: 1 },
    externalFor: (fileName, ep) =>
      settings.external
        ? findExternal(
            // только докачанные внешние дорожки
            files.filter((f) => f.progress === undefined || f.progress >= 1).map((f) => f.name),
            fileName,
            ep.season,
            ep.number,
            videos.length === 1,
          ).map((e) => ({ ...e, path: local(e.path) }))
        : [],
  };
}

async function importEpisode(
  db: Db,
  d: Download,
  ep: EpisodeRef,
  title: typeof titles.$inferSelect,
  savePath: string,
  file: { index: number; name: string; size: number },
  paths: Paths,
  now: number,
  ctx: ProcessingContext,
) {
  const src = toLocalPath(`${savePath.replace(/\/+$/, '')}/${file.name}`, paths.qbitDownloads ?? paths.downloads, paths.downloads);
  const runtime =
    title.kind === 'movie'
      ? title.runtime
      : (db.select({ r: episodes.runtime }).from(episodes).where(and(eq(episodes.titleId, d.titleId), eq(episodes.season, ep.season), eq(episodes.number, ep.number))).get()?.r ?? null);
  await mkdir(paths.media, { recursive: true });
  // уже импортировано этой загрузкой и файл на месте — не пересобирать заново на каждом повторе
  const mine = db
    .select()
    .from(episodeFiles)
    .where(and(eq(episodeFiles.titleId, d.titleId), eq(episodeFiles.season, ep.season), eq(episodeFiles.number, ep.number)))
    .get();
  if (mine?.downloadId === d.id && (await fileExists(path.resolve(paths.media, mine.path)))) {
    if (mine.dubPosition !== d.dubPosition) db.update(episodeFiles).set({ dubPosition: d.dubPosition }).where(eq(episodeFiles.id, mine.id)).run();
    return;
  }
  const proc = await processEpisode({
    ...ctx.base,
    src,
    targetDir: paths.media,
    runtime,
    external: ctx.externalFor(file.name, ep),
    episodesInFile: ctx.episodesInFile(file.name),
    allowRemux: ctx.budget.remux > 0,
    movie: title.kind === 'movie',
  });
  if (proc.kind === 'remux') ctx.budget.remux--;
  const quality = (proc.probe ? resolutionOf(proc.probe) : null) ?? d.resolution;
  const rel = renderTemplate(
    paths.template || (title.kind === 'movie' ? DEFAULT_MOVIE_TEMPLATE : DEFAULT_TEMPLATE),
    { name: title.nameRu, original: title.nameOriginal, year: title.year, season: ep.season, episode: ep.number, studio: d.studioLabel ?? '', quality: quality ? `${quality}p` : '' },
    proc.kind === 'remux' ? '.mkv' : path.extname(file.name),
  );
  const source = proc.kind === 'remux' ? proc.tmp : src;
  try {
    await placeEpisode(db, d, ep, rel, source, file, paths, now, proc, quality);
  } finally {
    if (proc.kind === 'remux') await rm(proc.tmp, { force: true });
  }
}

async function placeEpisode(
  db: Db,
  d: Download,
  ep: EpisodeRef,
  rel: string,
  src: string,
  file: { size: number },
  paths: Paths,
  now: number,
  proc: ProcessResult,
  quality: number | null,
) {
  const own = db
    .select()
    .from(episodeFiles)
    .where(and(eq(episodeFiles.titleId, d.titleId), eq(episodeFiles.season, ep.season), eq(episodeFiles.number, ep.number)))
    .get();
  if (own?.downloadId === d.id && own.path === rel) {
    if (own.dubPosition !== d.dubPosition) db.update(episodeFiles).set({ dubPosition: d.dubPosition }).where(eq(episodeFiles.id, own.id)).run();
    return;
  }
  // улучшение: у серии уже есть файл от другой загрузки — он станет старой копией (spec §8)
  const prev = own && own.downloadId !== d.id ? own : null;
  const stashed = prev && prev.path === rel && (await fileExists(path.resolve(paths.media, rel))) ? await stashOldCopy(paths.media, rel) : null;
  let r: Awaited<ReturnType<typeof importFile>>;
  try {
    r = await importFile(src, paths.media, rel, undefined, { replace: !prev && own?.path === rel });
  } catch (e) {
    if (stashed)
      try {
        await restoreOldCopy(paths.media, stashed, rel);
      } catch (re) {
        // вернуть не вышло — старая копия остаётся в скрытой папке, но видна в списке старых копий
        dlog.warn({ download: d.id, err: re instanceof Error ? re.message : String(re) }, 'old copy restore failed');
        db.insert(oldCopies).values({ titleId: d.titleId, season: ep.season, number: ep.number, path: stashed, size: own?.size ?? 0, reason: 'Не удалось вернуть на место', createdAt: now }).run();
      }
    throw e;
  }
  if (prev) {
    const reason = d.note?.replace(/^Улучшение: /, '') ?? `${prev.studioLabel ?? '?'} → ${d.studioLabel ?? '?'}`;
    try {
      const old = stashed ?? (prev.path !== rel && (await fileExists(path.resolve(paths.media, prev.path))) ? await stashOldCopy(paths.media, prev.path) : null);
      if (old) await settleOldCopy(db, paths.media, old, { titleId: d.titleId, season: ep.season, number: ep.number }, reason, now);
    } catch (e) {
      dlog.warn({ download: d.id, err: e instanceof Error ? e.message : String(e) }, 'old copy handling failed');
    }
  }
  const size = proc.kind === 'remux' ? ((await stat(path.resolve(paths.media, rel)).catch(() => null))?.size ?? file.size) : file.size;
  const row = {
    titleId: d.titleId,
    season: ep.season,
    number: ep.number,
    path: rel,
    size,
    downloadId: d.id,
    studioLabel: d.studioLabel,
    resolution: quality,
    method: r.method,
    importedAt: now,
    dubPosition: d.dubPosition,
    processed: proc.kind === 'remux',
    hdr: proc.probe ? hdrOf(proc.probe) : false,
    duration: proc.probe?.duration ? Math.round(proc.probe.duration) : null,
    tracks: proc.kind === 'remux' ? describePlan(proc.probe, proc.plan, () => undefined) : null,
  };
  db.insert(episodeFiles)
    .values(row)
    .onConflictDoUpdate({ target: [episodeFiles.titleId, episodeFiles.season, episodeFiles.number], set: row })
    .run();
  db.delete(wantedState)
    .where(and(eq(wantedState.titleId, d.titleId), eq(wantedState.season, ep.season), eq(wantedState.number, ep.number)))
    .run();
}
