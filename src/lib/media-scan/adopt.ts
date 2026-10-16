import { copyFile, link, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { episodeFiles, episodes } from '../db/schema';
import type { Paths } from '../downloads';
import type { Qbit } from '../qbit';
import type { Tmdb } from '../tmdb/client';
import type { Runner } from '../media/runner';
import { openTitle } from '../catalog';
import { openMovie } from '../movies';
import { getSubscription, setFilesOnly, subscribe } from '../subscriptions';
import { getDefaultProfile, getMovieDefault } from '../profile';
import { DEFAULT_TEMPLATE, renderTemplate, toLocalPath } from '../library-path';
import { DEFAULT_MOVIE_TEMPLATE } from '../movie-files';
import { processEpisode, WrongEpisodeError } from '../media/process';
import { hdrOf, parseProbe, resolutionOf } from '../media/probe';
import { describePlan, findExternal, getProcessing } from '../media/tracks';
import { isJunk, pruneUp } from '../empty-dirs';
import { INTRO_FIELDS_RESET, resetIntroMarks } from '../intros/run';
import { parseRelease } from '../parse/dubs';
import { listStudios } from '../studios';
import { logger } from '../log';

// Взять найденное в медиатеке в Dublyarr: каталог и подписка, файл — по шаблону (раздаётся — жёсткая ссылка, иначе — перемещение;
// с пересборкой — как при импорте), запись в episode_files. Чужое не перезаписывается; пути — только внутри корня.

const log = logger('storage');

export type AdoptChoice = { key: string; root: 'media' | 'movies'; tmdbId: number; type: 'tv' | 'movie'; filesOnly: boolean; process: boolean; episodes: { rel: string; season: number; number: number; sidecars: string[] }[] };
export type AdoptDeps = { tmdb: Tmdb | null; runner: Runner; paths: Paths; seeding: Set<string> | null; now: number; userCanSubscribe: boolean };
export type AdoptLine = { key: string; title: string; added: number; skipped: { rel: string; why: string }[]; left: number; error?: string };

const inside = (root: string, rel: string) => {
  const top = path.resolve(root);
  const abs = path.resolve(top, rel);
  return abs.startsWith(`${top}${path.sep}`) ? abs : null;
};
const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );
const NONE = { id: '', name: '' };

/** Файлы живых торрентов qBittorrent (локальные пути); null — клиент не настроен или не ответил: тогда всё «раздаётся». */
export async function seedingPaths(qbit: Qbit | null, paths: Paths): Promise<Set<string> | null> {
  if (!qbit) return null;
  try {
    const out = new Set<string>();
    for (const t of await qbit.list()) {
      for (const f of await qbit.files(t.hash)) out.add(path.resolve(toLocalPath(`${t.save_path.replace(/\/+$/, '')}/${f.name}`, paths.qbitDownloads ?? paths.downloads, paths.downloads)));
    }
    return out;
  } catch (e) {
    log.warn({ err: e instanceof Error ? e.message : String(e) }, 'media adopt: qbit unavailable — hardlinks only');
    return null;
  }
}

/** Перенести файл: раздаётся — жёсткая ссылка (другой том — копия), иначе — перемещение. */
async function place(src: string, dst: string, seeding: boolean): Promise<'hardlink' | 'copy' | 'move'> {
  await mkdir(path.dirname(dst), { recursive: true });
  if (!seeding) {
    await rename(src, dst);
    return 'move';
  }
  try {
    await link(src, dst);
    return 'hardlink';
  } catch (e) {
    if (!['EXDEV', 'EPERM', 'ENOTSUP', 'EMLINK'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e;
    await copyFile(src, dst);
    return 'copy';
  }
}

/** Сколько файлов (кроме служебного) осталось в папке — для отчёта «в BEEF/ осталось N». */
async function countFiles(dir: string): Promise<number> {
  let n = 0;
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (isJunk(e.name)) continue;
    n += e.isDirectory() ? await countFiles(path.join(dir, e.name)) : 1;
  }
  return n;
}

export async function adoptItem(db: Db, deps: AdoptDeps, c: AdoptChoice): Promise<AdoptLine> {
  const root = c.root === 'movies' ? (deps.paths.movies ?? deps.paths.media) : deps.paths.media;
  const line: AdoptLine = { key: c.key, title: c.key, added: 0, skipped: [], left: 0 };
  if (!c.episodes.length || c.episodes.some((e) => !inside(root, e.rel) || e.sidecars.some((s) => !inside(root, s)))) return { ...line, error: 'Путь вне медиатеки' };
  try {
    const title = c.type === 'movie' ? (await openMovie(db, deps.tmdb, c.tmdbId, deps.now)).title : (await openTitle(db, deps.tmdb, c.tmdbId, deps.now)).title;
    line.title = title.nameRu;
    if (!getSubscription(db, title.id)) {
      subscribe(db, title.id, title.kind === 'movie' ? getMovieDefault(db) : getDefaultProfile(db, title.kind), deps.now);
      if (c.filesOnly || !deps.userCanSubscribe) setFilesOnly(db, title.id, true, deps.now);
    }
    const movie = title.kind === 'movie';
    const template = movie ? deps.paths.movieTemplate || DEFAULT_MOVIE_TEMPLATE : deps.paths.template || DEFAULT_TEMPLATE;
    const studios = listStudios(db);
    const refs = studios.map((s) => ({ id: s.id, name: s.name, aliases: s.aliases, trackers: s.trackers }));
    const studioLabel = (rel: string) => {
      const id = parseRelease(path.basename(rel, path.extname(rel)), {}, NONE, refs).dubs.find((d) => d.studioId !== null)?.studioId;
      return studios.find((s) => s.id === id)?.name ?? '';
    };
    for (const e of c.episodes) {
      const src = inside(root, e.rel)!;
      const seed = deps.seeding === null || deps.seeding.has(path.resolve(src));
      const runtime = movie
        ? title.runtime
        : (db.select({ r: episodes.runtime }).from(episodes).where(and(eq(episodes.titleId, title.id), eq(episodes.season, e.season), eq(episodes.number, e.number))).get()?.r ?? null);
      let proc: Awaited<ReturnType<typeof processEpisode>> = { kind: 'link', probe: null };
      if (c.process) {
        try {
          const settings = getProcessing(db);
          const external = settings.external ? findExternal(e.sidecars, e.rel, e.season, e.number, c.episodes.length === 1).map((x) => ({ ...x, path: inside(root, x.path)! })) : [];
          proc = await processEpisode({ runner: deps.runner, src, targetDir: root, settings, runtime, wanted: [], backups: [], originalLang: title.originalLanguage, studios: studios.map((s) => ({ id: s.id, name: s.name, aliases: s.aliases })), external, movie });
        } catch (err) {
          if (err instanceof WrongEpisodeError) {
            line.skipped.push({ rel: e.rel, why: `Не та серия: ${err.message}` });
            continue;
          }
          throw err;
        }
      }
      const quality = (proc.probe ? resolutionOf(proc.probe) : null) ?? parseRelease(path.basename(e.rel), {}, NONE, refs).resolution ?? null;
      const studio = studioLabel(e.rel);
      const rel = renderTemplate(template, { name: title.nameRu, original: title.nameOriginal, year: title.year, season: e.season, episode: e.number, studio, quality: quality ? `${quality}p` : '' }, proc.kind === 'remux' ? '.mkv' : path.extname(e.rel));
      const dst = inside(root, rel);
      if (!dst) {
        line.skipped.push({ rel: e.rel, why: 'Путь вне медиатеки' });
        continue;
      }
      if (await exists(dst)) {
        line.skipped.push({ rel: e.rel, why: `Уже есть: ${rel}` });
        if (proc.kind === 'remux') await rm(proc.tmp, { force: true });
        continue;
      }
      let method: 'hardlink' | 'copy' | 'move';
      if (proc.kind === 'remux') {
        // результат читается и по длительности совпадает с исходником (±2 %) — иначе оригинал не трогаем
        const out = parseProbe(await deps.runner.probe(proc.tmp));
        const ok = !!out.duration && !!proc.probe.duration && Math.abs(out.duration - proc.probe.duration) <= proc.probe.duration * 0.02;
        if (!ok) {
          await rm(proc.tmp, { force: true });
          line.skipped.push({ rel: e.rel, why: 'Пересборка не прошла проверку' });
          continue;
        }
        await mkdir(path.dirname(dst), { recursive: true });
        await rename(proc.tmp, dst);
        method = 'copy';
        if (!seed) await rm(src, { force: true }); // оригинал после проверенной пересборки — только по явному «Пересобрать»
      } else method = await place(src, dst, seed);
      const stemOld = path.basename(e.rel, path.extname(e.rel));
      const stemNew = path.basename(rel, path.extname(rel));
      for (const s of e.sidecars) {
        const sd = path.join(path.dirname(dst), stemNew + path.basename(s).slice(stemOld.length));
        const from = inside(root, s)!;
        if (!(await exists(sd)) && (await exists(from))) await place(from, sd, seed);
      }
      const size = (await stat(dst)).size;
      db.insert(episodeFiles)
        .values({
          titleId: title.id,
          season: e.season,
          number: e.number,
          path: rel,
          size,
          downloadId: null,
          studioLabel: studio || null,
          resolution: quality,
          method,
          importedAt: deps.now,
          dubPosition: null,
          processed: proc.kind === 'remux',
          hdr: proc.probe ? hdrOf(proc.probe) : false,
          duration: proc.probe?.duration ? Math.round(proc.probe.duration) : null,
          tracks: proc.kind === 'remux' ? describePlan(proc.probe, proc.plan, () => undefined) : null,
          ...INTRO_FIELDS_RESET,
        })
        .run();
      if (!movie) resetIntroMarks(db, title.id, e.season);
      log.info({ title: title.id, from: e.rel, to: rel, method }, 'media adopt');
      line.added++;
    }
    for (const d of new Set(c.episodes.map((e) => path.dirname(inside(root, e.rel)!)))) await pruneUp(d, root);
    const top = c.key.split('/')[0];
    line.left = c.episodes[0].rel === c.key ? Number(await exists(inside(root, c.key)!)) : await countFiles(path.join(root, top));
  } catch (e) {
    line.error = e instanceof Error ? e.message : String(e);
    log.warn({ key: c.key, err: line.error }, 'media adopt failed');
  }
  return line;
}
