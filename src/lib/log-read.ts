import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getConfig } from './config';

// Чтение журнала (/data/logs): «Диагностика» и GET /api/v1/logs.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogLine = { time: number; level: LogLevel; area: string; proc: string; msg: string; data: Record<string, unknown> };
export type LogFilter = { lines?: number; level?: LogLevel; area?: string; q?: string; since?: number };

const RANK: Record<LogLevel, number> = { debug: 20, info: 30, warn: 40, error: 50 };
const levelName = (n: number): LogLevel => (n >= 50 ? 'error' : n >= 40 ? 'warn' : n >= 30 ? 'info' : 'debug');
const KEEP = 5;
const MAX_LINES = 2000;

export const logDir = () => path.join(getConfig().dataDir, 'logs');

/** Файлы журнала от старых к новым. */
export function logFiles(dir: string): string[] {
  const names = ['dublyarr.log', ...Array.from({ length: KEEP - 1 }, (_, i) => `dublyarr.log.${i + 1}`)];
  return names
    .map((n) => path.join(dir, n))
    .filter((f) => existsSync(f))
    .reverse();
}

/** Последние строки (новые первыми) с фильтрами; оборванные и не-JSON строки пропускаются. */
export function readLog(dir: string, f: LogFilter = {}): LogLine[] {
  const limit = Math.min(Math.max(1, f.lines ?? 500), MAX_LINES);
  const min = RANK[f.level ?? 'debug'] ?? RANK.debug;
  const q = f.q?.toLowerCase();
  const out: LogLine[] = [];
  for (const file of logFiles(dir).reverse()) {
    let rows: string[];
    try {
      rows = readFileSync(file, 'utf8').split('\n');
    } catch {
      continue; // файл ротировали между проверкой и чтением
    }
    for (let i = rows.length - 1; i >= 0 && out.length < limit; i--) {
      let j: Record<string, unknown>;
      try {
        j = JSON.parse(rows[i]) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (!j || typeof j !== 'object') continue;
      const { time, level, area, name, msg, pid: _pid, hostname: _host, ...data } = j;
      const lvl = levelName(Number(level) || 30);
      if (RANK[lvl] < min) continue;
      if (f.area && area !== f.area) continue;
      if (f.since && Number(time) < f.since) continue;
      if (q && !rows[i].toLowerCase().includes(q)) continue;
      out.push({ time: Number(time) || 0, level: lvl, area: String(area ?? 'system'), proc: String(name ?? ''), msg: String(msg ?? ''), data });
    }
    if (out.length >= limit) break;
  }
  return out;
}
