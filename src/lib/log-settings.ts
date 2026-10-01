import type { Db } from './db/client';
import { getSetting, setSetting } from './settings';
import { applyLogSettings, LOG_AREAS, type AreaLevel, type LogSettings } from './log';

const LEVELS = ['debug', 'info', 'warn'] as const;
const AREA_LEVELS: AreaLevel[] = ['debug', 'info', 'warn', 'off'];

/** Настройка логов; пока её нет — уровень из LOG_LEVEL (только начальное значение). */
export function getLogSettings(db: Db): LogSettings {
  const env = process.env.LOG_LEVEL ?? '';
  return getSetting<LogSettings>(db, 'logging') ?? { level: (LEVELS as readonly string[]).includes(env) ? (env as LogSettings['level']) : 'info', areas: {} };
}

export function saveLogSettings(db: Db, s: LogSettings) {
  setSetting(db, 'logging', s);
  applyLogSettings(s);
}

/** Форма «Логирование»: общий уровень и уровни областей («как общий» не сохраняется). */
export function parseLogForm(form: FormData): LogSettings | { error: string } {
  const level = String(form.get('level') ?? 'info');
  if (!(LEVELS as readonly string[]).includes(level)) return { error: 'Неверный уровень' };
  const areas: LogSettings['areas'] = {};
  for (const a of LOG_AREAS) {
    const v = String(form.get(`area.${a}`) ?? 'inherit');
    if (v === 'inherit') continue;
    if (!AREA_LEVELS.includes(v as AreaLevel)) return { error: 'Неверный уровень' };
    areas[a] = v as AreaLevel;
  }
  return { level: level as LogSettings['level'], areas };
}

/** Процессы перечитывают настройку раз в 10 с — смена уровней без перезапуска. */
export function watchLogSettings(db: Db, everyMs = 10_000): () => void {
  const tick = () => {
    try {
      applyLogSettings(getLogSettings(db));
    } catch {
      // база занята — применим в следующий раз
    }
  };
  tick();
  const t = setInterval(tick, everyMs);
  t.unref();
  return () => clearInterval(t);
}
