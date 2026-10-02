'use client';

import { useEffect, useState } from 'react';
import type { Found } from '@/app/(app)/_found/found-action';
import { foundAction } from '@/app/(app)/_found/found-action';

const EVERY_MS = 3000;
const MAX_POLLS = 40; // ~2 мин: дольше поиск не держим окно в ожидании

/** Найденное на трекерах для окна подписки: при открытии и раз в 3 с, пока идёт поиск. */
export function useFound(tmdbId: number | undefined, type: 'tv' | 'movie'): Found | null {
  const [found, setFound] = useState<Found | null>(null);
  useEffect(() => {
    if (!tmdbId) return;
    let stop = false;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const f = await foundAction(tmdbId, type);
        if (stop) return;
        setFound(f);
        if (f.searching && ++polls < MAX_POLLS) timer = setTimeout(tick, EVERY_MS);
      } catch {
        // нет связи — окно работает и без подсказок
      }
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [tmdbId, type]);
  return found;
}
