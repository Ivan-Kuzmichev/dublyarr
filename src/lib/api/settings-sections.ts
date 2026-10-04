import type { Db } from '../db/client';
import { setSetting, setSecretSetting, tryGetSecretSetting } from '../settings';
import { parseScheduleForm, parseSpeedForm } from '../schedule';
import { parseCleanupForm } from '../cleanup';
import { parseProcessingForm } from '../media/tracks';
import { parseRetentionForm, saveRetentionSettings } from '../retention-settings';
import { parsePathsForm } from '../paths-form';
import { checkWritableDir } from '../fs-check';
import { validateMovieProfile } from '../movie-profile';
import { parseProfileJson } from '../profile-core';
import { saveDefaultProfile } from '../profile';
import { listStudios } from '../studios';
import { parseLayaForm } from '../laya/settings';
import { parseLogForm, saveLogSettings } from '../log-settings';
import { checkQbittorrent, type QbitConfig } from '../integrations/qbittorrent';
import { enqueue } from '../../worker/jobs';

// Изменение разделов настроек через API: те же разборы и проверки, что у форм.
// Нет: «Безопасность», доступ к API, ключ TMDB и бот Telegram (привязка чата — только в интерфейсе).

type Result = { ok: string } | { error: string };
const OK: Result = { ok: 'Сохранено' };

function simple<T>(parse: (f: FormData) => T | { error: string }, save: (db: Db, v: T) => void) {
  return async (db: Db, form: FormData): Promise<Result> => {
    const v = parse(form);
    if (v && typeof v === 'object' && 'error' in v) return { error: (v as { error: string }).error };
    save(db, v as T);
    return OK;
  };
}

function profileJson(kind: 'series' | 'anime') {
  return async (db: Db, form: FormData): Promise<Result> => {
    const r = parseProfileJson(String(form.get('profile') ?? ''), new Set(listStudios(db).map((s) => s.id)));
    if (!r.ok) return { error: r.error };
    saveDefaultProfile(db, kind, r.profile);
    return OK;
  };
}

export const SETTINGS_WRITE: Record<string, (db: Db, form: FormData) => Promise<Result>> = {
  schedule: simple(parseScheduleForm, (db, v) => setSetting(db, 'schedule', v)),
  speed: simple(parseSpeedForm, (db, v) => setSetting(db, 'speed', v)),
  cleanup: simple(parseCleanupForm, (db, v) => {
    setSetting(db, 'cleanup', v);
    enqueue(db, 'cleanup.run');
  }),
  processing: simple(parseProcessingForm, (db, v) => setSetting(db, 'processing', v)),
  retention: simple(parseRetentionForm, saveRetentionSettings),
  laya: simple(parseLayaForm, (db, v) => setSetting(db, 'laya', v)),
  logging: simple(parseLogForm, saveLogSettings),
  'profile.series': profileJson('series'),
  'profile.anime': profileJson('anime'),
  'profile.movie': async (db, form) => {
    let raw: unknown;
    try {
      raw = JSON.parse(String(form.get('profile') ?? ''));
    } catch {
      return { error: 'Неверные настройки фильма' };
    }
    const r = validateMovieProfile(raw);
    if (!r.ok) return { error: r.error };
    setSetting(db, 'profile.movie', r.profile);
    return OK;
  },
  paths: async (db, form) => {
    const p = parsePathsForm(form);
    if ('error' in p) return { error: p.error };
    for (const [label, dir] of [['Папка загрузок', p.downloads], ['Медиатека', p.media], ...(p.movies ? [['Папка фильмов', p.movies] as const] : [])] as const) {
      const c = await checkWritableDir(dir);
      if (!c.ok) return { error: `${label}: ${c.error.toLowerCase()}` };
    }
    setSetting(db, 'paths', p);
    return OK;
  },
  qbittorrent: async (db, form) => {
    const saved = tryGetSecretSetting<QbitConfig>(db, 'qbittorrent');
    const cfg = { url: String(form.get('url') ?? '').trim(), username: String(form.get('username') ?? '').trim(), password: String(form.get('password') ?? '') || saved?.password || '' };
    if (!/^https?:\/\//.test(cfg.url) || !URL.canParse(cfg.url)) return { error: 'Адрес вида http://192.168.1.10:8080' };
    const r = await checkQbittorrent(cfg);
    if (!r.ok) return { error: r.error };
    setSecretSetting(db, 'qbittorrent', cfg);
    return { ok: `Сохранено · qBittorrent ${r.version}` };
  },
};
