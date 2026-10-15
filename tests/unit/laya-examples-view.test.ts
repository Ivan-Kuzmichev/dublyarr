import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { examplesData } from '@/lib/laya/examples-view';
import { layaExamples } from '@/lib/db/schema';

test('экран «Примеры»: сколько по задачам, где Laya ошиблась, последние ответы', () => {
  const db = testDb();
  const ex = (task: string, key: string, label: string | boolean, laya: { answer: string | boolean; p: number } | null, title: string, at: number) =>
    db.insert(layaExamples).values({ task, key, input: { state: {}, question: {}, features: [] }, label, laya: laya && { ...laya, raw: laya.p }, source: 'match-answer', title, createdAt: at }).run();
  ex('studio', 's1', 'Paravozik Studio', { answer: 'LostFilm', p: 0.64 }, 'Криминальное прошлое S02E03 MVO Paravozik', 3000);
  ex('match', 'm1', false, { answer: true, p: 0.71 }, 'Медведь / Bear (2025)', 2000);
  ex('match', 'm2', true, null, 'Rivals.S02E03', 1000);
  ex('match', 'm3', true, { answer: true, p: 0.9 }, 'Rivals.S02E04', 500);
  const d = examplesData(db);
  expect(d.total).toBe(4);
  expect(d.tasks.map((t) => [t.name, t.n, t.wrong])).toEqual([
    ['Какая студия', 1, 1],
    ['Тот ли это сериал', 3, 1],
    ['Нумерация аниме', 0, 0],
    ['Финальная проверка', 0, 0],
  ]);
  expect(d.examples.map((e) => [e.title, e.question, e.model, e.you, e.wrong])).toEqual([
    ['Криминальное прошлое S02E03 MVO Paravozik', 'Какая студия?', 'LostFilm · 64 %', 'Paravozik Studio', true],
    ['Медведь / Bear (2025)', 'Тот ли это сериал?', 'да · 71 %', 'нет', true],
    ['Rivals.S02E03', 'Тот ли это сериал?', '—', 'да', false],
    ['Rivals.S02E04', 'Тот ли это сериал?', 'да · 90 %', 'да', false],
  ]);
  expect(examplesData(db, { wrong: true }).examples.map((e) => e.title)).toEqual(['Криминальное прошлое S02E03 MVO Paravozik', 'Медведь / Bear (2025)']);
});
