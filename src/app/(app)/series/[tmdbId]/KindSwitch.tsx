'use client';

import { useTransition } from 'react';
import { Segmented } from '@/components/ui/Segmented';
import { setKindAction } from './actions';

export function KindSwitch({ tmdbId, kind }: { tmdbId: number; kind: 'series' | 'anime' }) {
  const [, start] = useTransition();
  return (
    <Segmented
      name="kind"
      aria-label="Тип"
      defaultValue={kind}
      options={[
        { value: 'series', label: 'Сериал' },
        { value: 'anime', label: 'Аниме' },
      ]}
      onChange={(v) => start(() => setKindAction(tmdbId, v))}
    />
  );
}
