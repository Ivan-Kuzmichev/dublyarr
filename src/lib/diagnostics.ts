import type { Db } from './db/client';
import type { LogArea } from './log';

// Сводки «Диагностики» (и GET /api/v1/status).

export type JobSummary = { type: string; lastDoneAt: number | null; lastError: string | null; queued: number };

/** По типу задачи: последний успешный запуск, последняя ошибка (если она позже успеха), сколько в очереди. */
export function jobsSummary(db: Db): JobSummary[] {
  const rows = db.$client
    .prepare(
      `SELECT type,
              MAX(CASE WHEN status = 'done' THEN updated_at END) AS lastDoneAt,
              SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
              (SELECT last_error FROM jobs j2 WHERE j2.type = jobs.type AND j2.last_error IS NOT NULL ORDER BY updated_at DESC, id DESC LIMIT 1) AS lastError,
              (SELECT updated_at FROM jobs j3 WHERE j3.type = jobs.type AND j3.last_error IS NOT NULL ORDER BY updated_at DESC, id DESC LIMIT 1) AS errorAt
       FROM jobs GROUP BY type ORDER BY type`,
    )
    .all() as { type: string; lastDoneAt: number | null; queued: number; lastError: string | null; errorAt: number | null }[];
  return rows.map((r) => ({
    type: r.type,
    lastDoneAt: r.lastDoneAt,
    lastError: r.lastError && (r.lastDoneAt === null || (r.errorAt ?? 0) > r.lastDoneAt) ? r.lastError : null,
    queued: r.queued,
  }));
}

export const AREA_LABELS: Record<LogArea, string> = {
  qbit: 'qBittorrent',
  search: 'Источники и поиск',
  parse: 'Разбор раздач',
  downloads: 'Загрузки',
  import: 'Импорт и пересборка',
  tmdb: 'TMDB',
  storage: 'Хранение и уборка',
  laya: 'Laya',
  telegram: 'Telegram',
  worker: 'Задачи воркера',
  auth: 'Вход',
  api: 'API',
  system: 'Система',
};
