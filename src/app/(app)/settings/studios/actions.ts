'use server';

import { confirmLayaAlias } from '@/lib/laya/review';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { requireSession } from '@/lib/auth/current';
import { createStudio, deleteStudio, listStudios, updateStudio, StudioError } from '@/lib/studios';
import { parseStudioForm } from '@/lib/studio-form';
import { parseProfileJson, saveDefaultProfile } from '@/lib/profile';
import { formValues } from '@/lib/form-values';
import type { DialogState } from '@/components/subscribe/SubscribeDialog';

export type StudioFormState = { ok?: boolean; error?: string; values?: Record<string, string> };

const done = () => {
  revalidatePath('/settings/studios');
  return { ok: true };
};

export async function saveStudioAction(_prev: StudioFormState, form: FormData): Promise<StudioFormState> {
  await requireSession();
  const values = formValues(form, ['name', 'aliases', 'trackers', 'kind']);
  const input = parseStudioForm(form);
  if ('error' in input) return { error: input.error, values };
  const id = Number(form.get('id'));
  try {
    if (Number.isInteger(id) && id > 0) updateStudio(getDb(), id, input);
    else createStudio(getDb(), input);
  } catch (e) {
    if (e instanceof StudioError) return { error: e.message, values };
    throw e;
  }
  return done();
}

export async function deleteStudioAction(_prev: StudioFormState, form: FormData): Promise<StudioFormState> {
  await requireSession();
  const id = Number(form.get('id'));
  if (!Number.isInteger(id) || id <= 0) return { error: 'Студия не найдена' };
  try {
    deleteStudio(getDb(), id);
  } catch (e) {
    if (e instanceof StudioError) return { error: e.message };
    throw e;
  }
  return done();
}

export async function saveDefaultProfileAction(_prev: DialogState, form: FormData): Promise<DialogState> {
  await requireSession();
  const kind = form.get('kind');
  if (kind !== 'series' && kind !== 'anime') return { error: 'Неверный профиль' };
  const db = getDb();
  const r = parseProfileJson(String(form.get('profile') ?? ''), new Set(listStudios(db).map((s) => s.id)));
  if (!r.ok) return { error: r.error };
  saveDefaultProfile(db, kind, r.profile);
  return done();
}

/** «Верно» / «Нет» на вариант написания, который добавила Laya. */
export async function confirmLayaAliasAction(form: FormData) {
  await requireSession();
  const id = Number(form.get('studioId'));
  const alias = String(form.get('alias') ?? '');
  if (!Number.isInteger(id) || !alias) return;
  confirmLayaAlias(getDb(), id, alias, form.get('verdict') === 'ok');
  revalidatePath('/settings/studios');
}
