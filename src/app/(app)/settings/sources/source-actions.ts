'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { requireSession } from '@/lib/auth/current';
import { parseSourceForm } from '@/lib/source-form';
import { addSource, removeSource, savedApiKey, updateSource, sourcesForSearch } from '@/lib/sources';
import { torznabCaps, torznabIndexers, TorznabError } from '@/lib/torznab';
import { markSourceTrackers, setPrimary, syncTrackers } from '@/lib/trackers';
import { formValues } from '@/lib/form-values';

export type SourceFormState = { ok?: boolean; error?: string; values?: Record<string, string> };

const idOf = (form: FormData, key = 'id') => {
  const n = Number(form.get(key));
  return Number.isInteger(n) && n > 0 ? n : null;
};

export async function saveSourceAction(_prev: SourceFormState, form: FormData): Promise<SourceFormState> {
  await requireSession();
  const db = getDb();
  const values = formValues(form, ['name', 'url', 'timeout']);
  const input = parseSourceForm(form);
  if ('error' in input) return { error: input.error, values };
  const id = idOf(form);
  const key = input.apiKey || (id ? savedApiKey(db, id) : '');
  const src = { url: input.url, apiKey: key, timeoutMs: input.timeoutMs };
  let indexers;
  try {
    await torznabCaps(src);
    indexers = await torznabIndexers(src);
  } catch (e) {
    return { error: e instanceof TorznabError ? e.message : String(e), values };
  }
  const sourceId = id ?? addSource(db, { ...input, apiKey: key }).id;
  if (id) updateSource(db, id, input);
  if (indexers) syncTrackers(db, sourceId, indexers);
  markSourceTrackers(db, sourceId, null);
  revalidatePath('/settings/sources');
  return { ok: true };
}

export async function deleteSourceAction(_prev: SourceFormState, form: FormData): Promise<SourceFormState> {
  await requireSession();
  const id = idOf(form);
  if (!id) return { error: 'Источник не найден' };
  removeSource(getDb(), id);
  revalidatePath('/settings/sources');
  return { ok: true };
}

export async function setPrimaryAction(form: FormData) {
  await requireSession();
  const id = idOf(form, 'trackerId');
  if (id) setPrimary(getDb(), id);
  revalidatePath('/settings/sources');
}

export async function refreshTrackersAction(form: FormData) {
  await requireSession();
  const db = getDb();
  const id = idOf(form);
  const src = sourcesForSearch(db).find((s) => s.id === id);
  if (!src) return;
  try {
    const list = await torznabIndexers(src);
    if (list) syncTrackers(db, src.id, list);
    markSourceTrackers(db, src.id, null);
  } catch (e) {
    markSourceTrackers(db, src.id, e instanceof Error ? e.message : String(e));
  }
  revalidatePath('/settings/sources');
}
