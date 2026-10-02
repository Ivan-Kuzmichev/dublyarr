'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { titleSearchAction } from '@/app/(app)/_found/found-action';

const EVERY_MS = 3000;

/** Раздачи показаны из последнего поиска; свежий поиск идёт фоном — когда закончится, страница обновится сама. */
export function SearchRefresh({ tmdbId, type, pending: initial, searchedAt }: { tmdbId: number; type: 'tv' | 'movie'; pending: boolean; searchedAt: number | null }) {
  const router = useRouter();
  const [pending, setPending] = useState(initial); // новое состояние с сервера — новый key у компонента
  const [shownAt] = useState(() => Date.now());
  useEffect(() => {
    if (!pending) return;
    let stop = false;
    const t = setInterval(async () => {
      const r = await titleSearchAction(tmdbId, type).catch(() => ({ pending: true }));
      if (stop || r.pending) return;
      setPending(false);
      router.refresh();
    }, EVERY_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [pending, tmdbId, type, router]);
  const ago = searchedAt ? Math.max(0, Math.round((shownAt - searchedAt) / 60_000)) : null;
  return (
    <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted">
      <span>
        {pending ? 'Опрашиваем источники… результаты обновятся сами' : ago === null ? 'Ещё не искали' : ago < 1 ? 'Источники опрошены только что' : `Источники опрошены ${ago} мин назад`}
      </span>
      {!pending && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={async () => {
            setPending(true);
            await titleSearchAction(tmdbId, type, true).catch(() => undefined);
          }}
        >
          Обновить
        </Button>
      )}
    </div>
  );
}
