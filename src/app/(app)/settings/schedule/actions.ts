'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { requireSession } from '@/lib/auth/current';
import { setSetting } from '@/lib/settings';
import { parseScheduleForm, parseSpeedForm } from '@/lib/schedule';

export type SaveState = { ok?: string; error?: string };

export async function saveScheduleAction(_prev: SaveState, form: FormData): Promise<SaveState> {
  await requireSession();
  const s = parseScheduleForm(form);
  if ('error' in s) return { error: s.error };
  setSetting(getDb(), 'schedule', s);
  revalidatePath('/settings/schedule');
  return { ok: 'Сохранено' };
}

export async function saveSpeedAction(_prev: SaveState, form: FormData): Promise<SaveState> {
  await requireSession();
  const s = parseSpeedForm(form);
  if ('error' in s) return { error: s.error };
  setSetting(getDb(), 'speed', s);
  revalidatePath('/settings/schedule');
  return { ok: 'Сохранено · применится в течение минуты' };
}
