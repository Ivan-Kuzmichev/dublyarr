import { describe, expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { absoluteCandidates, resolveAbsolute } from '@/lib/match';
import { reviewAnime } from '@/lib/laya/review';
import { reparseReleases } from '@/lib/search';
import { parseRelease } from '@/lib/parse/dubs';
import { releases, seasons, sources, titles, type Release } from '@/lib/db/schema';
import type { LayaClient } from '@/lib/laya/client';
import type { ParsedRelease } from '@/lib/parse/types';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const abs = (from: number, to = from): ParsedRelease => ({ base: 'x', names: ['Devil May Cry'], year: null, seasons: [], episodes: { from, to }, totalInSeason: null, absolute: true, pack: from !== to, resolution: 1080, source: 'webdl', hdr: false, dv: false, screener: false, dubs: [], original: false, subs: false });
const info = (counts: number[]) => ({ names: ['Devil May Cry'], year: 2025, kind: 'anime' as const, seasons: counts.map((c, i) => ({ number: i + 1, episodeCount: c, year: 2025 })) });
const labels = (p: ParsedRelease, counts: number[]) => absoluteCandidates(p, info(counts)).map((c) => c.label);

describe('варианты сквозной нумерации', () => {
  test('однозначно — один вариант (без вопроса)', () => {
    expect(labels(abs(5), [12])).toEqual(['S01E05']);
  });
  test('номер в пределах последнего сезона — по накопленному счёту или нумерация сезона', () => {
    expect(labels(abs(3), [12, 12])).toEqual(['S01E03', 'S02E03']);
  });
  test('номер больше известных серий — онгоинг: в последний сезон или «сезон + остаток»', () => {
    expect(labels(abs(27), [12, 12])).toEqual(['S01E27', 'S02E15', 'S03E03']);
  });
  test('не больше 4 вариантов; эвристика (как раньше) — первым', () => {
    expect(labels(abs(3), [12, 12, 12, 12, 12]).length).toBeLessThanOrEqual(4);
    const p = abs(3);
    expect(absoluteCandidates(p, info([12, 12]))[0].parsed).toEqual(resolveAbsolute(p, info([12, 12])));
  });
});

const client = (choice: string | null, p = 0.9) => {
  const asked: string[][] = [];
  return { asked, client: { ask: async (_s: unknown, qs: Record<string, { criteria?: Record<string, string> }>) => (asked.push(Object.keys(qs.q.criteria ?? {})), choice === null ? null : { answers: { q: { choice, probabilities: { [choice]: p } } }, ms: 1 }), health: async () => null, last: () => 1 } as unknown as LayaClient };
};

function setup(title = 'Devil May Cry / E01-E03 Devil May Cry - AniLiberty.TOP [WEBRip 1080p]') {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 9, kind: 'anime', nameRu: 'Devil May Cry', nameOriginal: 'Devil May Cry', originalLanguage: 'ja', year: 2025, status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  for (const n of [1, 2]) db.insert(seasons).values({ titleId: t.id, number: n, name: `Сезон ${n}`, episodeCount: 12, airDate: '2025-01-01' }).run();
  const s = db.insert(sources).values({ name: 'J', url: 'http://j', createdAt: 1 }).returning().get();
  const r = db.insert(releases).values({ titleId: t.id, sourceId: s.id, trackerName: 'AniLibria', title, size: 1, firstSeenAt: 1, lastSeenAt: 1, parsed: parseRelease(title, {}, { id: 'anilibria', name: 'AniLibria' }, []), match: { score: 1, level: 'match', reasons: [] } }).returning().get();
  reparseReleases(db, t.id);
  return { db, t, rows: db.select().from(releases).all() as Release[], raw: r };
}

describe('«Нумерация аниме»', () => {
  test('уверенный выбор Laya — сезон и серия раздачи; переразбор помнит выбор', async () => {
    const s = setup();
    expect(s.rows[0].parsed).toMatchObject({ seasons: [1], episodes: { from: 1, to: 3 } }); // эвристика: по накопленному счёту
    const c = client('S02E01–E03');
    const out = await reviewAnime(s.db, s.t, s.rows, { client: c.client, budget: { left: 20 } });
    expect(c.asked[0]).toEqual(['S01E01–E03', 'S02E01–E03']);
    expect(out[0].parsed).toMatchObject({ seasons: [2], episodes: { from: 1, to: 3 }, absolute: false });
    reparseReleases(s.db, s.t.id);
    expect(s.db.select().from(releases).get()!.parsed).toMatchObject({ seasons: [2], episodes: { from: 1, to: 3 } });
  });
  test('не уверена / недоступна — эвристика как раньше', async () => {
    const s = setup();
    const before = s.rows[0].parsed;
    expect((await reviewAnime(s.db, s.t, s.rows, { client: client('S02E01–E03', 0.6).client, budget: { left: 20 } }))[0].parsed).toEqual(before);
    expect((await reviewAnime(s.db, s.t, s.rows, { client: client(null).client, budget: { left: 20 } }))[0].parsed).toEqual(before);
  });
});
