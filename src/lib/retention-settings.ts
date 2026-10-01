import type { Db } from './db/client';
import { getSetting } from './settings';

// Правила хранения (spec §8): настройки и расписание уборки медиатеки.

export type RetentionSettings = {
  seasons: { on: boolean; keep: number; ended: 'keep' | 'clean' };
  oldCopy: 'now' | '3days' | 'cleanup';
  age: { days: number };
  overflow: { on: boolean; warn: number; pause: number };
  schedule: 'daily' | 'weekly' | 'manual';
};

export const DEFAULT_RETENTION: RetentionSettings = {
  seasons: { on: false, keep: 1, ended: 'keep' },
  oldCopy: 'now',
  age: { days: 30 },
  overflow: { on: true, warn: 90, pause: 97 },
  schedule: 'weekly',
};

export function getRetention(db: Db): RetentionSettings {
  const s = getSetting<Partial<RetentionSettings>>(db, 'retention') ?? {};
  return {
    ...DEFAULT_RETENTION,
    ...s,
    seasons: { ...DEFAULT_RETENTION.seasons, ...s.seasons },
    age: { ...DEFAULT_RETENTION.age, ...s.age },
    overflow: { ...DEFAULT_RETENTION.overflow, ...s.overflow },
  };
}

const int = (v: FormDataEntryValue | null) => Number(String(v ?? '').trim());

export function parseRetentionForm(form: FormData): RetentionSettings | { error: string } {
  const keep = int(form.get('keep'));
  if (!Number.isInteger(keep) || keep < 1 || keep > 10) return { error: 'Хранить сезонов — от 1 до 10' };
  const ended = String(form.get('ended')) as RetentionSettings['seasons']['ended'];
  if (!['keep', 'clean'].includes(ended)) return { error: 'Неизвестный вариант для завершённых' };
  const oldCopy = String(form.get('oldCopy')) as RetentionSettings['oldCopy'];
  if (!['now', '3days', 'cleanup'].includes(oldCopy)) return { error: 'Неизвестный режим старой копии' };
  const days = int(form.get('days'));
  if (!Number.isInteger(days) || days < 1 || days > 365) return { error: 'Срок — от 1 до 365 дней' };
  const warn = int(form.get('warn'));
  const pause = int(form.get('pause'));
  if (!Number.isInteger(warn) || warn < 50 || warn > 99) return { error: 'Предупреждение — от 50 до 99 %' };
  if (!Number.isInteger(pause) || pause <= warn || pause > 99) return { error: 'Пауза — выше порога предупреждения, не больше 99 %' };
  const schedule = String(form.get('schedule')) as RetentionSettings['schedule'];
  if (!['daily', 'weekly', 'manual'].includes(schedule)) return { error: 'Неизвестная частота уборки' };
  return { seasons: { on: form.get('seasonsOn') === 'on', keep, ended }, oldCopy, age: { days }, overflow: { on: form.get('overflowOn') === 'on', warn, pause }, schedule };
}

const HOUR = 4; // уборка в 04:00 по времени контейнера

/** Последний момент уборки по расписанию, не позже now (неделя — воскресенье). */
function lastSlot(schedule: 'daily' | 'weekly', now: Date): Date {
  const s = new Date(now);
  s.setHours(HOUR, 0, 0, 0);
  if (s > now) s.setDate(s.getDate() - 1);
  if (schedule === 'weekly') s.setDate(s.getDate() - s.getDay());
  return s;
}

export function retentionDue(schedule: RetentionSettings['schedule'], lastRun: number | null, now: Date): boolean {
  if (schedule === 'manual') return false;
  return lastRun === null || lastRun < lastSlot(schedule, now).getTime();
}

export function nextRetentionAt(schedule: RetentionSettings['schedule'], lastRun: number | null, now: Date): Date | null {
  if (schedule === 'manual') return null;
  if (retentionDue(schedule, lastRun, now)) return now;
  const next = lastSlot(schedule, now);
  next.setDate(next.getDate() + (schedule === 'weekly' ? 7 : 1));
  return next;
}
