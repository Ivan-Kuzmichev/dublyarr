'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import type { MediaScanState } from '@/lib/media-scan/state';
import { mediaScanStateAction, startMediaScanAction } from './actions';
import { MediaScanDialog } from './MediaScanDialog';

const ago = (ms: number) => {
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} ч назад` : new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
};

/** «Медиатека» в «Хранилище»: найти, что лежит в медиатеке мимо Dublyarr, и взять это в Dublyarr (2.7). */
export function MediaScanCard({ initial, canSubscribe }: { initial: MediaScanState; canSubscribe: boolean }) {
  const [state, setState] = useState(initial);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = state.status !== 'idle';

  // пока идёт задача — опрос раз в 2 с; закончилось сканирование — сразу окно
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(async () => {
      const s = await mediaScanStateAction();
      if (!s) return;
      if (state.status === 'scanning' && s.status === 'idle' && s.items.length) setOpen(true);
      setState(s);
    }, 2000);
    return () => clearInterval(t);
  }, [busy, state.status]);

  const scan = async () => {
    setError(null);
    const r = await startMediaScanAction();
    if (r.error) setError(r.error);
    else setState((s) => ({ ...s, status: 'scanning', progress: { done: 0, total: 0 } }));
  };

  const last = state.last;
  const added = last?.lines.reduce((n, l) => n + l.added, 0) ?? 0;
  const skipped = last?.lines.flatMap((l) => l.skipped.map((s) => `${l.title}: ${s.why}`)) ?? [];
  const errors = last?.lines.filter((l) => l.error).map((l) => `${l.title}: ${l.error}`) ?? [];
  const left = last?.lines.filter((l) => l.left > 0).map((l) => `В «${l.key}» осталось файлов: ${l.left}`) ?? [];

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-lg font-semibold">Медиатека</h2>
        {!busy && state.items.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            Открыть
          </Button>
        )}
      </div>
      <span className="text-[13px] text-muted">Найти сериалы и фильмы, которые лежат в медиатеке мимо Dublyarr, и разложить их по папкам Dublyarr.</span>
      {state.status === 'scanning' && <span className="text-sm text-progress">Сканирую…{state.progress?.total ? ` ${state.progress.done} из ${state.progress.total}` : ''}</span>}
      {state.status === 'adopting' && <span className="text-sm text-progress">Добавляю… {state.progress ? `${state.progress.done} из ${state.progress.total}` : ''}</span>}
      {!busy && state.scannedAt && (
        <span className="text-sm text-text-2">
          Найдено {state.items.length}
          {state.skipped.length ? ` · не распознано ${state.skipped.length}` : ''} · {ago(state.scannedAt)}
        </span>
      )}
      {!busy && last && (
        <details className="text-sm">
          <summary className="cursor-pointer text-text-2">
            Добавлено {added}
            {skipped.length ? ` · пропущено ${skipped.length}` : ''}
            {errors.length ? ` · ошибка ${errors.length}` : ''}
          </summary>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-[13px] text-faint">
            {[...errors, ...skipped, ...left].map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </details>
      )}
      {error && (
        <p role="alert" className="m-0 text-sm text-danger">
          {error}
        </p>
      )}
      <div>
        <Button variant="secondary" onClick={scan} disabled={busy}>
          Сканировать
        </Button>
      </div>
      {open && (
        <MediaScanDialog
          state={state}
          canSubscribe={canSubscribe}
          onClose={() => setOpen(false)}
          onStarted={(s) => {
            setOpen(false);
            setState(s);
          }}
        />
      )}
    </Card>
  );
}
