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

// --- обучение ---

export type TrainRow = { id?: number; pLaya: number; features: number[]; label: boolean };

/** Логистическая регрессия (градиентный спуск, слабая L2): x = [logit(p Laya), ...признаки]. Секунды даже на NAS. */
export function trainAdapter(rows: TrainRow[], o: { iters?: number; lr?: number; l2?: number } = {}): Adapter {
  if (!rows.length) return null;
  const xs = rows.map((r) => [logit(r.pLaya), ...r.features]);
  const ys = rows.map((r) => (r.label ? 1 : 0));
  const dim = xs[0].length;
  const w = new Array<number>(dim).fill(0);
  let b = 0;
  const iters = o.iters ?? 800;
  const lr = o.lr ?? 0.5;
  const l2 = o.l2 ?? 0.001;
  for (let it = 0; it < iters; it++) {
    const gw = new Array<number>(dim).fill(0);
    let gb = 0;
    for (let i = 0; i < xs.length; i++) {
      const err = sigmoid(b + xs[i].reduce((n, v, j) => n + v * w[j], 0)) - ys[i];
      for (let j = 0; j < dim; j++) gw[j] += err * xs[i][j];
      gb += err;
    }
    for (let j = 0; j < dim; j++) w[j] -= lr * (gw[j] / xs.length + l2 * w[j]);
    b -= (lr * gb) / xs.length;
  }
  return { w: w.map((v) => Math.round(v * 1e6) / 1e6), b: Math.round(b * 1e6) / 1e6 };
}

/** Отложенные 20 % — по id (детерминированно, одни и те же при каждом обучении). */
export function splitHoldout<T extends { id?: number }>(rows: T[]): { train: T[]; test: T[] } {
  return { train: rows.filter((r) => (r.id ?? 0) % 5 !== 0), test: rows.filter((r) => (r.id ?? 0) % 5 === 0) };
}

/** Точность, log-loss и доля решений, которые Laya приняла бы сама (уверенность ≥ порога). */
export function metrics(a: Adapter, rows: TrainRow[], threshold: number) {
  if (!rows.length) return { accuracy: 0, logLoss: 0, auto: 0, n: 0 };
  let correct = 0;
  let loss = 0;
  let auto = 0;
  for (const r of rows) {
    const p = Math.min(1 - 1e-6, Math.max(1e-6, applyAdapter(a, r.pLaya, r.features)));
    if (p >= 0.5 === r.label) correct++;
    loss += -(r.label ? Math.log(p) : Math.log(1 - p));
    if (Math.max(p, 1 - p) >= threshold) auto++;
  }
  return { accuracy: correct / rows.length, logLoss: loss / rows.length, auto: auto / rows.length, n: rows.length };
}
