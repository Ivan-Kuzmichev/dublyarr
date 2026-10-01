import { and, eq, notInArray } from 'drizzle-orm';
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
