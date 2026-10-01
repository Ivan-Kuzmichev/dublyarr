import { describe, expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { reviewMatches } from '@/lib/laya/review';
import { reparseReleases } from '@/lib/search';
import { setSetting } from '@/lib/settings';
import { addRule } from '@/lib/release-rules';
import { releases, sources, titles, type Release } from '@/lib/db/schema';
import type { LayaClient } from '@/lib/laya/client';
import type { ParsedRelease } from '@/lib/parse/types';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const GB = 1024 ** 3;
const client = (noul: number | null) => {
  const states: unknown[] = [];
  return { states, client: { ask: async (s: unknown) => (states.push(s), noul === null ? null : { answers: { q: { noul } }, ms: 1 }), health: async () => null, last: () => 1 } as unknown as LayaClient };
};
const parsed = (o: Partial<ParsedRelease> = {}): ParsedRelease => ({ base: 'x', names: ['Game of Thrones'], year: 2011, seasons: [1], episodes: null, totalInSeason: null, absolute: false, pack: true, resolution: 1080, source: 'webdl', hdr: false, dv: false, screener: false, dubs: [], original: false, subs: false, ...o });

function setup(n = 1) {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 1399, kind: 'series', nameRu: 'Игра престолов', nameOriginal: 'Game of Thrones', originalLanguage: 'en', year: 2011, status: 'ended', createdAt: 1, refreshedAt: 1 }).returning().get();
  const s = db.insert(sources).values({ name: 'J', url: 'http://j', createdAt: 1 }).returning().get();
  const rows = Array.from({ length: n }, (_, i) =>
    db.insert(releases).values({ titleId: t.id, sourceId: s.id, trackerName: 'RuTracker', title: `Game of Thrones S01 ${i} [2011, WEB-DL]`, size: 20 * GB, firstSeenAt: 1, lastSeenAt: 1, parsed: parsed(), match: { score: 0.65, level: 'doubt', reasons: ['Название не похоже'] } }).returning().get(),
  );
  return { db, t, rows };
}

describe('«Тот ли сериал»', () => {
  test('уверенное «да» — подходит, уверенное «нет» — отказ, неуверенная — сомнительно', async () => {
    const yes = setup();
    const [r1] = await reviewMatches(yes.db, yes.t, yes.rows, { client: client(0.92).client, budget: { left: 20 } });
    expect(r1.match).toMatchObject({ level: 'match', reasons: ['Laya: тот же · 92 %'], laya: { p: 0.92 } });
    expect(yes.db.select().from(releases).get()!.match.level).toBe('match');
    const no = setup();
    expect((await reviewMatches(no.db, no.t, no.rows, { client: client(0.05).client, budget: { left: 20 } }))[0].match).toMatchObject({ level: 'reject', reasons: ['Laya: не тот · 95 %'] });
    const unsure = setup();
    expect((await reviewMatches(unsure.db, unsure.t, unsure.rows, { client: client(0.7).client, budget: { left: 20 } }))[0].match).toMatchObject({ level: 'doubt', reasons: ['Название не похоже', 'Laya не уверена · 70 %'] });
  });
  test('вопрос — по-русски, с сериалом, раздачей и размером', async () => {
    const s = setup();
    const c = client(0.9);
    await reviewMatches(s.db, s.t, s.rows, { client: c.client, budget: { left: 20 } });
    expect(c.states[0]).toEqual({ сериал: 'Игра престолов (Game of Thrones), 2011', раздача: 'Game of Thrones S01 0 [2011, WEB-DL]', размер: '20 ГБ' });
  });
  test('правило пользователя важнее Laya; уверенные и отвергнутые — не спрашиваем', async () => {
    const s = setup();
    addRule(s.db, s.t.id, 'RuTracker', s.rows[0].title, 'reject');
    reparseReleases(s.db, s.t.id);
    const c = client(0.99);
    const fresh = s.db.select().from(releases).all() as Release[];
    expect((await reviewMatches(s.db, s.t, fresh, { client: c.client, budget: { left: 20 } }))[0].match.level).toBe('reject');
    expect(c.states).toEqual([]);
  });
  test('Laya выключена или недоступна — как раньше; бюджет — не больше N вопросов', async () => {
    const off = setup();
    setSetting(off.db, 'laya', { tasks: { match: false } });
    expect((await reviewMatches(off.db, off.t, off.rows, { client: client(0.99).client, budget: { left: 20 } }))[0].match.level).toBe('doubt');
    const down = setup();
    expect((await reviewMatches(down.db, down.t, down.rows, { client: client(null).client, budget: { left: 20 } }))[0].match.level).toBe('doubt');
    const many = setup(5);
    const c = client(0.95);
    await reviewMatches(many.db, many.t, many.rows, { client: c.client, budget: { left: 3 } });
    expect(c.states).toHaveLength(3);
  });
  test('переразбор раздач сохраняет решение Laya (из кэша)', async () => {
    const s = setup();
    await reviewMatches(s.db, s.t, s.rows, { client: client(0.92).client, budget: { left: 20 } });
    // переразбор считает совпадение заново по правилам — «сомнительно» не должно вернуться
    reparseReleases(s.db, s.t.id);
    expect(s.db.select().from(releases).get()!.match.level).not.toBe('doubt');
  });
});
