import type { Db } from './db/client';
import { getSetting } from './settings';

// Расписание (spec §5): как часто искать и когда с какой скоростью качать. Время — локальное время контейнера (TZ).

export type SearchEvery = '15m' | '1h' | '2h' | '6h' | 'night';
export type ScheduleSettings = { every: SearchEvery; nightFrom: string; nightTo: string; eager: boolean; packChecks: boolean };
export type SpeedState = 'full' | 'limit' | 'pause';
export type SpeedSettings = { limitMb: number; grid: SpeedState[][] }; // 7 × 24, строки пн…вс, столбцы — часы

export const DEFAULT_SCHEDULE: ScheduleSettings = { every: '1h', nightFrom: '01:00', nightTo: '07:00', eager: true, packChecks: true };
export const DEFAULT_SPEED: SpeedSettings = { limitMb: 5, grid: Array.from({ length: 7 }, () => Array<SpeedState>(24).fill('full')) };

const MIN = 60_000;
const INTERVAL: Record<Exclude<SearchEvery, 'night'>, number> = { '15m': 15 * MIN, '1h': 60 * MIN, '2h': 120 * MIN, '6h': 360 * MIN };
const EAGER_EVERY = 30 * MIN;
const NIGHT_EVERY = 60 * MIN;

export const getSchedule = (db: Db): ScheduleSettings => ({ ...DEFAULT_SCHEDULE, ...getSetting<Partial<ScheduleSettings>>(db, 'schedule') });
export const getSpeed = (db: Db): SpeedSettings => ({ ...DEFAULT_SPEED, ...getSetting<Partial<SpeedSettings>>(db, 'speed') });

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Внутри ночного окна; окно может переходить через полночь (23:00–06:00). */
export function inNightWindow(now: Date, from: string, to: string): boolean {
  const m = now.getHours() * 60 + now.getMinutes();
  const f = minutes(from);
  const t = minutes(to);
  if (f === t) return false;
  return f < t ? m >= f && m < t : m >= f || m < t;
}

/** Пора ли искать сериал: «чаще в день прогноза» — раз в 30 мин; «только ночью» — раз в час внутри окна; иначе — по интервалу. */
export function searchDue(o: { lastSearchedAt: number | null; now: Date; settings: ScheduleSettings; eagerToday: boolean }): boolean {
  const elapsed = o.lastSearchedAt === null ? Infinity : o.now.getTime() - o.lastSearchedAt;
  if (o.settings.eager && o.eagerToday && elapsed >= EAGER_EVERY) return true;
  if (o.settings.every === 'night') return inNightWindow(o.now, o.settings.nightFrom, o.settings.nightTo) && elapsed >= NIGHT_EVERY;
  return elapsed >= INTERVAL[o.settings.every];
}

/** Когда следующая проверка (для подписи в настройках). */
export function nextSearchAt(o: { lastSearchedAt: number | null; now: Date; settings: ScheduleSettings }): Date {
  const { now, settings: st } = o;
  if (st.every !== 'night') return new Date(Math.max(now.getTime(), (o.lastSearchedAt ?? -Infinity) + INTERVAL[st.every]));
  const after = new Date(Math.max(now.getTime(), (o.lastSearchedAt ?? -Infinity) + NIGHT_EVERY));
  if (inNightWindow(after, st.nightFrom, st.nightTo)) return after;
  const start = new Date(after);
  start.setHours(Math.floor(minutes(st.nightFrom) / 60), minutes(st.nightFrom) % 60, 0, 0);
  if (start.getTime() <= after.getTime()) start.setDate(start.getDate() + 1);
  return start;
}

const row = (d: Date) => (d.getDay() + 6) % 7;
export const speedAt = (grid: SpeedState[][], now: Date): SpeedState => grid[row(now)]?.[now.getHours()] ?? 'full';

const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const stateText = (st: SpeedState, limitMb: number) => (st === 'full' ? 'полная скорость' : st === 'limit' ? `ограничено до ${limitMb} МБ/с` : 'пауза');
const stateShort = (st: SpeedState) => (st === 'full' ? 'полная скорость' : st === 'limit' ? 'ограничено' : 'пауза');

/** «Сейчас: ограничено до 5 МБ/с · полная скорость с 18:00». */
export function speedSummary(s: SpeedSettings, now: Date): string {
  const cur = speedAt(s.grid, now);
  const head = `Сейчас: ${stateText(cur, s.limitMb)}`;
  const t = new Date(now);
  t.setMinutes(0, 0, 0);
  for (let i = 1; i <= 7 * 24; i++) {
    t.setHours(t.getHours() + 1);
    const st = speedAt(s.grid, t);
    if (st === cur) continue;
    const hh = `${String(t.getHours()).padStart(2, '0')}:00`;
    const tomorrowMidnight = t.getHours() === 0 && i <= 24;
    const sameDay = t.getDate() === now.getDate() && i < 24;
    return `${head} · ${stateShort(st)} с ${sameDay || tomorrowMidnight ? hh : `${WD[t.getDay()]} ${hh}`}`;
  }
  return `${head} · всю неделю`;
}

const EVERY: SearchEvery[] = ['15m', '1h', '2h', '6h', 'night'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseScheduleForm(form: FormData): ScheduleSettings | { error: string } {
  const every = String(form.get('every') ?? '') as SearchEvery;
  if (!EVERY.includes(every)) return { error: 'Неизвестная частота' };
  const nightFrom = String(form.get('nightFrom') ?? '');
  const nightTo = String(form.get('nightTo') ?? '');
  if (!TIME.test(nightFrom) || !TIME.test(nightTo)) return { error: 'Время — ЧЧ:ММ' };
  return { every, nightFrom, nightTo, eager: form.get('eager') === 'on', packChecks: form.get('packChecks') === 'on' };
}

const CELL: Record<string, SpeedState> = { f: 'full', l: 'limit', p: 'pause' };

/** Сетка — строка из 168 символов f/l/p (пн 00:00 … вс 23:00). */
export function parseSpeedForm(form: FormData): SpeedSettings | { error: string } {
  const limitMb = Number(form.get('limitMb'));
  if (!Number.isInteger(limitMb) || limitMb < 1 || limitMb > 1000) return { error: 'Лимит — от 1 до 1000 МБ/с' };
  const g = String(form.get('grid') ?? '');
  if (!/^[flp]{168}$/.test(g)) return { error: 'Неверная сетка скорости' };
  return { limitMb, grid: Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => CELL[g[d * 24 + h]])) };
}

export const gridToString = (grid: SpeedState[][]) => grid.flat().map((c) => c[0]).join('');
