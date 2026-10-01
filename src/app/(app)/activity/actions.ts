'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { requireSession } from '@/lib/auth/current';
import { controlDownload } from '@/lib/activity';
import { redirect } from 'next/navigation';
import { getQbit } from '@/lib/qbit';
import { enqueue } from '@/worker/jobs';

const idOf = (form: FormData) => {
  const n = Number(form.get('id'));
  return Number.isInteger(n) && n > 0 ? n : null;
};

async function control(form: FormData, action: 'pause' | 'resume' | 'remove') {
  await requireSession();
  const db = getDb();
  const id = idOf(form);
  const r = id ? await controlDownload(db, getQbit(db), id, action) : { error: 'Загрузка не найдена' };
  revalidatePath('/activity');
  if ('error' in r) redirect(`/activity?error=${encodeURIComponent(r.error)}`);
}

export async function pauseAction(form: FormData) {
  await control(form, 'pause');
}

export async function resumeAction(form: FormData) {
  await control(form, 'resume');
}

/** Убрать торрент из клиента — файлы остаются на диске. */
export async function removeAction(form: FormData) {
  await control(form, 'remove');
}

export async function searchNowAction() {
  await requireSession();
  enqueue(getDb(), 'subscriptions.search');
  revalidatePath('/activity');
}
