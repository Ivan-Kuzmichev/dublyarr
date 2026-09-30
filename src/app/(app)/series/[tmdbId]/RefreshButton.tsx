'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/Button';
import { refreshTitleAction, type RefreshState } from './actions';

export function RefreshButton({ tmdbId }: { tmdbId: number }) {
  const [state, action, pending] = useActionState<RefreshState, FormData>(refreshTitleAction, {});
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
