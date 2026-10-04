'use client';

import { useActionState } from 'react';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import type { IntroSettings } from '@/lib/intros/settings';
import { saveIntrosAction, type SaveState } from './actions';

export function IntroForm({ value, available }: { value: IntroSettings; available: boolean }) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveIntrosAction, {});
  return (
    <form action={action}>
      <Card className="flex min-w-0 flex-col gap-4">
        <h3 className="m-0 text-base font-semibold">Заставки и титры</h3>
        <Checkbox name="on" defaultChecked={value.on} label="Размечать главы для пропуска в плеере" />
        <p className="m-0 text-[13px] text-faint">
          Dublyarr находит опенинг и титры по одинаковому звуку серий сезона и вписывает главы — VidHub показывает «Пропустить». Файлы со своими главами не трогаются.
        </p>
        {!available && <p className="m-0 text-[13px] text-danger">Нет ffmpeg с chromaprint или mkvpropedit — разметка не работает.</p>}
        <div className="flex flex-wrap gap-3">
          <Field label="Глава заставки" name="introName" mono defaultValue={value.introName} className="min-w-[160px] grow" />
          <Field label="Глава титров" name="creditsName" mono defaultValue={value.creditsName} className="min-w-[160px] grow" />
        </div>
        {state.error && <p role="alert" className="m-0 text-sm text-danger">{state.error}</p>}
        {state.ok && <p className="m-0 text-sm text-progress">{state.ok}</p>}
        <div>
          <Button type="submit" disabled={pending}>Сохранить</Button>
        </div>
      </Card>
    </form>
  );
}
