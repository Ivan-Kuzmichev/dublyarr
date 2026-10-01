import { and, eq, notInArray } from 'drizzle-orm';
import type { Db } from './db/client';
import { deletions, downloads, episodeFiles, oldCopies, titles, wantedState } from './db/schema';
import type { Qbit } from './qbit';
import type { Paths } from './downloads';
import { deleteMediaFile } from './retention';
import { OLD_DIR } from './old-copies';
import { dropTorrents } from './cleanup';
import { unsubscribe } from './subscriptions';
import { log } from './log';

// Удаление сериала (spec §8): «файлы и подписка» / «только файлы» / «только подписка». Подтверждение — диалог на экране.

export async function deleteSeries(db: Db, deps: { qbit: Qbit | null; paths: Paths }, titleId: number, mode: 'all' | 'files' | 'sub', now = Date.now()) {
  const res = { files: 0, freed: 0, torrents: 0 };
  const t = db.select().from(titles).where(eq(titles.id, titleId)).get();
  if (!t) throw new Error('Сериал не найден');
  if (mode !== 'sub') {
    const media = deps.paths.media;
    for (const f of db.select().from(episodeFiles).where(eq(episodeFiles.titleId, titleId)).all()) {
      if (!(await deleteMediaFile(media, f.path))) {
        log.warn({ file: f.id }, 'delete series: path outside media library');
        continue;
      }
      db.delete(episodeFiles).where(eq(episodeFiles.id, f.id)).run();
      res.files++;
      res.freed += f.size;
    }
    for (const c of db.select().from(oldCopies).where(eq(oldCopies.titleId, titleId)).all()) {
      if (!(await deleteMediaFile(media, c.path, OLD_DIR))) continue;
      db.delete(oldCopies).where(eq(oldCopies.id, c.id)).run();
      res.files++;
      res.freed += c.size;
    }
    if (deps.qbit) {
      const rows = db
        .select()
        .from(downloads)
        .where(and(eq(downloads.titleId, titleId), notInArray(downloads.state, ['removed', 'replaced'])))
        .all();
      if (rows.length) res.torrents = (await dropTorrents(db, deps.qbit, deps.paths, rows, 'Удалён вместе с сериалом')).torrents;
    }
    db.delete(wantedState).where(eq(wantedState.titleId, titleId)).run();
    if (res.freed) db.insert(deletions).values({ titleId, label: `${t.nameRu} · все файлы`, why: 'удалено вручную', size: res.freed, at: now }).run();
  }
  if (mode !== 'files') unsubscribe(db, titleId);
  return res;
}
