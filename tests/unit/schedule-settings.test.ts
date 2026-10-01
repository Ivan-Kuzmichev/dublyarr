import { expect, test } from 'vitest';
import { DEFAULT_SCHEDULE, DEFAULT_SPEED, inNightWindow, nextSearchAt, parseScheduleForm, parseSpeedForm, searchDue, speedAt, speedSummary, type ScheduleSettings, type SpeedState } from '@/lib/schedule';

const MIN = 60_000;
const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m); // 28.09.2026 — понедельник
const s = (o: Partial<ScheduleSettings> = {}): ScheduleSettings => ({ ...DEFAULT_SCHEDULE, ...o });

test('частоты', () => {
  const now = at(30, 12);
  const ago = (m: number) => now.getTime() - m * MIN;
  expect(searchDue({ lastSearchedAt: null, now, settings: s(), eagerToday: false })).toBe(true);
  expect(searchDue({ lastSearchedAt: ago(59), now, settings: s(), eagerToday: false })).toBe(false);
  expect(searchDue({ lastSearchedAt: ago(60), now, settings: s(), eagerToday: false })).toBe(true);
  expect(searchDue({ lastSearchedAt: ago(15), now, settings: s({ every: '15m' }), eagerToday: false })).toBe(true);
  expect(searchDue({ lastSearchedAt: ago(119), now, settings: s({ every: '2h' }), eagerToday: false })).toBe(false);
  expect(searchDue({ lastSearchedAt: ago(360), now, settings: s({ every: '6h' }), eagerToday: false })).toBe(true);
});

test('только ночью; окно через полночь', () => {
  const night = s({ every: 'night', nightFrom: '23:00', nightTo: '06:00' });
  expect(inNightWindow(at(30, 23, 30), '23:00', '06:00')).toBe(true);
  expect(inNightWindow(at(30, 5, 59), '23:00', '06:00')).toBe(true);
  expect(inNightWindow(at(30, 6, 0), '23:00', '06:00')).toBe(false);
  expect(inNightWindow(at(30, 3, 0), '01:00', '07:00')).toBe(true);
  expect(inNightWindow(at(30, 0, 30), '01:00', '07:00')).toBe(false);
  expect(searchDue({ lastSearchedAt: null, now: at(30, 12), settings: night, eagerToday: false })).toBe(false);
  expect(searchDue({ lastSearchedAt: null, now: at(30, 0, 10), settings: night, eagerToday: false })).toBe(true);
  expect(searchDue({ lastSearchedAt: at(30, 0, 10).getTime(), now: at(30, 0, 50), settings: night, eagerToday: false })).toBe(false);
});

test('в день прогноза — каждые 30 минут, даже вне ночного окна', () => {
  const night = s({ every: 'night' });
  const now = at(30, 12);
  expect(searchDue({ lastSearchedAt: now.getTime() - 30 * MIN, now, settings: night, eagerToday: true })).toBe(true);
  expect(searchDue({ lastSearchedAt: now.getTime() - 29 * MIN, now, settings: night, eagerToday: true })).toBe(false);
  expect(searchDue({ lastSearchedAt: now.getTime() - 30 * MIN, now, settings: s({ eager: false, every: 'night' }), eagerToday: true })).toBe(false);
});

test('следующая проверка', () => {
  const now = at(30, 12);
  expect(nextSearchAt({ lastSearchedAt: at(30, 11, 30).getTime(), now, settings: s() })).toEqual(at(30, 12, 30));
  expect(nextSearchAt({ lastSearchedAt: null, now, settings: s() })).toEqual(now);
  expect(nextSearchAt({ lastSearchedAt: null, now, settings: s({ every: 'night' }) })).toEqual(at(31, 1, 0));
});

const grid = (f: (d: number, h: number) => SpeedState) => Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => f(d, h)));

test('скорость сейчас и подпись', () => {
  const g = grid((d, h) => (d === 6 && h === 23 ? 'pause' : h >= 9 && h < 18 ? 'limit' : 'full'));
  expect(speedAt(g, at(28, 0))).toBe('full');
  expect(speedAt(g, at(28, 10))).toBe('limit');
  expect(speedAt(g, at(4 + 30, 23))).toBe('pause'); // 4 октября — воскресенье
  expect(speedSummary({ limitMb: 5, grid: g }, at(30, 10, 15))).toBe('Сейчас: ограничено до 5 МБ/с · полная скорость с 18:00');
  expect(speedSummary({ limitMb: 5, grid: g }, at(30, 20))).toBe('Сейчас: полная скорость · ограничено с чт 09:00');
  expect(speedSummary(DEFAULT_SPEED, at(30, 20))).toBe('Сейчас: полная скорость · всю неделю');
});

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

test('разбор форм', () => {
  expect(parseScheduleForm(fd({ every: '2h', nightFrom: '00:30', nightTo: '06:00', eager: 'on' }))).toEqual({ every: '2h', nightFrom: '00:30', nightTo: '06:00', eager: true, packChecks: false });
  expect(parseScheduleForm(fd({ every: '3h', nightFrom: '01:00', nightTo: '07:00' }))).toEqual({ error: 'Неизвестная частота' });
  expect(parseScheduleForm(fd({ every: '1h', nightFrom: '25:00', nightTo: '07:00' }))).toEqual({ error: 'Время — ЧЧ:ММ' });
  const g = 'f'.repeat(160) + 'l'.repeat(7) + 'p';
  const sp = parseSpeedForm(fd({ limitMb: '12', grid: g }));
  expect(sp).toMatchObject({ limitMb: 12 });
  expect('grid' in sp && sp.grid[6][23]).toBe('pause');
  expect(parseSpeedForm(fd({ limitMb: '0', grid: g }))).toEqual({ error: 'Лимит — от 1 до 1000 МБ/с' });
  expect(parseSpeedForm(fd({ limitMb: '5', grid: 'f'.repeat(10) }))).toEqual({ error: 'Неверная сетка скорости' });
});
