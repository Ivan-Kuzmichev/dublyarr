'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { requireSession } from '@/lib/auth/current';
import { getSetting } from '@/lib/settings';
import { confirmOldCopies } from '@/lib/old-copies';
import type { Paths } from '@/lib/downloads';

export type ConfirmState = { error?: string };

/** «Удалить отмеченные»: удаляет выбранные старые копии и включает правило «удалять сразу». */
export async function confirmAction(_prev: ConfirmState, form: FormData): Promise<ConfirmState> {
  await requireSession();
  const db = getDb();
  const paths = getSetting<Paths>(db, 'paths');
  if (!paths) return { error: 'Не настроены папки' };
  const ids = form
    .getAll('id')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  const r = await confirmOldCopies(db, paths.media, ids);
  revalidatePath('/');
  revalidatePath('/old-copies');
  if (r.refused) return { error: `Не удалено ${r.refused}: путь вне папки старых копий` };
  redirect('/');
}
