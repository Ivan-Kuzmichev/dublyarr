'use client';

import { useActionState } from 'react';
import { downloadAction, type DownloadState } from './actions';

export function DownloadButton({ tmdbId, releaseId, season, episode, movie = false }: { tmdbId: number; releaseId: number; season: number; episode?: number; movie?: boolean }) {
  const [state, action, pending] = useActionState<DownloadState, FormData>(downloadAction, {});
  if (state.ok) return <span className="text-[13px] text-progress">{state.ok}</span>;
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="tmdbId" value={tmdbId} />
      <input type="hidden" name="releaseId" value={releaseId} />
      {movie && <input type="hidden" name="type" value="movie" />}
      <input type="hidden" name="season" value={season} />
      {episode !== undefined && <input type="hidden" name="episode" value={episode} />}
      <button type="submit" disabled={pending} className="h-11 cursor-pointer rounded-[10px] bg-accent px-3 text-[13px] font-semibold whitespace-nowrap text-on-accent disabled:opacity-50">
        {pending ? 'Добавляю…' : 'Скачать'}
      </button>
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
