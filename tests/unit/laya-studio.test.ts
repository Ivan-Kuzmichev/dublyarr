import { describe, expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { reviewStudios, studioInput } from '@/lib/laya/review';
import { confirmLayaAlias } from '@/lib/laya/review';
import { reparseReleases } from '@/lib/search';
import { seedStudios, findStudioByAlias, createStudio } from '@/lib/studios';
import { parseRelease } from '@/lib/parse/dubs';
import { layaExamples, releases, sources, titles, type Release } from '@/lib/db/schema';
import type { LayaClient } from '@/lib/laya/client';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const client = (choice: string | null, p = 0.9) => {
  const asked: { state: unknown; criteria: string[] }[] = [];
  return {
    asked,
    client: {
      ask: async (state: unknown, qs: Record<string, { criteria?: Record<string, string> }>) => (asked.push({ state, criteria: Object.keys(qs.q.criteria ?? {}) }), choice === null ? null : { answers: { q: { choice, probabilities: { [choice]: p } } }, ms: 1 }),
      health: async () => null,
      last: () => 1,
    } as unknown as LayaClient,
  };
};

function setup(title = 'Криминальное прошлое S02E03 [WEB-DL 1080p] MVO Paravozik') {
  const db = testDb();
  seedStudios(db);
  createStudio(db, { name: 'Paravozik Studio', aliases: [], kind: 'series', trackers: [] });
  const t = db.insert(titles).values({ tmdbId: 5, kind: 'series', nameRu: 'Криминальное прошлое', nameOriginal: 'Criminal Record', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const s = db.insert(sources).values({ name: 'J', url: 'http://j', createdAt: 1 }).returning().get();
  const r = db.insert(releases).values({ titleId: t.id, sourceId: s.id, trackerName: 'RuTracker', title, size: 1, firstSeenAt: 1, lastSeenAt: 1, parsed: parseRelease(title, {}, { id: 'rutracker', name: 'RuTracker' }, []), match: { score: 1, level: 'match', reasons: [] } }).returning().get();
  return { db, t, rows: [r] as Release[] };
}

describe('«Какая студия»', () => {
  test('уверенно — подпись становится вариантом написания студии, раздача распознана', async () => {
    const s = setup();
    const c = client('Paravozik Studio');
    const out = await reviewStudios(s.db, s.t, s.rows, { client: c.client, budget: { left: 20 } });
    expect(findStudioByAlias(s.db, 'Paravozik')?.name).toBe('Paravozik Studio');
    expect(findStudioByAlias(s.db, 'Paravozik')?.layaAliases).toEqual(['Paravozik']);
    expect(out[0].parsed.dubs[0]).toMatchObject({ studioId: findStudioByAlias(s.db, 'Paravozik')!.id, label: 'Paravozik Studio' });
  });
  test('варианты: до 19 студий подходящего вида, самые похожие — первыми, плюс «новая»', async () => {
    const s = setup();
    const c = client('новая');
    await reviewStudios(s.db, s.t, s.rows, { client: c.client, budget: { left: 20 } });
    expect(c.asked[0].criteria.length).toBeLessThanOrEqual(20);
    expect(c.asked[0].criteria[0]).toBe('Paravozik Studio');
    expect(c.asked[0].criteria.at(-1)).toBe('новая');
    expect(findStudioByAlias(s.db, 'Paravozik')).toBeUndefined(); // «новая» — как раньше, «Неизвестная студия»
  });
  test('не уверена или недоступна — словарь не меняется', async () => {
    const s = setup();
    await reviewStudios(s.db, s.t, s.rows, { client: client('Paravozik Studio', 0.6).client, budget: { left: 20 } });
    expect(findStudioByAlias(s.db, 'Paravozik')).toBeUndefined();
    await reviewStudios(s.db, s.t, s.rows, { client: client(null).client, budget: { left: 20 } });
    expect(findStudioByAlias(s.db, 'Paravozik')).toBeUndefined();
  });
  test('«Нет» в словаре: вариант убран, раздачи переразобраны, пример сохранён; «Верно» — подтверждено, пример', async () => {
    const s = setup();
    await reviewStudios(s.db, s.t, s.rows, { client: client('Paravozik Studio').client, budget: { left: 20 } });
    const st = findStudioByAlias(s.db, 'Paravozik')!;
    confirmLayaAlias(s.db, st.id, 'Paravozik', false);
    expect(findStudioByAlias(s.db, 'Paravozik')).toBeUndefined();
    expect(s.db.select().from(releases).get()!.parsed.dubs[0].studioId).toBeNull();
    expect(s.db.select().from(layaExamples).all()).toEqual([expect.objectContaining({ task: 'studio', label: 'новая', source: 'studio-confirm', laya: expect.objectContaining({ answer: 'Paravozik Studio' }) })]);
    const s2 = setup();
    await reviewStudios(s2.db, s2.t, s2.rows, { client: client('Paravozik Studio').client, budget: { left: 20 } });
    const st2 = findStudioByAlias(s2.db, 'Paravozik')!;
    confirmLayaAlias(s2.db, st2.id, 'Paravozik', true);
    expect(findStudioByAlias(s2.db, 'Paravozik')).toMatchObject({ id: st2.id, layaAliases: [] });
    expect(s2.db.select().from(layaExamples).get()).toMatchObject({ label: 'Paravozik Studio', source: 'studio-confirm' });
    reparseReleases(s2.db, s2.t.id);
  });
  test('вопрос — о подписи в заголовке', () => {
    const s = setup();
    const i = studioInput(s.db, s.t, s.rows[0], 'Paravozik');
    expect(i.state).toEqual({ раздача: 'Криминальное прошлое S02E03 [WEB-DL 1080p] MVO Paravozik', трекер: 'RuTracker', подпись: 'Paravozik' });
    expect(i.question).toMatchObject({ type: 'choice', instructions: 'Какая студия озвучки скрывается за подписью «Paravozik»?' });
  });
});
