'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { DENIED, guard } from '@/lib/auth/current';
import { getSetting } from '@/lib/settings';
import { getQbit } from '@/lib/qbit';
import { getCleanup, runCleanup } from '@/lib/cleanup';
import type { Paths } from '@/lib/downloads';

export type ConfirmState = { error?: string };

/** «Удалить отмеченные»: выполнить выбранное и включить затронутые правила уборки. */
export async function confirmCleanupAction(_prev: ConfirmState, form: FormData): Promise<ConfirmState> {
  if (!(await guard('storage'))) return { error: DENIED };
  const db = getDb();
  const qbit = getQbit(db);
  const paths = getSetting<Paths>(db, 'paths');
  if (!qbit || !paths) return { error: 'qBittorrent или папки не настроены' };
  const keys = form
    .getAll('key')
    .map(String)
    .filter((k) => /^(t:\d+|o:.+)$/.test(k));
  if (!keys.length) return { error: 'Ничего не отмечено' };
  try {
    await runCleanup(db, qbit, paths, getCleanup(db), Date.now(), { confirmKeys: keys });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath('/');
  redirect('/');
}
