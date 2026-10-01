import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { getLogSettings, saveLogSettings, parseLogForm } from '@/lib/log-settings';

test('по умолчанию — info, LOG_LEVEL из env — начальное значение', () => {
  const db = testDb();
  process.env.LOG_LEVEL = 'debug';
  expect(getLogSettings(db)).toEqual({ level: 'debug', areas: {} });
  delete process.env.LOG_LEVEL;
  expect(getLogSettings(db)).toEqual({ level: 'info', areas: {} });
  saveLogSettings(db, { level: 'warn', areas: { qbit: 'debug' } });
  expect(getLogSettings(db)).toEqual({ level: 'warn', areas: { qbit: 'debug' } });
});

test('форма: «как общий» не сохраняется, мусор — ошибка', () => {
  const f = new FormData();
  f.set('level', 'info');
  f.set('area.qbit', 'debug');
  f.set('area.tmdb', 'inherit');
  expect(parseLogForm(f)).toEqual({ level: 'info', areas: { qbit: 'debug' } });
  f.set('level', 'trace');
  expect(parseLogForm(f)).toEqual({ error: 'Неверный уровень' });
});
