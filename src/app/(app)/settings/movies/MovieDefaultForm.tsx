'use client';

import { useActionState, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { MovieProfileEditor } from '@/components/subscribe/MovieProfileEditor';
import type { MovieProfile } from '@/lib/movie-profile';
import { saveMovieDefaultAction, type SaveState } from './actions';

export function MovieDefaultForm({ initial }: { initial: MovieProfile }) {
  const [profile, setProfile] = useState(initial);
  const [state, action, pending] = useActionState<SaveState, FormData>(saveMovieDefaultAction, {});
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="profile" value={JSON.stringify(profile)} />
      <Card className="flex min-w-0 flex-col gap-3">
        <MovieProfileEditor value={profile} onChange={setProfile} />
      </Card>
      {state.error && (
        <p role="alert" className="m-0 text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.ok && <p className="m-0 text-sm text-progress">{state.ok}</p>}
      <div>
        <Button type="submit" disabled={pending}>
          Сохранить
        </Button>
      </div>
    </form>
  );
}
