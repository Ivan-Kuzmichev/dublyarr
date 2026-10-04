import { and, asc, eq, isNull, lte, ne, or } from 'drizzle-orm';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { Db } from '../db/client';
import { episodeFiles, titles, type EpisodeFile } from '../db/schema';
import { logger } from '../log';
import { storageState } from '../storage';
import { getRetention } from '../retention-settings';
import { TMP_DIR } from '../media/process';
import { commonSegment } from './fingerprint';
import { agree, nearest, windows, type Seg } from './detect';
import { buildChapters, decideWrite } from './chapters';
import { getIntroSettings } from './settings';
import type { IntroTools } from './tools';

// Разметка заставок по сезону: выбор сезона, отпечатки, согласие соседей, запись глав.

/** Поля разметки — в null: импорт (новый файл или замена) пишет их вместе с остальными. */
export const INTRO_FIELDS_RESET = { introState: null, introNote: null, introStart: null, introEnd: null, creditsStart: null, creditsEnd: null, introCheckedAt: null } as const;

/** Новая серия в сезоне — новый сосед: «не нашлось» проверяется заново. */
export function resetIntroMarks(db: Db, titleId: number, season: number) {
  db.update(episodeFiles)
    .set({ introState: null, introNote: null })
    .where(and(eq(episodeFiles.titleId, titleId), eq(episodeFiles.season, season), eq(episodeFiles.introState, 'none')))
    .run();
}


const log = logger('import');
const WAIT_RECHECK = 3_600_000;

/** Сезон, где есть файлы без проверки или ждущие места (не чаще раза в час); фильмы — нет. */
export function nextSeason(db: Db, now: number): { titleId: number; season: number } | null {
  const row = db
    .select({ titleId: episodeFiles.titleId, season: episodeFiles.season })
    .from(episodeFiles)
    .innerJoin(titles, eq(titles.id, episodeFiles.titleId))
    .where(
      and(
        ne(titles.kind, 'movie'),
        or(isNull(episodeFiles.introState), and(eq(episodeFiles.introState, 'waiting'), or(isNull(episodeFiles.introCheckedAt), lte(episodeFiles.introCheckedAt, now - WAIT_RECHECK)))),
      ),
    )
    .orderBy(asc(episodeFiles.introState), asc(episodeFiles.importedAt))
    .get();
  return row ?? null;
}

type Prints = { head: Uint32Array; tail: Uint32Array; tailStart: number; duration: number };

async function printsOf(f: EpisodeFile, abs: string, tools: IntroTools, cacheDir: string): Promise<Prints | null> {
  const duration = f.duration ?? (await tools.duration(abs));
  if (!duration) return null;
  const w = windows(duration);
  const key = path.join(cacheDir, `${f.id}-${f.importedAt}`);
  const load = async (part: 'head' | 'tail', [start, dur]: Seg) => {
    const file = `${key}-${part}.bin`;
    const cached = await readFile(file).catch(() => null);
    if (cached) return new Uint32Array(cached.buffer.slice(cached.byteOffset, cached.byteOffset + cached.byteLength));
    const fp = await tools.fingerprint(abs, start, dur);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, Buffer.from(fp.buffer, fp.byteOffset, fp.byteLength));
    return fp;
  };
  return { head: await load('head', w.head), tail: await load('tail', w.tail), tailStart: w.tail[0], duration };
}

const ms = (s: Seg | null) => (s ? [Math.round(s[0] * 1000), Math.round(s[1] * 1000)] : [null, null]);

export async function processSeason(db: Db, tools: IntroTools, o: { media: string; cacheDir: string; now: number }) {
  const next = nextSeason(db, o.now);
  if (!next) return null;
  const files = db.select().from(episodeFiles).where(and(eq(episodeFiles.titleId, next.titleId), eq(episodeFiles.season, next.season))).orderBy(asc(episodeFiles.number)).all();
  const set = (id: number, v: Partial<EpisodeFile>) => db.update(episodeFiles).set({ introCheckedAt: o.now, ...v }).where(eq(episodeFiles.id, id)).run();
  const todo = files.filter((f) => f.introState === null || (f.introState === 'waiting' && (!f.introCheckedAt || f.introCheckedAt <= o.now - WAIT_RECHECK)));
  const absOf = (f: EpisodeFile) => path.join(o.media, f.path);

  // пригодные для сравнения: mkv, есть на диске, без своих глав
  const usable: EpisodeFile[] = [];
  for (const f of files) {
    const own = todo.includes(f);
    try {
      if (path.extname(f.path).toLowerCase() !== '.mkv') {
        if (own) set(f.id, { introState: 'skipped', introNote: 'не mkv' });
        continue;
      }
      await stat(absOf(f));
      if ((await tools.chapterCount(absOf(f))) > 0 && f.introState !== 'marked') {
        if (own) set(f.id, { introState: 'skipped', introNote: 'свои главы' });
        continue;
      }
      usable.push(f);
    } catch (e) {
      if (own) set(f.id, { introState: 'error', introNote: e instanceof Error ? e.message : String(e) });
    }
  }

  const prints = new Map<number, Prints | null>();
  const printOf = async (f: EpisodeFile) => {
    if (!prints.has(f.id)) prints.set(f.id, await printsOf(f, absOf(f), tools, o.cacheDir).catch(() => null));
    return prints.get(f.id)!;
  };
  const settings = getIntroSettings(db);
  const warnPct = getRetention(db).overflow.warn;
  let marked = 0;
  for (const f of usable.filter((x) => todo.includes(x))) {
    try {
      const mine = await printOf(f);
      if (!mine) {
        set(f.id, { introState: 'error', introNote: 'нет длительности' });
        continue;
      }
      const heads: Seg[] = [];
      const tails: Seg[] = [];
      for (const n of nearest(usable, f)) {
        const other = await printOf(n);
        if (!other) continue;
        const h = commonSegment(mine.head, other.head);
        if (h) heads.push(h.a);
        const t = commonSegment(mine.tail, other.tail);
        if (t) tails.push([mine.tailStart + t.a[0], mine.tailStart + t.a[1]]);
      }
      const intro = agree(heads, usable.length);
      const credits = agree(tails, usable.length);
      if (!intro && !credits) {
        set(f.id, { introState: 'none', introNote: usable.length < 2 ? 'мало серий' : 'не нашлось' });
        continue;
      }
      // файл могли заменить, пока считали
      const now = db.select().from(episodeFiles).where(eq(episodeFiles.id, f.id)).get();
      if (!now || now.path !== f.path || now.size !== f.size || now.importedAt !== f.importedAt) continue;
      const abs = absOf(f);
      const mode = decideWrite({ processed: f.processed, nlink: (await stat(abs)).nlink, diskPct: storageState(db)?.pct ?? null, warnPct });
      if (mode === 'wait') {
        set(f.id, { introState: 'waiting', introNote: 'мало места на диске' });
        continue;
      }
      const tmpDir = path.join(o.media, TMP_DIR);
      await mkdir(tmpDir, { recursive: true });
      const chFile = path.join(tmpDir, `.dy-ch-${randomBytes(4).toString('hex')}.txt`);
      await writeFile(chFile, buildChapters({ intro, credits, duration: mine.duration, ...settings }));
      try {
        if (mode === 'inplace') await tools.setChapters(abs, chFile);
        else {
          const copy = path.join(tmpDir, `.dy-${randomBytes(4).toString('hex')}.tmp.mkv`);
          try {
            await copyFile(abs, copy);
            await tools.setChapters(copy, chFile);
            await rename(copy, abs); // в медиатеке — своя копия, раздача остаётся на исходнике
          } finally {
            await rm(copy, { force: true });
          }
        }
      } finally {
        await rm(chFile, { force: true });
      }
      const [introStart, introEnd] = ms(intro);
      const [creditsStart, creditsEnd] = ms(credits);
      set(f.id, { introState: 'marked', introNote: null, introStart, introEnd, creditsStart, creditsEnd, ...(mode === 'copy' ? { method: 'copy' as const } : {}) });
      marked++;
    } catch (e) {
      log.warn({ file: f.path, err: e instanceof Error ? e.message : String(e) }, 'intro mark failed');
      set(f.id, { introState: 'error', introNote: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ...next, marked };
}
