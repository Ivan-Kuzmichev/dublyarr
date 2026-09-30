import path from 'node:path';

export type Config = {
  dataDir: string;
  dbPath: string;
  port: number;
  layaPort: number;
  secretKeyEnv: string | undefined;
  logLevel: string;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const dataDir = env.DATA_DIR || '/data';
  return {
    dataDir,
    dbPath: path.join(dataDir, 'db.sqlite'),
    port: Number(env.PORT || 3000),
    layaPort: Number(env.LAYA_PORT || 8765),
    secretKeyEnv: env.DUBLYARR_SECRET_KEY || undefined,
    logLevel: env.LOG_LEVEL || 'info',
  };
}

let cached: Config | undefined;
export function getConfig(): Config {
  return (cached ??= loadConfig());
}
