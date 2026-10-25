import { constants as fsConstants } from 'node:fs';
import { copyFile, link, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { episodeFiles, episodes, subscriptions } from '../db/schema';
import type { Paths } from '../downloads';
import type { Qbit } from '../qbit';
import type { Tmdb } from '../tmdb/client';
import type { Runner } from '../media/runner';
import { listSeasons, openTitle } from '../catalog';
import { absoluteToSeason } from '../match';
import { openMovie } from '../movies';
import { getSubscription, setFilesOnly, subscribe } from '../subscriptions';
import { getDefaultProfile, getMovieDefault } from '../profile';
import { DEFAULT_TEMPLATE, renderTemplate, resolveLocalPath } from '../library-path';
import { DEFAULT_MOVIE_TEMPLATE, mediaRoot } from '../movie-files';
import { processEpisode, WrongEpisodeError } from '../media/process';
import { wrongEpisode, wrongMovie } from '../media/checks';
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
      for (const f of await qbit.files(t.hash)) out.add(path.resolve(resolveLocalPath(`${t.save_path.replace(/\/+$/, '')}/${f.name}`, paths.qbitDownloads ?? paths.downloads, paths.downloads)));
    }
    return out;
  } catch (e) {
    log.warn({ err: e instanceof Error ? e.message : String(e) }, 'media adopt: qbit unavailable — hardlinks only');
    return null;
  }
}

/** Студия (по словарю) и качество из имени файла — для имени по шаблону. */
export function nameParts(db: Db, rel: string): { studio: string; quality: number | null } {
  const studios = listStudios(db);
  const p = parseRelease(path.basename(rel, path.extname(rel)), {}, NONE, studios.map((s) => ({ id: s.id, name: s.name, aliases: s.aliases, trackers: s.trackers })));
  const id = p.dubs.find((d) => d.studioId !== null)?.studioId;
  return { studio: studios.find((s) => s.id === id)?.name ?? '', quality: p.resolution ?? null };
}

const CROSS = ['EXDEV', 'EPERM', 'ENOTSUP', 'EMLINK'];
const code = (e: unknown) => (e as NodeJS.ErrnoException).code ?? '';

/** Копия без перезаписи (COPYFILE_EXCL) и сверка размера — для другого тома. */
async function copyChecked(src: string, dst: string) {
  await copyFile(src, dst, fsConstants.COPYFILE_EXCL);
  if ((await stat(dst)).size !== (await stat(src)).size) {
    await rm(dst, { force: true });
    throw new Error('Копия не совпала по размеру');
  }
}

/** Перенести файл: раздаётся — жёсткая ссылка (другой том — копия), иначе — перемещение (другой том — копия, затем удаление источника). */
async function place(src: string, dst: string, seeding: boolean): Promise<'hardlink' | 'copy' | 'move'> {
  await mkdir(path.dirname(dst), { recursive: true });
  if (!seeding) {
    try {
      await rename(src, dst);
    } catch (e) {
      if (code(e) !== 'EXDEV') throw e;
      await copyChecked(src, dst);
      await rm(src, { force: true });
    }
    return 'move';
  }
  try {
    await link(src, dst);
    return 'hardlink';
  } catch (e) {
    if (!CROSS.includes(code(e))) throw e;
    await copyChecked(src, dst);
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
  // источник — корень, где нашли; назначение — корень по типу (фильмы — папка фильмов), как его потом ищут все остальные
  const root = c.root === 'movies' ? (deps.paths.movies ?? deps.paths.media) : deps.paths.media;
  const line: AdoptLine = { key: c.key, title: c.key, added: 0, skipped: [], left: 0 };
  if (!c.episodes.length || c.episodes.some((e) => !inside(root, e.rel) || e.sidecars.some((s) => !inside(root, s)))) return { ...line, error: 'Путь вне медиатеки' };
  try {
    const title = c.type === 'movie' ? (await openMovie(db, deps.tmdb, c.tmdbId, deps.now)).title : (await openTitle(db, deps.tmdb, c.tmdbId, deps.now)).title;
    line.title = title.nameRu;
    const movie = title.kind === 'movie';
    const target = mediaRoot(deps.paths, title.kind);
    if (!target) return { ...line, error: 'Не задана папка фильмов' };
    if (!getSubscription(db, title.id)) {
      subscribe(db, title.id, title.kind === 'movie' ? getMovieDefault(db) : getDefaultProfile(db, title.kind), deps.now);
      if (c.filesOnly || !deps.userCanSubscribe) {
        setFilesOnly(db, title.id, true, deps.now);
        // «только файлы» — по умолчанию «хранить все сезоны»: правило «сезоны» не удалит только что взятые файлы пользователя
        db.update(subscriptions).set({ keepAll: true }).where(eq(subscriptions.titleId, title.id)).run();
      }
    }
    const template = movie ? deps.paths.movieTemplate || DEFAULT_MOVIE_TEMPLATE : deps.paths.template || DEFAULT_TEMPLATE;
    const studios = listStudios(db);
    const avail = await deps.runner.available();
    // сквозная нумерация (сезон 1, номер больше серий в нём) — в сезон и серию по TMDB
    const counts = movie ? [] : listSeasons(db, title.id).filter((x) => x.number > 0).map((x) => ({ season: x.number, count: x.episodeCount }));
    const realEp = (season: number, number: number) => {
      const first = counts.find((x) => x.season === 1);
      return season === 1 && first && number > first.count ? (absoluteToSeason(number, counts) ?? { season, episode: number }) : { season, episode: number };
    };
    for (const raw of c.episodes) {
      const ep = realEp(raw.season, raw.number);
      const e = { ...raw, season: ep.season, number: ep.episode };
      const src = inside(root, e.rel)!;
      // серия уже есть в Dublyarr — второй экземпляр не нужен (повтор, две папки одного сериала, импорт тем временем)
      const own = db.select().from(episodeFiles).where(and(eq(episodeFiles.titleId, title.id), eq(episodeFiles.season, e.season), eq(episodeFiles.number, e.number))).get();
      if (own) {
        line.skipped.push({ rel: e.rel, why: `Уже есть в Dublyarr: ${own.path}` });
        continue;
      }
      if (!(await exists(src))) {
        line.skipped.push({ rel: e.rel, why: 'Файла нет' });
        continue;
      }
      const seed = deps.seeding === null || deps.seeding.has(path.resolve(src));
      const runtime = movie
        ? title.runtime
        : (db.select({ r: episodes.runtime }).from(episodes).where(and(eq(episodes.titleId, title.id), eq(episodes.season, e.season), eq(episodes.number, e.number))).get()?.r ?? null);
      let proc: Awaited<ReturnType<typeof processEpisode>> = { kind: 'link', probe: null };
      try {
        if (c.process) {
          const settings = getProcessing(db);
          const external = settings.external ? findExternal(e.sidecars, e.rel, e.season, e.number, c.episodes.length === 1).map((x) => ({ ...x, path: inside(root, x.path)! })) : [];
          proc = await processEpisode({ runner: deps.runner, src, targetDir: target, settings, runtime, wanted: [], backups: [], originalLang: title.originalLanguage, studios: studios.map((s) => ({ id: s.id, name: s.name, aliases: s.aliases })), external, movie });
        } else if (avail.ffprobe) {
          // без пересборки — та же проверка «та ли серия» и настоящее разрешение / HDR / длительность
          const probe = parseProbe(await deps.runner.probe(src));
          const wrong = movie ? wrongMovie(probe.duration, runtime) : wrongEpisode(probe.duration, runtime);
          if (wrong) throw new WrongEpisodeError(wrong);
          proc = { kind: 'link', probe };
        }
      } catch (err) {
        if (err instanceof WrongEpisodeError) {
          line.skipped.push({ rel: e.rel, why: `Не та серия: ${err.message}` });
          continue;
        }
        throw err;
      }
      const parts = nameParts(db, e.rel);
      const quality = (proc.probe ? resolutionOf(proc.probe) : null) ?? parts.quality;
      const studio = parts.studio;
      const rel = renderTemplate(template, { name: title.nameRu, original: title.nameOriginal, year: title.year, season: e.season, episode: e.number, studio, quality: quality ? `${quality}p` : '' }, proc.kind === 'remux' ? '.mkv' : path.extname(e.rel));
      const dst = inside(target, rel);
      if (!dst) {
        line.skipped.push({ rel: e.rel, why: 'Путь вне медиатеки' });
        continue;
      }
      const inPlace = proc.kind !== 'remux' && path.resolve(src) === path.resolve(dst);
      if (!inPlace && (await exists(dst))) {
        line.skipped.push({ rel: e.rel, why: `Уже есть: ${rel}` });
        if (proc.kind === 'remux') await rm(proc.tmp, { force: true });
        continue;
      }
      let method: 'hardlink' | 'copy' | 'move';
      if (inPlace) method = 'move'; // уже лежит по шаблону — только запись
      else if (proc.kind === 'remux') {
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
      // запись — сразу после того, как видео на месте: дальше сбой (субтитры) не оставит файл без учёта
      const size = (await stat(dst)).size;
      db.insert(episodeFiles)
        .values({
          titleId: title.id,
          season: e.season,
          number: e.number,
          path: rel,
          size,
          downloadId: null,
          adopted: true,
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
      const stemOld = path.basename(e.rel, path.extname(e.rel));
      const stemNew = path.basename(rel, path.extname(rel));
      for (const sc of e.sidecars) {
        try {
          const sd = path.join(path.dirname(dst), stemNew + path.basename(sc).slice(stemOld.length));
          const from = inside(root, sc)!;
          if (!(await exists(sd)) && (await exists(from))) await place(from, sd, seed);
        } catch (err) {
          line.skipped.push({ rel: sc, why: `Субтитры не перенесены: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
    }
    for (const d of new Set(c.episodes.map((e) => path.dirname(inside(root, e.rel)!)))) await pruneUp(d, root);
    line.left = c.episodes[0].rel === c.key ? Number(await exists(inside(root, c.key)!)) : await countFiles(path.join(root, c.key));
  } catch (e) {
    line.error = e instanceof Error ? e.message : String(e);
    log.warn({ key: c.key, err: line.error }, 'media adopt failed');
  }
  return line;
}
