import { describe, expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { answerMatch, assignStudio } from '@/lib/manual-search';
import { exampleStats, markFinalAnswer } from '@/lib/laya/examples';
import { matchInput } from '@/lib/laya/review';
import { seedStudios, findStudioByAlias } from '@/lib/studios';
import { parseRelease } from '@/lib/parse/dubs';
import { layaAnswers, layaExamples, layaVersions, releases, sources, titles } from '@/lib/db/schema';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');

function setup(title = 'Game of Thrones S01E03 [WEB-DL 1080p] MVO Paravozik') {
  const db = testDb();
  seedStudios(db);
  const t = db.insert(titles).values({ tmdbId: 1399, kind: 'series', nameRu: 'Игра престолов', nameOriginal: 'Game of Thrones', originalLanguage: 'en', year: 2011, status: 'ended', createdAt: 1, refreshedAt: 1 }).returning().get();
  const s = db.insert(sources).values({ name: 'J', url: 'http://j', createdAt: 1 }).returning().get();
  const r = db.insert(releases).values({ titleId: t.id, sourceId: s.id, trackerName: 'RuTracker', title, size: 2 * 1024 ** 3, firstSeenAt: 1, lastSeenAt: 1, parsed: parseRelease(title, {}, { id: 'rutracker', name: 'RuTracker' }, []), match: { score: 0.65, level: 'doubt', reasons: [] } }).returning().get();
  return { db, t, r };
}

describe('примеры из ответов пользователя', () => {
  test('«Это он» / «Не тот сериал»: тот же вопрос, что у Laya; ответ Laya рядом; повтор — один пример', () => {
    const s = setup();
    const input = matchInput(s.t, s.r);
    s.db.insert(layaAnswers).values({ task: 'match', key: input.key, version: 0, answer: false, p: 0.3, raw: 0.3, at: 1 }).run();
    answerMatch(s.db, s.t.id, s.r.id, 'match');
    answerMatch(s.db, s.t.id, s.r.id, 'match', 'telegram');
    const ex = s.db.select().from(layaExamples).all();
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ task: 'match', key: input.key, label: true, source: 'telegram', laya: { answer: false, p: 0.3 }, title: s.r.title });
    expect(ex[0].input).toEqual({ state: input.state, question: input.question, features: input.features });
    answerMatch(s.db, s.t.id, s.r.id, 'reject');
    expect(s.db.select().from(layaExamples).get()!.label).toBe(false);
  });
  test('«Назначить студию»: пример «какая студия» с ответом пользователя', () => {
    const s = setup();
    assignStudio(s.db, s.t.id, { label: 'Paravozik', newName: 'Paravozik Studio' });
    expect(findStudioByAlias(s.db, 'Paravozik')?.name).toBe('Paravozik Studio');
    const ex = s.db.select().from(layaExamples).get()!;
    expect(ex).toMatchObject({ task: 'studio', label: 'Paravozik Studio', source: 'studio-assign', title: 'Paravozik' });
    expect((ex.input.question as { criteria: Record<string, string> }).criteria).toHaveProperty('новая');
  });
  test('финальная проверка: ручная загрузка после отказа Laya — пример «да», «Не тот сериал» — «нет»', () => {
    const s = setup();
    s.db.insert(layaAnswers).values({ task: 'final', key: `final|tv:1399|1:3|LostFilm|RuTracker|${s.r.title}|${s.r.size}`, version: 0, answer: false, p: 0.2, raw: 0.2, input: { state: { a: 1 }, question: { type: 'noul' }, features: [0.9] }, at: 1 }).run();
    markFinalAnswer(s.db, s.t, s.r, true);
    expect(s.db.select().from(layaExamples).get()).toMatchObject({ task: 'final', label: true, source: 'correction', laya: { answer: false, p: 0.2 } });
  });
  test('статистика: всего, новых с последней версии, по задачам', () => {
    const s = setup();
    answerMatch(s.db, s.t.id, s.r.id, 'match');
    s.db.insert(layaVersions).values({ number: 1, createdAt: Date.now() + 1000, examples: 1, laya: 'x', model: 'y', current: true, adapters: {}, metrics: {} }).run();
    assignStudio(s.db, s.t.id, { label: 'Paravozik', newName: 'Paravozik Studio' });
    const st = exampleStats(s.db);
    expect(st.total).toBe(2);
    expect(st.byTask).toEqual({ studio: 1, match: 1, anime: 0, final: 0 });
    expect(st.sinceVersion).toBe(0); // оба раньше «версии из будущего»
  });
});
