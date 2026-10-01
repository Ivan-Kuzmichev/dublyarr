'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { requireSession } from '@/lib/auth/current';
import { setSecretSetting, setSetting, tryGetSecretSetting } from '@/lib/settings';
import { checkQbittorrent, type QbitConfig } from '@/lib/integrations/qbittorrent';
import { parsePathsForm } from '@/lib/paths-form';
import { checkWritableDir } from '@/lib/fs-check';
import { checkHardlink } from '@/lib/importer';
import { formValues } from '@/lib/form-values';

export type FormState = { ok?: string; error?: string; values?: Record<string, string> };

export async function saveQbitAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireSession();
  const db = getDb();
  const values = formValues(form, ['url', 'username']);
  const saved = tryGetSecretSetting<QbitConfig>(db, 'qbittorrent');
  const cfg = { url: values.url, username: values.username, password: String(form.get('password') ?? '') || saved?.password || '' };
  if (!/^https?:\/\//.test(cfg.url) || !URL.canParse(cfg.url)) return { values, error: 'Адрес вида http://192.168.1.10:8080' };
  const r = await checkQbittorrent(cfg);
  if (!r.ok) return { values, error: r.error };
  if (form.get('intent') === 'check') return { values, ok: `Подключено · qBittorrent ${r.version}` };
  setSecretSetting(db, 'qbittorrent', cfg);
  revalidatePath('/settings/download');
  return { values, ok: `Сохранено · qBittorrent ${r.version}` };
}

export async function savePathsAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireSession();
  const values = formValues(form, ['qbitDownloads', 'downloads', 'media', 'template']);
  const p = parsePathsForm(form);
  if ('error' in p) return { values, error: p.error };
  for (const [label, dir] of [['Папка загрузок', p.downloads], ['Медиатека', p.media]] as const) {
    const c = await checkWritableDir(dir);
    if (!c.ok) return { values, error: `${label}: ${c.error.toLowerCase()}` };
  }
  const link = await checkHardlink(p.downloads, p.media);
  if (form.get('intent') !== 'check') {
    setSetting(getDb(), 'paths', p);
    revalidatePath('/settings/download');
  }
  return { values, ok: `${form.get('intent') === 'check' ? 'Папки доступны' : 'Сохранено'} · ${link.message}` };
}
