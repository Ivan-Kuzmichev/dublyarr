import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { trainingData } from '@/lib/laya/training-data';
import { setSetting } from '@/lib/settings';
import { layaExamples, layaVersions } from '@/lib/db/schema';

test('задачи, примеры, версии для экрана «Дообучение»', () => {
  const db = testDb();
  const ex = (task: string, key: string, label: string | boolean, laya: { answer: string | boolean; p: number } | null, title: string, at: number) =>
    db.insert(layaExamples).values({ task, key, input: { state: {}, question: {}, features: [] }, label, laya: laya && { ...laya, raw: laya.p }, source: 'match-answer', title, createdAt: at }).run();
  ex('studio', 's1', 'Paravozik Studio', { answer: 'LostFilm', p: 0.64 }, 'Криминальное прошлое S02E03 MVO Paravozik', 3000);
  ex('match', 'm1', false, { answer: true, p: 0.71 }, 'Медведь / Bear (2025)', 2000);
  ex('match', 'm2', true, null, 'Rivals.S02E03', 1000);
  db.insert(layaVersions).values({ number: 1, createdAt: 1500, examples: 1, laya: 'x', model: 'y', current: true, adapters: {}, metrics: { match: { accuracy: 0.91, logLoss: 0.2, auto: 0.74, n: 71 } } }).run();
  setSetting(db, 'laya.lastTrain', { at: 2500, applied: false, reason: 'Мало новых примеров: 2 из 30' });
  const d = trainingData(db, 4000);
  expect(d.tasks.map((t) => [t.name, t.n, t.accuracy, t.auto])).toEqual([
    ['Какая студия', 1, '—', '—'],
    ['Тот ли это сериал', 2, '91 %', '74 %'],
    ['Нумерация аниме', 0, '—', '—'],
    ['Финальная проверка', 0, '—', '—'],
  ]);
  expect(d.tasks[0].note).toBe('мало примеров — пока чаще спрашивает');
  expect(d.examples.map((e) => [e.title, e.question, e.model, e.you, e.wrong])).toEqual([
    ['Криминальное прошлое S02E03 MVO Paravozik', 'Какая студия?', 'LostFilm · 64 %', 'Paravozik Studio', true],
    ['Медведь / Bear (2025)', 'Тот ли это сериал?', 'да · 71 %', 'нет', true],
    ['Rivals.S02E03', 'Тот ли это сериал?', '—', 'да', false],
  ]);
  expect(d.newCount).toBe(2);
  expect(d.versions.map((v) => [v.name, v.current, v.canRollback])).toEqual([
    ['Версия 1', true, false],
    ['Базовая', false, true],
  ]);
  expect(d.lastTrain).toBe('Последнее обучение: не применено — Мало новых примеров: 2 из 30');
});
