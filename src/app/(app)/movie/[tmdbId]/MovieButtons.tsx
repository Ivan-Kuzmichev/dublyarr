'use client';

import { useActionState, useCallback, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { MovieSubscribeDialog } from '@/components/subscribe/MovieSubscribeDialog';
import type { MovieProfile } from '@/lib/movie-profile';
import { useFound } from '@/components/subscribe/useFound';
import { refreshMovieAction, saveMovieSubscriptionAction, type RefreshState } from './actions';

export function MovieSubscribeButton({ tmdbId, subscribed, title, subtitle, profile }: { tmdbId: number; subscribed: boolean; title: string; subtitle: string; profile: MovieProfile }) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button
        variant={subscribed ? 'secondary' : 'primary'}
        onClick={() => {
          setSession((n) => n + 1);
          setOpen(true);
        }}
      >
        {subscribed ? 'Подписка' : 'Подписаться'}
      </Button>
      {open && <MovieDialog key={session} tmdbId={tmdbId} subscribed={subscribed} title={title} subtitle={subtitle} profile={profile} onClose={close} />}
    </>
  );
}

/** Окно с подсказкой «какие переводы нашлись на трекерах». */
function MovieDialog({ tmdbId, subscribed, title, subtitle, profile, onClose }: { tmdbId: number; subscribed: boolean; title: string; subtitle: string; profile: MovieProfile; onClose: () => void }) {
  const found = useFound(tmdbId, 'movie');
  return (
    <MovieSubscribeDialog
      onClose={onClose}
      mode={subscribed ? 'edit' : 'subscribe'}
      title={title}
      subtitle={subtitle}
      initial={profile}
      hidden={{ tmdbId: String(tmdbId) }}
      action={saveMovieSubscriptionAction}
      found={found}
    />
  );
}

export function MovieRefreshButton({ tmdbId }: { tmdbId: number }) {
  const [state, action, pending] = useActionState<RefreshState, FormData>(refreshMovieAction, {});
  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="tmdbId" value={tmdbId} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? 'Обновляю…' : 'Обновить из TMDB'}
      </Button>
      {state.error && (
        <span role="alert" className="text-sm text-danger">
          {state.error}
        </span>
      )}
    </form>
  );
}
