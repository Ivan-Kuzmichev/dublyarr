import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { DEFAULT_INTROS, getIntroSettings, parseIntroForm } from '@/lib/intros/settings';
import { setSetting } from '@/lib/settings';

test('по умолчанию включено, Intro / Credits; сохранённое поверх', () => {
  const db = testDb();
  expect(getIntroSettings(db)).toEqual({ on: true, introName: 'Intro', creditsName: 'Credits' });
  setSetting(db, 'intros', { introName: 'Opening' });
  expect(getIntroSettings(db)).toEqual({ ...DEFAULT_INTROS, introName: 'Opening' });
});

test('форма: пустые названия — ошибка, лишние пробелы убираются', () => {
  const f = new FormData();
  f.set('on', 'on');
  f.set('introName', '  OP ');
  f.set('creditsName', 'ED');
  expect(parseIntroForm(f)).toEqual({ on: true, introName: 'OP', creditsName: 'ED' });
  f.set('creditsName', ' ');
  expect(parseIntroForm(f)).toEqual({ error: 'Укажите названия глав' });
  const off = new FormData();
  off.set('introName', 'Intro');
  off.set('creditsName', 'Credits');
  expect(parseIntroForm(off)).toMatchObject({ on: false });
});
