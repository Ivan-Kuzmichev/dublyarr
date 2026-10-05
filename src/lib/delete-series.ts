import { and, eq, notInArray } from 'drizzle-orm';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { Db } from './db/client';
import { deletions, downloads, episodeFiles, oldCopies, titles, wantedState } from './db/schema';
import type { Qbit } from './qbit';
import type { Paths } from './downloads';
import { deleteMediaFile, retireEpisode } from './retention';
import { OLD_DIR } from './old-copies';
import { dropTorrents } from './cleanup';
import { unsubscribe } from './subscriptions';
import { logger } from './log';
import { mediaRoot } from './movie-files';

const log = logger('storage');

// Удаление сериала (spec §8): «файлы и подписка» / «только файлы» / «только подписка». Подтверждение — диалог на экране.

export async function deleteSeries(db: Db, deps: { qbit: Qbit | null; paths: Paths }, titleId: number, mode: 'all' | 'files' | 'sub', now = Date.now()) {
  const res = { files: 0, freed: 0, torrents: 0 };
  const t = db.select().from(titles).where(eq(titles.id, titleId)).get();
  if (!t) throw new Error('Сериал не найден');
  if (mode !== 'sub') {
    // фильм — в своей папке; не задана — файлы фильма не трогаем
    const media = mediaRoot(deps.paths, t.kind);
    for (const f of media ? db.select().from(episodeFiles).where(eq(episodeFiles.titleId, titleId)).all() : []) {
      if (!(await deleteMediaFile(media!, f.path))) {
        log.warn({ file: f.id }, 'delete series: path outside media library');
        continue;
      }
      db.delete(episodeFiles).where(eq(episodeFiles.id, f.id)).run();
      retireEpisode(db, titleId, f.season, f.number, now);
      res.files++;
      res.freed += f.size;
    }
    for (const c of media ? db.select().from(oldCopies).where(eq(oldCopies.titleId, titleId)).all() : []) {
      if (!(await deleteMediaFile(media!, c.path, OLD_DIR))) continue;
      db.delete(oldCopies).where(eq(oldCopies.id, c.id)).run();
      res.files++;
      res.freed += c.size;
    }
    const rows = db
      .select()
      .from(downloads)
      .where(and(eq(downloads.titleId, titleId), notInArray(downloads.state, ['removed', 'replaced'])))
      .all();
    if (rows.length && deps.qbit) {
      try {
        res.torrents = (await dropTorrents(db, deps.qbit, deps.paths, rows, 'Удалён вместе с сериалом')).torrents;
      } catch (e) {
        log.warn({ err: e instanceof Error ? e.message : String(e) }, 'delete series: qBittorrent failed, torrents left in client');
      }
    }
    // что не убрали из клиента — всё равно не импортировать обратно в медиатеку
    for (const d of rows)
      db.update(downloads)
        .set({ state: 'removed', note: 'Удалён вместе с сериалом' })
        .where(and(eq(downloads.id, d.id), notInArray(downloads.state, ['removed'])))
        .run();
    db.delete(wantedState).where(eq(wantedState.titleId, titleId)).run();
    if (res.freed) db.insert(deletions).values({ titleId, label: `${t.nameRu} · все файлы`, why: 'удалено вручную', size: res.freed, at: now }).run();
  }
  if (mode !== 'files') unsubscribe(db, titleId);
  return res;
}

const code = (season: number, number: number) => `S${String(season).padStart(2, '0')}E${String(number).padStart(2, '0')}`;

/** Удаление выбранных серий (сезона) вручную: файлы и старые копии из медиатеки, серии больше не качаются, подписка и торренты остаются.
 *  freed — место освободится сразу; later — файл ещё раздаётся (жёсткая ссылка), место — после уборки торрента. */
export async function deleteEpisodes(db: Db, deps: { paths: Paths }, titleId: number, eps: { season: number; number: number }[], now = Date.now()) {
  const res = { files: 0, freed: 0, later: 0 };
  const t = db.select().from(titles).where(eq(titles.id, titleId)).get();
  if (!t) throw new Error('Сериал не найден');
  const media = mediaRoot(deps.paths, t.kind);
  if (!media) return res;
  const want = new Set(eps.map((e) => `${e.season}:${e.number}`));
  const all = db.select().from(episodeFiles).where(eq(episodeFiles.titleId, titleId)).all();
  const picked = all.filter((f) => want.has(`${f.season}:${f.number}`));
  const done: typeof picked = [];
  const free = async (rel: string, size: number, under = '') => {
    const links = await stat(path.join(media, rel)).then((s) => s.nlink, () => 1);
    if (!(await deleteMediaFile(media, rel, under))) return false;
    if (links > 1) res.later += size;
    else res.freed += size;
    res.files++;
    return true;
  };
  for (const f of picked) {
    if (!(await free(f.path, f.size))) {
      log.warn({ file: f.id }, 'delete episodes: path outside media library');
      continue;
    }
    db.delete(episodeFiles).where(eq(episodeFiles.id, f.id)).run();
    retireEpisode(db, titleId, f.season, f.number, now);
    db.delete(wantedState).where(and(eq(wantedState.titleId, titleId), eq(wantedState.season, f.season), eq(wantedState.number, f.number))).run();
    done.push(f);
  }
  for (const c of db.select().from(oldCopies).where(eq(oldCopies.titleId, titleId)).all().filter((c) => want.has(`${c.season}:${c.number}`))) {
    if (!(await free(c.path, c.size, OLD_DIR))) continue;
    db.delete(oldCopies).where(eq(oldCopies.id, c.id)).run();
  }
  if (res.files) {
    // подпись истории: сезон целиком — «сезон N», иначе коды серий
    const parts = [...new Set(done.map((f) => f.season))].sort((a, b) => a - b).map((season) => {
      const mine = done.filter((f) => f.season === season);
      return mine.length === all.filter((f) => f.season === season).length ? `сезон ${season}` : mine.map((f) => code(f.season, f.number)).join(', ');
    });
    db.insert(deletions).values({ titleId, label: `${t.nameRu} · ${parts.join(', ') || 'старые копии'}`, why: 'удалено вручную', size: res.freed + res.later, at: now }).run();
  }
  return res;
}

/** Выбор из формы диалога: значения «сезон:серия»; неверные и повторы отбрасываются. */
export function parsePicks(values: string[]): { season: number; number: number }[] {
  const seen = new Set<string>();
  const out: { season: number; number: number }[] = [];
  for (const v of values) {
    const m = /^(\d{1,3}):(\d{1,4})$/.exec(v);
    if (!m || seen.has(v)) continue;
    seen.add(v);
    out.push({ season: Number(m[1]), number: Number(m[2]) });
  }
  return out;
}
