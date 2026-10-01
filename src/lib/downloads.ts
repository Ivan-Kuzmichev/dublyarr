import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from './db/client';
import { downloads, type Download, type DownloadFile, type EpisodeRef, type Release } from './db/schema';
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

  const savePath = `${deps.paths.qbitDownloads.replace(/\/+$/, '')}/${CATEGORY}`;
  await deps.qbit.ensureCategory(CATEGORY, savePath);
  await deps.qbit.add(torrent, { savePath, category: CATEGORY, paused: true });
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
  let d = existing ? update(db, existing.id, row) : db.insert(downloads).values(row).returning().get();

  if (kind === 'pack' && files.length) {
    const map = filesForEpisodes(files, d.season, want.map((w) => w.number));
    const found = want.filter((w) => map.has(w.number));
    if (!found.length) {
      await deps.qbit.remove([d.hash]);
      return update(db, d.id, { state: 'error', lastError: `В раздаче нет файла ${code(want[0])}` });
    }
    const keep = new Set(found.flatMap((w) => map.get(w.number)!));
    const off = files.filter((f) => !keep.has(f.index)).map((f) => f.index);
    await deps.qbit.setFilePriority(d.hash, off, 0);
    d = update(db, d.id, { episodes: found, files: files.map((f) => ({ ...f, priority: keep.has(f.index) ? 1 : 0 })) });
  }
  await deps.qbit.start([d.hash]);
  return update(db, d.id, { state: 'downloading' });
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
