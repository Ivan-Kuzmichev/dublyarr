'use client';

import { useActionState } from 'react';
import { Card, CardTitle } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { savePathsAction, type FormState } from './actions';

type Props = { qbitDownloads: string; downloads: string; media: string; template: string; example: string; defaultTemplate: string };

export function PathsCard(p: Props) {
  const [state, action, pending] = useActionState<FormState, FormData>(savePathsAction, {});
  const v = state.values;
  return (
    <Card className="flex flex-col gap-4">
      <CardTitle>Папки</CardTitle>
      <form action={action} className="flex flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Папка загрузок в qBittorrent"
            name="qbitDownloads"
            mono
            defaultValue={v?.qbitDownloads ?? p.qbitDownloads}
            placeholder="/downloads"
            hint="Как её видит qBittorrent (его путь сохранения)"
          />
          <Field label="Та же папка в Dublyarr" name="downloads" mono required defaultValue={v?.downloads ?? p.downloads} placeholder="/storage/downloads" hint="Как её видит контейнер Dublyarr" />
        </div>
        <Field label="Медиатека" name="media" mono required defaultValue={v?.media ?? p.media} placeholder="/storage/media" hint="Здесь будут серии для VidHub" />
        <Field label="Имя файла" name="template" mono defaultValue={v?.template ?? p.template} placeholder={p.defaultTemplate} hint={`→ ${p.example}`} />
        <p className="m-0 text-[13px] leading-normal text-faint">
          Чтобы файлы попадали в медиатеку мгновенно и без лишнего места (жёсткой ссылкой), загрузки и медиатека должны лежать на одном томе — например, смонтируйте общую папку
          целиком. Иначе Dublyarr будет копировать.
        </p>
        {state.error && (
          <p role="alert" className="m-0 text-sm text-danger">
            {state.error}
          </p>
        )}
        {state.ok && <p className="m-0 text-sm text-progress">{state.ok}</p>}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" name="intent" value="save" disabled={pending}>
            Сохранить
          </Button>
          <Button type="submit" name="intent" value="check" variant="secondary" disabled={pending}>
            Проверить
          </Button>
        </div>
      </form>
    </Card>
  );
}
