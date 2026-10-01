import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { recordSightings, backfillSightings } from '@/lib/sightings';
import { episodes, releases, sources, studioSightings, studios, titles, type Release } from '@/lib/db/schema';
import type { ParsedRelease } from '@/lib/parse/types';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const DAY = 86_400_000;
const at = (d: string) => Date.parse(`${d}T12:00:00Z`);

function setup() {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 1, kind: 'series', nameRu: 'A', nameOriginal: 'A', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  for (let i = 1; i <= 3; i++) db.insert(episodes).values({ titleId: t.id, season: 1, number: i, name: `E${i}`, airDate: i < 3 ? `2026-09-0${i}` : null }).run();
  const st = db.insert(studios).values({ name: 'HDrezka', kind: 'both', source: 'manual', createdAt: 1 }).returning().get();
  const s = db.insert(sources).values({ name: 'J', url: 'http://j', createdAt: 1 }).returning().get();
  let n = 0;
  const rel = (p: Partial<ParsedRelease>, o: Partial<typeof releases.$inferInsert> = {}): Release =>
    db
      .insert(releases)
      .values({
        titleId: t.id, sourceId: s.id, trackerName: 'X', title: `r${n++}`, size: 1, firstSeenAt: at('2026-09-10'), lastSeenAt: 1,
        parsed: { base: 'x', names: [], year: null, seasons: [1], episodes: null, totalInSeason: null, absolute: false, pack: false, resolution: 1080, source: null, hdr: false, dv: false, screener: false, dubs: [{ kind: 'mvo', label: 'HDrezka', studioId: st.id, by: 'title' }], original: false, subs: false, ...p } as ParsedRelease,
        match: { score: 1, level: 'match', reasons: [] },
        ...o,
      })
      .returning()
      .get();
  const rows = () => db.select().from(studioSightings).all().map((r) => [r.number, r.seenAt, r.basis, r.fromPack]);
  return { db, t, st, rel, rows };
}

test('отдельная серия — «видели сами»; дата публикации раньше — по ней', () => {
  const { db, t, rel, rows } = setup();
  recordSightings(db, t.id, [rel({ episodes: { from: 1, to: 1 } }), rel({ episodes: { from: 2, to: 2 } }, { publishedAt: at('2026-09-03') })]);
  expect(rows()).toEqual([
    [1, at('2026-09-10'), 'seen', false],
    [2, at('2026-09-03'), 'published', false],
  ]);
});

test('пак с диапазоном и без; только серии с датой эфира', () => {
  const { db, t, rel, rows } = setup();
  recordSightings(db, t.id, [rel({ pack: true, episodes: { from: 1, to: 2 } })]);
  expect(rows()).toEqual([1, 2].map((n) => [n, at('2026-09-10'), 'seen', true]));
  const { db: db2, t: t2, rel: rel2, rows: rows2 } = setup();
  recordSightings(db2, t2.id, [rel2({ pack: true })]);
  expect(rows2().map((r) => r[0])).toEqual([1, 2]);
});

test('остаётся более ранняя дата; отдельная серия после пака снимает «пак»', () => {
  const { db, t, rel, rows } = setup();
  recordSightings(db, t.id, [rel({ pack: true, episodes: { from: 1, to: 1 } }, { firstSeenAt: at('2026-09-05') })]);
  recordSightings(db, t.id, [rel({ episodes: { from: 1, to: 1 } }, { firstSeenAt: at('2026-09-08') })]);
  expect(rows()).toEqual([[1, at('2026-09-05'), 'seen', false]]);
  recordSightings(db, t.id, [rel({ episodes: { from: 1, to: 1 } }, { firstSeenAt: at('2026-09-04') })]);
  expect(rows()).toEqual([[1, at('2026-09-04'), 'seen', false]]);
});

test('нераспознанная студия и «не тот сериал» — не учитываются', () => {
  const { db, t, rel, rows } = setup();
  recordSightings(db, t.id, [
    rel({ episodes: { from: 1, to: 1 }, dubs: [{ kind: 'mvo', label: 'Кто-то', studioId: null, by: 'title' }] }),
    rel({ episodes: { from: 2, to: 2 } }, { match: { score: 0.6, level: 'doubt', reasons: [] } }),
  ]);
  expect(rows()).toEqual([]);
});

test('прошлые раздачи — один раз', () => {
  const { db, rel, rows } = setup();
  rel({ episodes: { from: 1, to: 1 } });
  backfillSightings(db);
  expect(rows()).toHaveLength(1);
  db.delete(studioSightings).run();
  backfillSightings(db);
  expect(rows()).toEqual([]);
  void DAY;
});
