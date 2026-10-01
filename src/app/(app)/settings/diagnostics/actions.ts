'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { requireSession } from '@/lib/auth/current';
import { parseLogForm, saveLogSettings } from '@/lib/log-settings';

export type LogFormState = { ok?: string; error?: string };

export async function saveLogSettingsAction(_prev: LogFormState, form: FormData): Promise<LogFormState> {
  await requireSession();
  const s = parseLogForm(form);
  if ('error' in s) return { error: s.error };
  saveLogSettings(getDb(), s);
  revalidatePath('/settings/diagnostics');
  return { ok: 'Сохранено · действует через 10 с' };
}
