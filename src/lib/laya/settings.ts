import type { Db } from '../db/client';
import { getSetting } from '../settings';

// «Настройки → AI»: какие задачи решает Laya и порог уверенности.

export type LayaTaskId = 'studio' | 'match' | 'anime' | 'final';
export type LayaSettings = { tasks: Record<LayaTaskId, boolean>; threshold: number };
export const LAYA_TASKS: LayaTaskId[] = ['studio', 'match', 'anime', 'final'];
export const DEFAULT_LAYA: LayaSettings = { tasks: { studio: true, match: true, anime: true, final: true }, threshold: 0.85 };

export function getLayaSettings(db: Db): LayaSettings {
  const s = getSetting<Partial<LayaSettings>>(db, 'laya');
  return { tasks: { ...DEFAULT_LAYA.tasks, ...s?.tasks }, threshold: s?.threshold ?? DEFAULT_LAYA.threshold };
}

export function parseLayaForm(form: FormData): LayaSettings | { error: string } {
  const pct = Number(form.get('threshold'));
  if (!Number.isInteger(pct) || pct < 50 || pct > 99) return { error: 'Порог — от 50 до 99 %' };
  return { tasks: Object.fromEntries(LAYA_TASKS.map((t) => [t, form.get(t) === 'on'])) as Record<LayaTaskId, boolean>, threshold: pct / 100 };
}
