'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { requireSession } from '@/lib/auth/current';
import { downloads } from '@/lib/db/schema';
import { getQbit } from '@/lib/qbit';
import { enqueue } from '@/worker/jobs';

const idOf = (form: FormData) => {
  const n = Number(form.get('id'));
  return Number.isInteger(n) && n > 0 ? n : null;
};

async function withDownload(form: FormData, fn: (hash: string, id: number) => Promise<Partial<typeof downloads.$inferInsert> | null>) {
  await requireSession();
  const db = getDb();
  const id = idOf(form);
  const d = id ? db.select().from(downloads).where(eq(downloads.id, id)).get() : undefined;
  if (!d) return;
  const set = await fn(d.hash, d.id);
  if (set) db.update(downloads).set(set).where(eq(downloads.id, d.id)).run();
  revalidatePath('/activity');
}

export async function pauseAction(form: FormData) {
  await withDownload(form, async (hash) => {
    await getQbit(getDb())?.stop([hash]);
    return { state: 'paused' };
  });
}

export async function resumeAction(form: FormData) {
  await withDownload(form, async (hash) => {
    await getQbit(getDb())?.start([hash]);
    return { state: 'downloading' };
  });
}

/** Убрать торрент из клиента — файлы остаются на диске. */
export async function removeAction(form: FormData) {
  await withDownload(form, async (hash) => {
    try {
      await getQbit(getDb())?.remove([hash]);
    } catch {
      // нет связи с клиентом — запись всё равно убираем из очереди
    }
    return { state: 'removed' };
  });
}

export async function searchNowAction() {
  await requireSession();
  enqueue(getDb(), 'subscriptions.search');
  revalidatePath('/activity');
}
