import pino from 'pino';

const SECRET_KEYS = ['password', 'apiKey', 'apikey', 'token', 'secret', 'totpSecret', 'cookie', 'authorization', 'passkey'];
const paths = SECRET_KEYS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`]);

export function createLogger(opts: { level?: string; destination?: pino.DestinationStream; name?: string } = {}) {
  return pino(
    { level: opts.level ?? process.env.LOG_LEVEL ?? 'info', name: opts.name, redact: { paths, censor: '***' } },
    opts.destination,
  );
}

export const LOG_AREAS = ['qbit', 'search', 'parse', 'downloads', 'import', 'tmdb', 'storage', 'laya', 'telegram', 'worker', 'auth', 'api', 'system'] as const;
export type LogArea = (typeof LOG_AREAS)[number];
export type AreaLevel = 'debug' | 'info' | 'warn' | 'off';
export type LogSettings = { level: 'debug' | 'info' | 'warn'; areas: Partial<Record<LogArea, AreaLevel>> };

const ENV_LEVELS = ['debug', 'info', 'warn'];
let settings: LogSettings = { level: ENV_LEVELS.includes(process.env.LOG_LEVEL ?? '') ? (process.env.LOG_LEVEL as LogSettings['level']) : 'info', areas: {} };
// корневой логгер пишет всё, фильтруют логгеры областей (их уровень меняется из настроек на лету)
let root = createLogger({ level: 'debug', name: process.env.DUBLYARR_PROCESS ?? 'web' });
const children = new Map<LogArea, pino.Logger>();
const levelOf = (a: LogArea) => {
  const l = settings.areas[a] ?? settings.level;
  return l === 'off' ? 'silent' : l;
};

function real(area: LogArea): pino.Logger {
  let l = children.get(area);
  if (!l) {
    l = root.child({ area });
    l.level = levelOf(area);
    children.set(area, l);
  }
  return l;
}

const handles = new Map<LogArea, pino.Logger>();

/** Логгер области: поле `area` в каждой строке, уровень — из «Настройки → Диагностика».
 *  Возвращает постоянную ручку (её можно держать в константе модуля): подмена потока в тестах до неё доходит. */
export function logger(area: LogArea): pino.Logger {
  let h = handles.get(area);
  if (!h) {
    h = new Proxy({} as pino.Logger, {
      get(_t, k) {
        const l = real(area);
        const v = Reflect.get(l, k);
        return typeof v === 'function' ? v.bind(l) : v;
      },
      set(_t, k, v) {
        return Reflect.set(real(area), k, v);
      },
    });
    handles.set(area, h);
  }
  return h;
}

export function applyLogSettings(s: LogSettings) {
  settings = s;
  for (const [a, l] of children) l.level = levelOf(a);
}

/** Тесты: писать в свой поток (логгеры областей пересоздаются). */
export function setLogDestination(d: pino.DestinationStream) {
  root = createLogger({ level: 'debug', destination: d, name: 'test' });
  children.clear();
}

/** Общий логгер (область `system`). */
export const log = logger('system');

const SECRET_PARAMS = /^(apikey|api_key|jackett_apikey|token|passkey|password)$/i;

/** Маскирует ключи в query и логин:пароль в адресе — для логов. */
export function redactUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }
  if (u.username || u.password) {
    u.username = '***';
    u.password = '***';
  }
  for (const k of [...u.searchParams.keys()]) if (SECRET_PARAMS.test(k)) u.searchParams.set(k, '***');
  return u.toString().replace(/%2A%2A%2A/g, '***');
}
