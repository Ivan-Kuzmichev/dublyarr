'use client';

import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import { CodeInput } from '@/components/ui/CodeInput';
import { Checkbox } from '@/components/ui/Checkbox';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/shell/AuthFrame';
import { codeAction, type FormState } from '../actions';

function NextCodeTimer() {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setLeft(30 - (Math.floor(Date.now() / 1000) % 30));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="text-faint">{left === null ? '' : `новый код через ${left} с`}</span>;
}

export function CodeForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(codeAction, {});
  const form = useRef<HTMLFormElement>(null);
  const submit = useCallback(() => form.current?.requestSubmit(), []);
  return (
    <form ref={form} action={action} className="flex flex-col gap-[22px]">
      <input type="hidden" name="next" value={next} />
      <CodeInput name="code" autoFocus onComplete={submit} />
      <Checkbox label="Не спрашивать на этом устройстве 30 дней" name="trust" />
      <FormError message={state.error} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Проверяем…' : 'Подтвердить'}
      </Button>
      <div className="flex justify-end text-sm">
        <NextCodeTimer />
      </div>
    </form>
  );
}
