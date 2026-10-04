'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { DENIED, guard } from '@/lib/auth/current';
import { getTitleByTmdbId } from '@/lib/catalog';
import { listStudios } from '@/lib/studios';
import { parseSubscriptionForm } from '@/lib/subscription-form';
import { subscribe, unsubscribe, updateSubscription, SubscriptionError } from '@/lib/subscriptions';
import type { DialogState } from '@/components/subscribe/SubscribeDialog';

export async function saveSubscriptionAction(_prev: DialogState, form: FormData): Promise<DialogState> {
  const me = await guard('subscribe');
  if (!me) return { error: DENIED };
  const db = getDb();
  const parsed = parseSubscriptionForm(form, new Set(listStudios(db).map((s) => s.id)));
  if ('error' in parsed) return { error: parsed.error };
  const title = getTitleByTmdbId(db, parsed.tmdbId);
  if (!title) return { error: 'Сериал не найден' };
  try {
    if (parsed.intent === 'unsubscribe') unsubscribe(db, title.id);
    else if (parsed.intent === 'subscribe') subscribe(db, title.id, parsed.profile, Date.now(), me.user.id);
    else updateSubscription(db, title.id, parsed.profile);
  } catch (e) {
    if (e instanceof SubscriptionError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/series/${parsed.tmdbId}`);
  revalidatePath('/library');
  return { ok: true };
}
