'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/Button';
import { trainNowAction, type FormState } from '../actions';

export function TrainNow() {
  const [state, action, pending] = useActionState<FormState, FormData>(trainNowAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button type="submit" variant="secondary" disabled={pending}>
        Обучить сейчас
      </Button>
      {state.ok && <span className="text-sm text-progress">{state.ok}</span>}
    </form>
  );
}
