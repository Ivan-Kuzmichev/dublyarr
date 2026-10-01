'use client';

import { useActionState } from 'react';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Segmented } from '@/components/ui/Segmented';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import type { ProcessingSettings } from '@/lib/media/tracks';
import { saveProcessingAction, type SaveState } from './actions';

const AUDIO = [
  { value: 'dub+original', label: 'Озвучка из подписки + оригинал' },
  { value: 'dub', label: 'Только озвучка из подписки' },
  { value: 'all', label: 'Ничего не удалять' },
] as const;

export function ProcessingForm({ value }: { value: ProcessingSettings }) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveProcessingAction, {});
  return (
    <form action={action} className="flex flex-col gap-5">
      <Card className="flex min-w-0 flex-col gap-3">
        <h3 className="m-0 text-base font-semibold">Звуковые дорожки</h3>
        <div role="radiogroup" aria-label="Звуковые дорожки" className="flex flex-col">
          {AUDIO.map((a) => (
            <label key={a.value} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-text-2">
              <input type="radio" name="audio" value={a.value} defaultChecked={value.audio === a.value} className="h-[18px] w-[18px] accent-accent" />
              {a.label}
            </label>
          ))}
        </div>
        <div className="h-px bg-line-soft" />
        <Checkbox name="keepBackups" defaultChecked={value.keepBackups} label="Оставлять запасные озвучки из профиля" />
        <Checkbox name="external" defaultChecked={value.external} label="Вшивать внешние дорожки (.mka, .srt) из раздачи" />
        <p className="m-0 text-[13px] text-faint">Если озвучку из подписки не удалось узнать ни в одной дорожке, звук не трогается.</p>
      </Card>
      <Card className="flex min-w-0 flex-col gap-4">
        <h3 className="m-0 text-base font-semibold">По умолчанию в плеере</h3>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-text-2">Основная дорожка</span>
          <span className="text-muted">озвучка из подписки</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-text-2">Субтитры включены</span>
          <div className="max-w-full overflow-x-auto">
            <Segmented
              name="defaultSubs"
              defaultValue={value.defaultSubs}
              aria-label="Субтитры включены"
              options={[
                { value: 'none', label: 'нет' },
                { value: 'forced', label: 'форсированные' },
                { value: 'full', label: 'полные' },
              ]}
            />
          </div>
        </div>
        <Field label="Оставлять субтитры (языки)" name="keepSubs" mono defaultValue={value.keepSubs.join(', ')} placeholder="rus, eng" hint="Коды языков через запятую: rus, eng, jpn…" />
        <p className="m-0 text-[13px] text-faint">VidHub сразу включит нужную озвучку и форсированные субтитры к надписям на экране — переключать ничего не придётся.</p>
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
