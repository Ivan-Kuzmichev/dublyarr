import pino from 'pino';

const SECRET_KEYS = ['password', 'apiKey', 'apikey', 'token', 'secret', 'totpSecret', 'cookie', 'authorization', 'passkey'];
const paths = SECRET_KEYS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`]);

export function createLogger(opts: { level?: string; destination?: pino.DestinationStream; name?: string } = {}) {
  return pino(
    { level: opts.level ?? process.env.LOG_LEVEL ?? 'info', name: opts.name, redact: { paths, censor: '***' } },
    opts.destination,
  );
}

export const log = createLogger({ name: process.env.DUBLYARR_PROCESS ?? 'web' });

const SECRET_PARAMS = /^(apikey|api_key|token|passkey|password)$/i;

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
