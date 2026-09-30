import type { Db } from '../db/client';
import { formValues } from '../form-values';
import { checkTmdb, getTmdbSettings, saveTmdbSettings } from '.';

export type TmdbFormState = { error?: string; ok?: string; values?: Record<string, string> };

/**
 * Общая часть формы TMDB (мастер и настройки): проверить ключ и, если intent не «check», сохранить.
 * Пустое поле ключа при уже сохранённом — берём сохранённый.
 */
export async function checkAndSaveTmdb(db: Db, form: FormData): Promise<TmdbFormState> {
  const values = formValues(form, ['proxy']);
  const apiKey = String(form.get('apiKey') ?? '').trim() || getTmdbSettings(db)?.apiKey || '';
  if (!apiKey) return { values, error: 'Введите ключ API' };
  if (values.proxy && !/^https?:\/\//.test(values.proxy)) return { values, error: 'Прокси — адрес вида http://192.168.1.10:3128' };
  const s = { apiKey, proxy: values.proxy };
  const r = await checkTmdb(s);
  if (!r.ok) return { values, error: r.error };
  if (form.get('intent') === 'check') return { values, ok: 'TMDB отвечает' };
  saveTmdbSettings(db, s);
  return { values, ok: 'Сохранено · TMDB отвечает' };
}
