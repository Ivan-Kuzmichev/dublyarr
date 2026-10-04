import { expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers';
import { episodeFiles, titles } from '@/lib/db/schema';
import { resetIntroMarks } from '@/lib/intros/run';

type Db = ReturnType<typeof testDb>;
export function seriesWithFiles(db: Db, n: number, o: { kind?: 'anime' | 'series' | 'movie'; season?: number } = {}) {
  const t = db.insert(titles).values({ tmdbId: 73223 + n, kind: o.kind ?? 'anime', nameRu: 'Чёрный клевер', nameOriginal: 'Black Clover', originalLanguage: 'ja', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const files = Array.from({ length: n }, (_, i) =>
    db.insert(episodeFiles).values({ titleId: t.id, season: o.season ?? 1, number: i + 1, path: `Клевер/Season 01/E${i + 1}.mkv`, size: 100 + i, method: 'hardlink', importedAt: 10 + i, processed: true, duration: 1450 }).returning().get(),
  );
  return { t, files };
}

test('сброс: «не нашлось» в сезоне снова в очереди, остальное не трогается', () => {
  const db = testDb();
  const { t, files } = seriesWithFiles(db, 3);
  db.update(episodeFiles).set({ introState: 'none' }).where(eq(episodeFiles.id, files[0].id)).run();
  db.update(episodeFiles).set({ introState: 'marked' }).where(eq(episodeFiles.id, files[1].id)).run();
  resetIntroMarks(db, t.id, 1);
  expect(db.select().from(episodeFiles).all().map((f) => f.introState)).toEqual([null, 'marked', null]);
});
