'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/client';
import { createUser, hasAnyUser } from '@/lib/auth/users';
import { validateNewPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/sessions';
import { COOKIE_SESSION, cookieOptions } from '@/lib/auth/cookies';
import { requestContext } from '@/lib/auth/current';
import { tryGetSecretSetting, setSecretSetting, setSetting } from '@/lib/settings';
import { markStep, completeSetup } from '@/lib/setup';
import { checkQbittorrent, type QbitConfig } from '@/lib/integrations/qbittorrent';
import { checkTorznab } from '@/lib/integrations/torznab';
import { addSource, listSources, removeSource } from '@/lib/sources';
import { checkWritableDir } from '@/lib/fs-check';
import { requireSetupSession } from './guard';
import { revalidatePath } from 'next/cache';
import { torznabIndexers } from '@/lib/torznab';
import { syncTrackers } from '@/lib/trackers';
import { checkAndSaveTmdb } from '@/lib/tmdb/form';
import { formValues } from '@/lib/form-values';

export type StepState = { error?: string; ok?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };

const str = (form: FormData, k: string) => String(form.get(k) ?? '').trim();

export async function createAccountAction(_prev: StepState, form: FormData): Promise<StepState> {
  const db = getDb();
  if (hasAnyUser(db)) redirect('/login');
  const username = str(form, 'username');
  const password = String(form.get('password') ?? '');
  const values = formValues(form, ['username']);
  if (!username) return { values, fieldErrors: { username: 'Введите логин' } };
  const pwError = validateNewPassword(password);
  if (pwError) return { values, fieldErrors: { password: pwError } };
  if (password !== String(form.get('password2') ?? '')) return { values, fieldErrors: { password2: 'Пароли не совпадают' } };
  let userId: number;
  try {
    userId = (await createUser(db, username, password)).id;
  } catch {
    redirect('/login');
  }
  const ctx = await requestContext();
  const s = createSession(db, { userId, persistent: true, userAgent: ctx.userAgent, ip: ctx.ip });
  (await cookies()).set(COOKIE_SESSION, s.token, cookieOptions(ctx.secure, s.expiresAt));
  redirect('/setup/tmdb');
}

export async function tmdbSetupAction(_prev: StepState, form: FormData): Promise<StepState> {
  await requireSetupSession();
  const db = getDb();
  if (form.get('intent') === 'skip') {
    markStep(db, 'tmdb', 'skipped');
    redirect('/setup/qbittorrent');
  }
  const r = await checkAndSaveTmdb(db, form);
  if ('error' in r || form.get('intent') === 'check') return r;
  markStep(db, 'tmdb', 'done');
  redirect('/setup/qbittorrent');
}

export async function qbittorrentAction(_prev: StepState, form: FormData): Promise<StepState> {
  await requireSetupSession();
  const db = getDb();
  if (form.get('intent') === 'skip') {
    markStep(db, 'qbittorrent', 'skipped');
    redirect('/setup/sources');
  }
  const saved = tryGetSecretSetting<QbitConfig>(db, 'qbittorrent');
  const cfg: QbitConfig = {
    url: str(form, 'url'),
    username: str(form, 'username'),
    password: String(form.get('password') ?? '') || saved?.password || '',
  };
  const values = formValues(form, ['url', 'username']);
  if (!/^https?:\/\//.test(cfg.url)) return { values, fieldErrors: { url: 'Адрес вида http://192.168.1.10:8080' } };
  const r = await checkQbittorrent(cfg);
  if (!r.ok) return { values, error: r.error };
  if (form.get('intent') === 'check') return { values, ok: `Подключено · qBittorrent ${r.version}` };
  setSecretSetting(db, 'qbittorrent', cfg);
  markStep(db, 'qbittorrent', 'done');
  redirect('/setup/sources');
}

export async function addSourceAction(_prev: StepState, form: FormData): Promise<StepState> {
  await requireSetupSession();
  const db = getDb();
  const intent = form.get('intent');
  if (intent === 'skip' || intent === 'next') {
    if (intent === 'next' && listSources(db).length === 0) return { error: 'Добавьте хотя бы один источник или пропустите шаг' };
    markStep(db, 'sources', intent === 'next' ? 'done' : 'skipped');
    redirect('/setup/folders');
  }
  const s = { name: str(form, 'name') || 'Jackett', url: str(form, 'url'), apiKey: str(form, 'apiKey') };
  const values = formValues(form, ['name', 'url']);
  if (!/^https?:\/\//.test(s.url)) return { values, fieldErrors: { url: 'Адрес вида http://jackett:9117/api/v2.0/indexers/all/results/torznab/' } };
  const r = await checkTorznab(s);
  if (!r.ok) return { values, error: r.error };
  const { id } = addSource(db, s);
  // сразу список трекеров источника (для основного/запасного); не умеет — соберётся при поиске
  try {
    const list = await torznabIndexers({ url: s.url, apiKey: s.apiKey, timeoutMs: 15_000 });
    if (list) syncTrackers(db, id, list);
  } catch {
    // не страшно: трекеры появятся при первом поиске
  }
  revalidatePath('/setup/sources');
  return { ok: `«${s.name}» добавлен · категорий: ${r.categories}` };
}

export async function removeSourceAction(form: FormData) {
  await requireSetupSession();
  const id = Number(form.get('id'));
  if (Number.isInteger(id) && id > 0) removeSource(getDb(), id);
  redirect('/setup/sources');
}

export async function foldersAction(_prev: StepState, form: FormData): Promise<StepState> {
  await requireSetupSession();
  const downloads = str(form, 'downloads');
  const media = str(form, 'media');
  const [d, m] = await Promise.all([checkWritableDir(downloads), checkWritableDir(media)]);
  const fieldErrors: Record<string, string> = {};
  if (!d.ok) fieldErrors.downloads = d.error;
  if (!m.ok) fieldErrors.media = m.error;
  if (Object.keys(fieldErrors).length) return { fieldErrors, values: formValues(form, ['downloads', 'media']) };
  const db = getDb();
  setSetting(db, 'paths', { downloads, media });
  markStep(db, 'folders', 'done');
  completeSetup(db);
  redirect('/');
}
