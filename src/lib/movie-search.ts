import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from './db/client';
import { downloads, episodeFiles, releases as releasesT, subscriptions, titles, type EpisodeFile } from './db/schema';
import { searchTitle } from './search';
import { evaluateMovie, decideMovie, movieSource, type MovieSource, type MovieVerdict } from './movie-evaluate';
import { isMovieProfile, MOVIE_DUB_LABEL, type MovieProfile } from './movie-profile';
import { digitalReleased, MOVIE_EP } from './movies';
import { activeDownloads, releaseStalled, startRelease, type DownloadDeps } from './downloads';
import { clearWanted, setWanted } from './wanted';
import { formatShortDate, todayIso } from './dates';
import { log } from './log';
import type { AutoDeps } from './autosearch';

// Поиск и загрузка фильма по подписке (spec §10): ожидание дубляжа после цифрового релиза, замена на дубляж и до BDRemux.

const DAY = 86_400_000;
export const DUB_REPLACE_DAYS = 180;
const SOURCE_LABEL: Record<MovieSource, string> = { webdl: 'WEB-DL', webrip: 'WEBRip', bdrip: 'BDRip', remux: 'BDRemux', hdtv: 'HDTV', dvd: 'DVD', cam: 'экранка', disc: 'диск' };
const label = (p: MovieProfile, pos: number | null) => {
  const k = pos === null ? null : p.dubs[pos]?.kind;
  return k === 'original' ? 'Оригинал' : k ? MOVIE_DUB_LABEL[k] : null;
};

/** Скачанный фильм стоит заменить: дубляж вместо перевода ниже (180 дней после импорта) или BDRemux вместо прочего. */
export function movieUpgrade(file: Pick<EpisodeFile, 'dubPosition' | 'importedAt'>, verdicts: MovieVerdict[], profile: MovieProfile, today: string, fileSource: MovieSource | null) {
  const pos = file.dubPosition;
  const kind = pos === null ? null : (profile.dubs[pos]?.kind ?? null);
  const ok = verdicts.filter((v) => v.ok && v.position !== null).sort((a, b) => Number(b.best) - Number(a.best));
  if (wantsDub(file, profile, today)) {
    const v = ok.find((x) => profile.dubs[x.position!].kind === 'dub');
    if (v) return { v, note: `Улучшение: ${kind ? MOVIE_DUB_LABEL[kind].toLowerCase() : 'перевод'} → дубляж` };
  }
  if (profile.remux && fileSource !== 'remux') {
    const v = ok.find((x) => x.remux && (pos === null || x.position! <= pos));
    if (v) return { v, note: `Улучшение: ${fileSource ? SOURCE_LABEL[fileSource] : 'файл'} → BDRemux` };
  }
  return null;
}

function wantsDub(file: Pick<EpisodeFile, 'dubPosition' | 'importedAt'>, profile: MovieProfile, today: string) {
  const kind = file.dubPosition === null ? null : profile.dubs[file.dubPosition]?.kind;
  return profile.replaceWithDub && kind !== 'dub' && Date.parse(today) - file.importedAt <= DUB_REPLACE_DAYS * DAY;
}

/** Источник раздачи, из которой взят файл (для «до BDRemux»). */
function sourceOfFile(db: Db, f: EpisodeFile): { source: MovieSource | null; releaseId: number | null } {
  const rel = f.downloadId ? db.select({ id: releasesT.id, title: releasesT.title, parsed: releasesT.parsed }).from(downloads).innerJoin(releasesT, eq(releasesT.id, downloads.releaseId)).where(eq(downloads.id, f.downloadId)).get() : undefined;
  return rel ? { source: movieSource(rel.title, rel.parsed), releaseId: rel.id } : { source: null, releaseId: null };
}

export async function searchMovie(db: Db, titleId: number, deps: AutoDeps) {
  const res = { started: 0, waiting: 0, missing: 0 };
  const now = deps.now ?? Date.now();
  const today = deps.today ?? todayIso();
  const sub = db.select().from(subscriptions).where(eq(subscriptions.titleId, titleId)).get();
  if (!sub || !isMovieProfile(sub.profile)) return res;
  const profile = sub.profile;
  const ep = MOVIE_EP;
  if (!deps.paths.movies) {
    setWanted(db, titleId, ep, 'missing', 'Не задана папка фильмов', null, now);
    res.missing++;
    return res;
  }
  const file = db.select().from(episodeFiles).where(and(eq(episodeFiles.titleId, titleId), eq(episodeFiles.season, 0), eq(episodeFiles.number, 0))).get();
  const active = activeDownloads(db, titleId);
  const stalled = active.filter((d) => d.state === 'stalled');
  if (active.some((d) => d.state !== 'stalled')) return res; // уже качается (или улучшение в пути)
  const own = file ? sourceOfFile(db, file) : null;
  if (file && !wantsDub(file, profile, today) && !(profile.remux && own?.source !== 'remux')) return res; // улучшать нечего — без запросов

  const { releases } = await searchTitle(db, titleId, { ...deps.searchOpts, now });
  const title = db.select().from(titles).where(eq(titles.id, titleId)).get()!;
  const rejected = new Set(
    db
      .select({ r: downloads.releaseId })
      .from(downloads)
      .where(and(eq(downloads.titleId, titleId), inArray(downloads.state, ['error', 'removed', 'stalled'])))
      .all()
      .map((x) => x.r),
  );
  const usable = releases.filter((r) => !rejected.has(r.id) && r.id !== own?.releaseId);
  const digital = digitalReleased(title, today);
  const verdicts = evaluateMovie(usable, { profile, digital, today });
  const byId = new Map(usable.map((r) => [r.id, r]));
  const dl: DownloadDeps | null = deps.qbit ? { qbit: deps.qbit, fetchTorrent: deps.fetchTorrent, paths: { qbitDownloads: deps.paths.qbitDownloads ?? deps.paths.downloads }, now } : null;

  if (file) {
    const up = movieUpgrade(file, verdicts, profile, today, own?.source ?? null);
    if (!up || !dl) return res;
    try {
      const d = await startRelease(db, dl, byId.get(up.v.releaseId)!, [ep], 'movie', label(profile, up.v.position), { dubPosition: up.v.position, note: up.note });
      if (d.state !== 'error') res.started++;
    } catch (e) {
      log.warn({ titleId, err: e instanceof Error ? e.message : String(e) }, 'movie upgrade failed');
    }
    return res;
  }

  const decision = decideMovie(verdicts, profile, digital);
  if (decision.action === 'wait') {
    const reason = decision.state === 'digital' ? 'Ждём цифровой релиз' : `Ждём дубляж до ${formatShortDate(decision.until!, today)}`;
    setWanted(db, titleId, ep, 'waiting', reason, decision.until ?? null, now);
    res.waiting++;
    return res;
  }
  if (decision.action === 'none' || decision.action === 'ask') {
    if (decision.action === 'ask') setWanted(db, titleId, ep, 'ask', decision.reason, null, now, decision.releaseId);
    else setWanted(db, titleId, ep, 'missing', 'Нет раздач', null, now);
    res.missing++;
    return res;
  }
  if (!dl) {
    setWanted(db, titleId, ep, 'missing', 'qBittorrent не подключён', null, now);
    res.missing++;
    return res;
  }
  const v = verdicts.find((x) => x.releaseId === decision.releaseId)!;
  try {
    const d = await startRelease(db, dl, byId.get(v.releaseId)!, [ep], 'movie', label(profile, v.position), { dubPosition: v.position });
    if (d.state === 'error') {
      setWanted(db, titleId, ep, 'missing', d.lastError ?? 'Ошибка загрузки', null, now);
      res.missing++;
      return res;
    }
    clearWanted(db, titleId, ep);
    for (const st of stalled) await releaseStalled(db, st.id, [ep], d.id, dl.qbit);
    res.started++;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn({ titleId, err: msg }, 'movie start failed');
    setWanted(db, titleId, ep, 'missing', msg, null, now);
    res.missing++;
  }
  return res;
}
