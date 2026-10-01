'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { requireSession } from '@/lib/auth/current';
import { parseSourceForm } from '@/lib/source-form';
import { removeSource, sourcesForSearch } from '@/lib/sources';
import { torznabIndexers } from '@/lib/torznab';
import { markSourceTrackers, setPrimary, syncTrackers } from '@/lib/trackers';
import { saveSource } from '@/lib/source-save';
import { endpointFor } from '@/lib/source-kinds';
import { formValues } from '@/lib/form-values';

export type SourceFormState = { ok?: boolean; error?: string; values?: Record<string, string> };

const idOf = (form: FormData, key = 'id') => {
  const n = Number(form.get(key));
  return Number.isInteger(n) && n > 0 ? n : null;
};

export async function saveSourceAction(_prev: SourceFormState, form: FormData): Promise<SourceFormState> {
  await requireSession();
  const db = getDb();
  const values = formValues(form, ['name', 'url', 'timeout', 'kind']);
  const input = parseSourceForm(form);
  if ('error' in input) return { error: input.error, values };
  const r = await saveSource(db, input, idOf(form));
  if ('error' in r) return { error: r.error, values };
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
  // JacRed списка трекеров не отдаёт — трекеры появляются из результатов поиска
  if (src.kind === 'jacred') return;
  try {
    const list = await torznabIndexers({ ...src, url: endpointFor(src) });
    if (list) syncTrackers(db, src.id, list);
    markSourceTrackers(db, src.id, null);
  } catch (e) {
    markSourceTrackers(db, src.id, e instanceof Error ? e.message : String(e));
  }
  revalidatePath('/settings/sources');
}
