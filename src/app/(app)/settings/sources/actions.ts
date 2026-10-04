'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { DENIED, guard } from '@/lib/auth/current';
import { checkAndSaveTmdb, type TmdbFormState } from '@/lib/tmdb/form';

export async function saveTmdbAction(_prev: TmdbFormState, form: FormData): Promise<TmdbFormState> {
  if (!(await guard('admin'))) return { error: DENIED };
  const r = await checkAndSaveTmdb(getDb(), form);
  if (r.ok && form.get('intent') !== 'check') revalidatePath('/settings/sources');
  return r;
}
