'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { requireSession } from '@/lib/auth/current';
import { setSetting } from '@/lib/settings';
import { parseRetentionForm } from '@/lib/retention-settings';
import { enqueue } from '@/worker/jobs';

export type SaveState = { ok?: string; error?: string };

export async function saveRetentionAction(_prev: SaveState, form: FormData): Promise<SaveState> {
  await requireSession();
  const s = parseRetentionForm(form);
  if ('error' in s) return { error: s.error };
  setSetting(getDb(), 'retention', s);
  revalidatePath('/settings/storage');
  revalidatePath('/storage');
  return { ok: 'Сохранено' };
}

/** «Запустить сейчас»: уборка медиатеки (неподтверждённые правила только покажут список). */
export async function runNowAction(): Promise<SaveState> {
  await requireSession();
  enqueue(getDb(), 'retention.run');
  return { ok: 'Уборка запущена — результат появится в «Хранилище» через минуту' };
}
