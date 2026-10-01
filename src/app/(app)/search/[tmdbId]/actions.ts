'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { requireSession } from '@/lib/auth/current';
import { getTitleByTmdbId } from '@/lib/catalog';
import { answerMatch, assignStudio } from '@/lib/manual-search';
import { StudioError } from '@/lib/studios';

export type AssignState = { ok?: boolean; error?: string };

const positive = (v: FormDataEntryValue | null) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

function titleOf(form: FormData) {
  const tmdbId = positive(form.get('tmdbId'));
  const title = tmdbId ? getTitleByTmdbId(getDb(), tmdbId) : undefined;
  return title ? { tmdbId: tmdbId!, title } : null;
}

export async function assignStudioAction(_prev: AssignState, form: FormData): Promise<AssignState> {
  await requireSession();
  const t = titleOf(form);
  if (!t) return { error: 'Сериал не найден' };
  const label = String(form.get('label') ?? '').trim();
  if (!label) return { error: 'Нет подписи студии' };
  const choice = String(form.get('studio') ?? '');
  try {
    if (choice === 'new') {
      const newName = String(form.get('newName') ?? '').trim() || label;
      assignStudio(getDb(), t.title.id, { label, newName });
    } else {
      const studioId = positive(choice);
      if (!studioId) return { error: 'Выберите студию' };
      assignStudio(getDb(), t.title.id, { label, studioId });
    }
  } catch (e) {
    if (e instanceof StudioError || e instanceof Error) return { error: e.message };
    throw e;
  }
  revalidatePath(`/search/${t.tmdbId}`);
  return { ok: true };
}

export async function answerMatchAction(form: FormData) {
  await requireSession();
  const t = titleOf(form);
  const releaseId = positive(form.get('releaseId'));
  const verdict = form.get('verdict');
  if (!t || !releaseId || (verdict !== 'match' && verdict !== 'reject')) return;
  answerMatch(getDb(), t.title.id, releaseId, verdict);
  revalidatePath(`/search/${t.tmdbId}`);
}
