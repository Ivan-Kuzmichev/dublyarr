import { expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers';
import { episodeFiles, titles } from '@/lib/db/schema';

test('миграция 0027: ошибки mkvpropedit (обрезанный путь) снова в очереди, прочие ошибки и отметки не трогаются', () => {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 1, kind: 'anime', nameRu: 'X', nameOriginal: 'X', originalLanguage: 'ja', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const row = (number: number, introState: 'error' | 'marked', introNote: string | null) =>
    db.insert(episodeFiles).values({ titleId: t.id, season: 1, number, path: `p${number}.mkv`, size: 1, method: 'hardlink', importedAt: 1, introState, introNote }).run();
  row(1, 'error', "mkvpropedit: Error: The file '/downloads/media/' is not a Matroska file or it could not be found.");
  row(2, 'error', 'ffmpeg: не удалось снять отпечаток');
  row(3, 'marked', null);
  const sql = readFileSync(`drizzle/${readdirSync('drizzle').find((f) => f.startsWith('0027_'))}`, 'utf8');
  (db as unknown as { $client: { exec(s: string): void } }).$client.exec(sql);
  const st = (n: number) => db.select().from(episodeFiles).where(eq(episodeFiles.number, n)).get()!;
  expect([st(1).introState, st(2).introState, st(3).introState]).toEqual([null, 'error', 'marked']);
});
