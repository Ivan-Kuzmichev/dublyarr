'use client';

import { useState } from 'react';
import { Segmented } from '@/components/ui/Segmented';
import { Field, PasswordField } from '@/components/ui/Field';
import { SOURCE_KIND_LABEL, type SourceKind } from '@/lib/source-kinds';

const URL_FIELD: Record<SourceKind, { label: string; placeholder: string; hint: string }> = {
  jackett: { label: 'Адрес Jackett', placeholder: 'http://192.168.1.10:9117', hint: 'Без пути — путь Torznab Dublyarr допишет сам' },
  jacred: { label: 'Адрес JacRed', placeholder: 'https://jac.red', hint: 'jac.red или своя установка' },
  torznab: { label: 'Адрес Torznab', placeholder: 'http://prowlarr:9696/1/api', hint: 'Полный адрес: Prowlarr и другие' },
};

/** Тип источника и поля под него: общие для настроек и первого запуска. */
export function SourceFields(p: { kind?: SourceKind; name?: string; url?: string; saved?: boolean; nameError?: string; urlError?: string }) {
  const [kind, setKind] = useState<SourceKind>(p.kind ?? 'jackett');
  const f = URL_FIELD[kind];
  return (
    <>
      <Segmented<SourceKind>
        name="kind"
        aria-label="Тип источника"
        defaultValue={kind}
        onChange={setKind}
        options={(['jackett', 'jacred', 'torznab'] as const).map((k) => ({ value: k, label: SOURCE_KIND_LABEL[k] }))}
      />
      <Field label="Название" name="name" defaultValue={p.name} placeholder={SOURCE_KIND_LABEL[kind]} error={p.nameError} />
      <Field key={kind} label={f.label} name="url" mono inputMode="url" required defaultValue={p.url} placeholder={f.placeholder} hint={f.hint} error={p.urlError} />
      <PasswordField
        label={kind === 'jacred' ? 'Ключ (необязательно)' : 'API-ключ'}
        name="apiKey"
        autoComplete="off"
        placeholder={p.saved ? 'сохранён — оставьте пустым' : ''}
        hint={kind === 'jacred' ? 'Только для своей установки с ключом' : 'Хранится в базе зашифрованным'}
      />
    </>
  );
}
