'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { DENIED, guard } from '@/lib/auth/current';
import { setSetting } from '@/lib/settings';
import { parseProcessingForm } from '@/lib/media/tracks';

export type SaveState = { ok?: string; error?: string };

export async function saveProcessingAction(_prev: SaveState, form: FormData): Promise<SaveState> {
  if (!(await guard('admin'))) return { error: DENIED };
  const s = parseProcessingForm(form);
  if ('error' in s) return { error: s.error };
  setSetting(getDb(), 'processing', s);
  revalidatePath('/settings/files');
  return { ok: 'Сохранено · применится к следующим сериям' };
}
