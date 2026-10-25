'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { DENIED, guard } from '@/lib/auth/current';
import { getConfig } from '@/lib/config';
import { setSetting } from '@/lib/settings';
import { layaEnabled, parseLayaForm, setLayaEnabled } from '@/lib/laya/settings';
import { createLayaClient } from '@/lib/laya/client';
import { beat } from '@/lib/heartbeat';
import { layaExamples } from '@/lib/db/schema';

export type FormState = { ok?: string; error?: string };

export async function saveLayaAction(_prev: FormState, form: FormData): Promise<FormState> {
  if (!(await guard('admin'))) return { error: DENIED };
  const s = parseLayaForm(form);
  if ('error' in s) return { error: s.error };
  setSetting(getDb(), 'laya', s);
  revalidatePath('/settings/ai');
  return { ok: 'Сохранено' };
}

/** «Проверить»: здоровье laya-serve и один вопрос — сколько отвечает. */
export async function checkLayaAction(): Promise<FormState> {
  if (!(await guard('admin'))) return { error: DENIED };
  if (!layaEnabled(getDb())) return { error: 'Laya выключена' };
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

export async function deleteExampleAction(form: FormData) {
  if (!(await guard('admin'))) return;
  const id = Number(form.get('id'));
  if (Number.isInteger(id)) getDb().delete(layaExamples).where(eq(layaExamples.id, id)).run();
  revalidatePath('/settings/ai/examples');
}

/**
 * Главный выключатель: выключена — супервизор останавливает laya-serve (память и процессор NAS свободны), решают правила;
 * включена — laya-serve запускается снова (в течение ~5 с), модель загружается с диска.
 */
export async function setLayaOnAction(_prev: FormState, form: FormData): Promise<FormState> {
  if (!(await guard('admin'))) return { error: DENIED };
  const on = form.get('on') === 'on';
  const db = getDb();
  setLayaEnabled(db, on);
  // статус на экране — сразу, не дожидаясь опроса воркера
  beat(db, 'laya', on, JSON.stringify({ status: on ? 'loading' : 'disabled' }));
  revalidatePath('/settings/ai');
  revalidatePath('/', 'layout');
  return { ok: on ? 'Laya запускается — модель загрузится за минуту-две' : 'Laya выключена и выгружена из памяти' };
}
