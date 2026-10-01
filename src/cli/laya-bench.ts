import type { Db } from '../lib/db/client';
import { setSetting } from '../lib/settings';

// Замер скорости Laya на этом железе (план фазы 4: «замерить скорость ответа на CPU NAS»).

const CASES: [string, string][] = [
  ['Игра престолов (2011), сезонов 8', 'Game of Thrones / S1E1-10 of 10 [2011, BDRip 1080p] Dub + MVO (LostFilm)'],
  ['Дэдлок (2023), сезонов 2', 'Deadloch.S02E05.1080p.WEB-DL.Jaskier'],
  ['Медведь (2022), сезонов 3', 'Медведь / Bear (2025) [WEB-DL 1080p] Дубляж'],
  ['Соперники (2024), сезонов 2', 'Rivals.S02E03.2160p.NewStudio'],
];

export function benchStats(ms: number[]) {
  const s = [...ms].sort((a, b) => a - b);
  return { mean: Math.round(s.reduce((n, x) => n + x, 0) / s.length), p95: s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] };
}

export async function runBench(db: Db, o: { port: number; fetchImpl?: typeof fetch; now?: number; count?: number }) {
  const f = o.fetchImpl ?? fetch;
  const base = `http://127.0.0.1:${o.port}`;
  const health = (await (await f(`${base}/health`)).json()) as { status: string; runtime?: string };
  if (health.status !== 'ready') throw new Error(`Laya не готова: ${health.status}`);
  const ms: number[] = [];
  for (let i = 0; i < (o.count ?? 20); i++) {
    const [series, release] = CASES[i % CASES.length];
    const body = JSON.stringify({ state: { сериал: series, раздача: release }, questions: { q: { type: 'noul', instructions: 'Эта раздача — тот же сериал?' } } });
    const r = (await (await f(`${base}/ask`, { method: 'POST', body })).json()) as { ms: number };
    ms.push(r.ms);
  }
  const res = { ...benchStats(ms), runtime: health.runtime ?? '' };
  setSetting(db, 'laya.bench', { ...res, at: o.now ?? Date.now() });
  return res;
}
