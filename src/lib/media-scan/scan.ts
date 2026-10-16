import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { episodeFiles, oldCopies, titles } from '../db/schema';
import type { Paths } from '../downloads';
import type { Qbit } from '../qbit';
import type { Tmdb } from '../tmdb/client';
import { isJunk } from '../empty-dirs';
import { notify } from '../notify';
import { groupFiles, type ScanFile } from './group';
import { recognize, tmdbSearch, type Candidate, type Search } from './recognize';
import { DEFAULT_TEMPLATE, renderTemplate } from '../library-path';
import { DEFAULT_MOVIE_TEMPLATE } from '../movie-files';
import { adoptItem, nameParts, seedingPaths, type AdoptChoice, type AdoptDeps, type AdoptLine } from './adopt';
import { getScanState, setScanState, updateScanState, type ScanEntry } from './state';

const code = (s: number, n: number) => `S${String(s).padStart(2, '0')}E${String(n).padStart(2, '0')}`;

/** Все файлы под корнем (пути от корня); служебное и скрытые папки верхнего уровня (.dublyarr-old, .dublyarr-tmp) — мимо. */
async function walk(root: string, rel = ''): Promise<ScanFile[]> {
  const out: ScanFile[] = [];
  for (const e of await readdir(path.join(root, rel), { withFileTypes: true }).catch(() => [])) {
    if (isJunk(e.name) || (!rel && e.name.startsWith('.'))) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(root, r)));
    else if (e.isFile()) out.push({ rel: r, size: (await stat(path.join(root, r)).catch(() => null))?.size ?? 0 });
  }
  return out;
}

/** Обойти медиатеку (и папку фильмов): что лежит и не записано в Dublyarr, — позиции с кандидатом TMDB. */
export async function runMediaScan(db: Db, deps: { tmdb: Tmdb | null; paths: Paths; search?: Search; now?: number }) {
  const prev = getScanState(db);
  updateScanState(db, { status: 'scanning', progress: { done: 0, total: 0 } });
  try {
    const known = new Set([...db.select({ p: episodeFiles.path }).from(episodeFiles).all(), ...db.select({ p: oldCopies.path }).from(oldCopies).all()].map((r) => r.p));
    // папка верхнего уровня, в которой уже лежат файлы сериала из Dublyarr, — этот сериал
    const files = db.select({ path: episodeFiles.path, titleId: episodeFiles.titleId }).from(episodeFiles).all();
    const all = db.select().from(titles).all();
    const ownerOf = new Map(files.map((f) => [f.path.split('/')[0], all.find((t) => t.id === f.titleId)]));
    const search = deps.search ?? (deps.tmdb ? tmdbSearch(deps.tmdb) : null);
    const roots: ['media' | 'movies', string][] = [['media', deps.paths.media]];
    if (deps.paths.movies && path.resolve(deps.paths.movies) !== path.resolve(deps.paths.media)) roots.push(['movies', deps.paths.movies]);
    const items: ScanEntry[] = [];
    const skipped: { key: string; why: string }[] = [];
    for (const [kind, root] of roots) {
      const g = groupFiles((await walk(root)).filter((f) => !known.has(f.rel)), kind);
      skipped.push(...g.skipped);
      for (const [i, item] of g.items.entries()) {
        updateScanState(db, { progress: { done: i, total: g.items.length } });
        const owner = ownerOf.get(item.key);
        let candidate: Candidate | null = null;
        let sure = false;
        if (owner) {
          candidate = { tmdbId: owner.tmdbId, type: owner.tmdbType, name: owner.nameRu, original: owner.nameOriginal, year: owner.year, posterPath: owner.posterPath, score: 1 };
          sure = true;
        } else if (search) ({ best: candidate, sure } = await recognize(item, search));
        const t = candidate && all.find((x) => x.tmdbId === candidate!.tmdbId && x.tmdbType === candidate!.type);
        const haveCodes = new Set(t ? db.select({ s: episodeFiles.season, n: episodeFiles.number }).from(episodeFiles).where(eq(episodeFiles.titleId, t.id)).all().map((f) => code(f.s, f.n)) : []);
        const first = item.episodes[0];
        const parts = first ? nameParts(db, first.rel) : null;
        const template = item.kind === 'movie' ? deps.paths.movieTemplate || DEFAULT_MOVIE_TEMPLATE : deps.paths.template || DEFAULT_TEMPLATE;
        const example =
          candidate && first && parts
            ? renderTemplate(template, { name: candidate.name, original: candidate.original, year: candidate.year, season: first.season, episode: first.number, studio: parts.studio, quality: parts.quality ? `${parts.quality}p` : '' }, path.extname(first.rel))
            : null;
        items.push({ ...item, candidate, sure, example, have: item.episodes.map((e) => code(e.season, e.number)).filter((c) => haveCodes.has(c)) });
      }
    }
    items.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const state = { status: 'idle' as const, scannedAt: deps.now ?? Date.now(), items, skipped, last: prev.last };
    setScanState(db, state);
    return state;
  } catch (e) {
    updateScanState(db, { status: 'idle', progress: undefined });
    throw e;
  }
}

/** Взять отмеченное: позиции по одной, итог — в состояние и одной сводкой в Telegram. */
export async function runAdopt(db: Db, deps: Omit<AdoptDeps, 'seeding'> & { qbit: Qbit | null }, choices: AdoptChoice[]): Promise<AdoptLine[]> {
  updateScanState(db, { status: 'adopting', progress: { done: 0, total: choices.length } });
  const lines: AdoptLine[] = [];
  try {
    const seeding = await seedingPaths(deps.qbit, deps.paths);
    for (const [i, c] of choices.entries()) {
      updateScanState(db, { progress: { done: i, total: choices.length } });
      lines.push(await adoptItem(db, { ...deps, seeding }, c));
    }
  } finally {
    const done = new Set(lines.filter((l) => !l.error && l.added).map((l) => l.key));
    const s = getScanState(db);
    setScanState(db, { ...s, status: 'idle', progress: undefined, items: s.items.filter((i) => !done.has(i.key)), last: { at: deps.now, lines } });
  }
  const added = lines.reduce((n, l) => n + l.added, 0);
  if (added) notify(db, { key: `adopt:${deps.now}`, kind: 'downloaded', text: `📥 Взято в Dublyarr: ${added} файл(ов) · ${lines.filter((l) => l.added).map((l) => l.title).join(', ')}`, need: 'storage' }, deps.now);
  return lines;
}
