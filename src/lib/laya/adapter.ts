import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { heartbeats, layaVersions, type LayaAdapterSet } from '../db/schema';

// Адаптер задачи: логистическая регрессия поверх ответа Laya и признаков правил. Сама Laya не меняется.

export type Adapter = { w: number[]; b: number } | null;

const EPS = 1e-4;
export const logit = (p: number) => {
  const q = Math.min(1 - EPS, Math.max(EPS, p));
  return Math.log(q / (1 - q));
};
export const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Вероятность после адаптера: w[0] — вес logit(p Laya), остальные — признаки. Нет адаптера — p Laya как есть. */
export function applyAdapter(a: Adapter, pLaya: number, features: number[]): number {
  if (!a) return pLaya;
  const x = [logit(pLaya), ...features];
  return sigmoid(a.b + x.reduce((n, v, i) => n + v * (a.w[i] ?? 0), 0));
}

/** Здоровье laya-serve из последнего опроса воркера. */
export function layaHealthInfo(db: Db): { laya?: string; model?: string; status?: string } {
  const info = db.select().from(heartbeats).where(eq(heartbeats.name, 'laya')).get()?.info;
  try {
    return info ? JSON.parse(info) : {};
  } catch {
    return {};
  }
}

/** Текущая версия адаптеров, если совместима с работающей библиотекой и моделью; иначе — базовая (0). */
export function currentAdapters(db: Db): { version: number; adapters: LayaAdapterSet } {
  const v = db.select().from(layaVersions).where(eq(layaVersions.current, true)).get();
  if (!v) return { version: 0, adapters: {} };
  const h = layaHealthInfo(db);
  if (h.laya !== v.laya || h.model !== v.model) return { version: 0, adapters: {} };
  return { version: v.number, adapters: v.adapters };
}
