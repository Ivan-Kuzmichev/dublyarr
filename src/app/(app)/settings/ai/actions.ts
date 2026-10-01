'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { requireSession } from '@/lib/auth/current';
import { getConfig } from '@/lib/config';
import { setSetting } from '@/lib/settings';
import { parseLayaForm } from '@/lib/laya/settings';
import { createLayaClient } from '@/lib/laya/client';
import { rollback } from '@/lib/laya/versions';
import { layaExamples } from '@/lib/db/schema';
import { enqueue } from '@/worker/jobs';
import path from 'node:path';

export type FormState = { ok?: string; error?: string };

export async function saveLayaAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireSession();
  const s = parseLayaForm(form);
  if ('error' in s) return { error: s.error };
  setSetting(getDb(), 'laya', s);
  revalidatePath('/settings/ai');
  return { ok: 'Сохранено' };
}

/** «Проверить»: здоровье laya-serve и один вопрос — сколько отвечает. */
export async function checkLayaAction(): Promise<FormState> {
  await requireSession();
  const c = createLayaClient({ port: getConfig().layaPort });
  const h = await c.health();
  if (!h) return { error: 'Laya не отвечает' };
  if (h.status === 'downloading') return { error: 'Модель ещё скачивается' };
  if (h.status === 'loading') return { error: 'Модель загружается' };
  if (h.status === 'error') return { error: `Ошибка: ${h.error ?? 'неизвестно'}` };
  const r = await c.ask({ сериал: 'Дэдлок (2023)', раздача: 'Deadloch.S02E05.1080p.WEB-DL.Jaskier' }, { q: { type: 'noul', instructions: 'Эта раздача — тот же сериал?' } });
  if (!r) return { error: 'Laya не ответила на вопрос' };
  return { ok: `Laya отвечает · ${String(Math.round(r.ms / 100) / 10).replace('.', ',')} с` };
}

export async function trainNowAction(): Promise<FormState> {
  await requireSession();
  enqueue(getDb(), 'laya.train-now');
  return { ok: 'Обучение запущено — займёт несколько секунд' };
}

export async function rollbackAction(form: FormData) {
  await requireSession();
  const v = String(form.get('version'));
  rollback(getDb(), path.join(getConfig().dataDir, 'laya'), v === 'base' ? 'base' : Number(v));
  revalidatePath('/settings/ai/training');
}

export async function deleteExampleAction(form: FormData) {
  await requireSession();
  const id = Number(form.get('id'));
  if (Number.isInteger(id)) getDb().delete(layaExamples).where(eq(layaExamples.id, id)).run();
  revalidatePath('/settings/ai/training');
}
