import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { foundMovieKinds, foundStudios } from '@/lib/found-studios';
import { releases, sources, titles } from '@/lib/db/schema';
import type { ParsedRelease } from '@/lib/parse/types';

const parsed = (dubs: ParsedRelease['dubs']): ParsedRelease => ({
  base: 'x', names: [], year: null, seasons: [1], episodes: null, totalInSeason: null, absolute: false, pack: true,
  resolution: 1080, source: 'webdl', hdr: false, dv: false, screener: false, dubs, original: false, subs: false,
});

test('студии из раздач сериала: сколько раздач; отклонённые и чужие сериалы не считаются', () => {
  const db = testDb();
  const [a, b] = [1, 2].map((n) => db.insert(titles).values({ tmdbId: n, kind: 'series', nameRu: 'A', nameOriginal: 'A', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get());
  const s = db.insert(sources).values({ name: 'J', url: 'http://j', createdAt: 1 }).returning().get();
  const rel = (titleId: number, title: string, dubs: ParsedRelease['dubs'], level: 'match' | 'doubt' | 'reject' = 'match') =>
    db.insert(releases).values({ titleId, sourceId: s.id, trackerName: 'X', title, size: 1, firstSeenAt: 1, lastSeenAt: 1, parsed: parsed(dubs), match: { score: 1, level, reasons: [] } }).run();
  rel(a.id, 'r1', [{ kind: 'mvo', studioId: 5, label: 'LostFilm', by: 'tracker' }, { kind: 'dub', studioId: 7, label: 'X', by: 'title' }]);
  rel(a.id, 'r2', [{ kind: 'mvo', studioId: 5, label: 'LostFilm', by: 'title' }, { kind: 'mvo', studioId: null, label: 'Неизвестная', by: 'none' }]);
  rel(a.id, 'r3', [{ kind: 'mvo', studioId: 9, label: 'Y', by: 'title' }], 'doubt');
  rel(a.id, 'r4', [{ kind: 'mvo', studioId: 11, label: 'Z', by: 'title' }], 'reject');
  rel(b.id, 'r5', [{ kind: 'mvo', studioId: 13, label: 'W', by: 'title' }]);
  expect(foundStudios(db, a.id)).toEqual({ 5: 2, 7: 1, 9: 1 });
});

test('фильм: найденные типы перевода (дубляж, многоголосый, оригинал)', () => {
  const db = testDb();
  const m = db.insert(titles).values({ tmdbId: 603, kind: 'movie', tmdbType: 'movie', nameRu: 'М', nameOriginal: 'M', originalLanguage: 'en', status: 'released', createdAt: 1, refreshedAt: 1 }).returning().get();
  const s = db.insert(sources).values({ name: 'J', url: 'http://j', createdAt: 1 }).returning().get();
  const rel = (title: string, p: Partial<ParsedRelease>, level: 'match' | 'reject' = 'match') =>
    db.insert(releases).values({ titleId: m.id, sourceId: s.id, trackerName: 'X', title, size: 1, firstSeenAt: 1, lastSeenAt: 1, parsed: { ...parsed([]), ...p }, match: { score: 1, level, reasons: [] } }).run();
  rel('a', { dubs: [{ kind: 'dub', studioId: null, label: 'DUB', by: 'none' }] });
  rel('b', { dubs: [{ kind: 'mvo', studioId: null, label: 'MVO', by: 'none' }], original: true });
  rel('c', { dubs: [{ kind: 'dub', studioId: null, label: 'DUB', by: 'none' }] }, 'reject');
  expect(foundMovieKinds(db, m.id)).toEqual({ dub: 1, mvo: 1, original: 1 });
});
