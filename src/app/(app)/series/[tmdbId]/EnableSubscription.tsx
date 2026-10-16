'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/Button';
import { enableSubscriptionAction, type RefreshState } from './actions';

/** Сериал взят из медиатеки «только файлы»: включить обычную подписку — Dublyarr начнёт искать и качать (2.7). */
export function EnableSubscription({ tmdbId, movie = false }: { tmdbId: number; movie?: boolean }) {
  const [state, action, pending] = useActionState<RefreshState, FormData>(enableSubscriptionAction, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="tmdbId" value={tmdbId} />
      {movie && <input type="hidden" name="type" value="movie" />}
      <Button type="submit" disabled={pending}>
        Включить подписку
      </Button>
      <span className="text-[13px] text-faint">{state.error ?? 'Сейчас — только файлы: ничего не качается'}</span>
    </form>
  );
}
