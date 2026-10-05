'use client';

import { useActionState, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { formatSize } from '@/lib/format';
import type { StoragePart } from '@/lib/storage';
import { deleteSeriesAction, type ActionState } from './actions';

const MODES = [
  { id: 'all', title: 'Удалить файлы и отписаться', sub: 'Пропадёт из библиотеки, дальше ничего не качается', label: 'Удалить всё' },
  { id: 'files', title: 'Только файлы, подписка остаётся', sub: 'Освободит место; удалённое заново не скачается, новые серии — да', label: 'Удалить файлы' },
  { id: 'sub', title: 'Только отписаться, файлы оставить', sub: 'Скачанное останется на диске, дальше ничего не качается', label: 'Отписаться' },
  { id: 'episodes', title: 'Сезоны или серии', sub: 'Выбранное удалится и заново не скачается; подписка остаётся', label: 'Удалить выбранное' },
] as const;
const key = (season: number, number: number) => `${season}:${number}`;

/** Удаление сериала: три варианта; торренты сериала убираются вместе с файлами в папке загрузок. */
export function DeleteSeriesDialog({ tmdbId, title, trigger = 'icon', movie = false, parts }: { tmdbId: number; title: string; trigger?: 'icon' | 'button'; movie?: boolean; parts?: StoragePart[] }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<(typeof MODES)[number]['id']>('all');
  const [state, action, pending] = useActionState<ActionState, FormData>(deleteSeriesAction, {});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [openSeason, setOpenSeason] = useState<number | null>(null);
  const modes = MODES.filter((m) => m.id !== 'episodes' || (!movie && parts?.length));
  const toggle = (keys: string[], on: boolean) =>
    setPicked((p) => {
      const n = new Set(p);
      for (const k of keys) if (on) n.add(k);
      else n.delete(k);
      return n;
    });
  const pickedSize = (parts ?? []).flatMap((p) => p.episodes.filter((e) => picked.has(key(p.season, e.number))).map((e) => e.size)).reduce((a, b) => a + b, 0);
  const id = `del-${movie ? 'm' : 's'}${tmdbId}`;
  return (
    <>
      {trigger === 'icon' ? (
        <button type="button" aria-label={`Удалить «${title}»`} onClick={() => setOpen(true)} className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-faint hover:bg-surface-2 hover:text-danger">
          <Icon d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" size={18} />
        </button>
      ) : (
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          Удалить…
        </Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} labelledBy={id} width={520}>
        <form action={action} className="flex flex-col gap-5 p-6">
          <input type="hidden" name="tmdbId" value={tmdbId} />
          <input type="hidden" name="mode" value={mode} />
          <input type="hidden" name="type" value={movie ? 'movie' : 'tv'} />
          <h2 id={id} className="m-0 text-xl font-semibold">
            Удалить «{title}»?
          </h2>
          <div role="radiogroup" aria-label="Что удалить" className="flex flex-col gap-2.5">
            {modes.map((m) => (
              <label key={m.id} className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${mode === m.id ? 'border-destructive bg-surface-2' : 'border-line'}`}>
                <input type="radio" name="pick" checked={mode === m.id} onChange={() => setMode(m.id)} className="mt-0.5 h-[18px] w-[18px] accent-[var(--color-destructive)]" />
                <span className="flex flex-col gap-1">
                  <span className="text-[15px] font-medium">{m.title}</span>
                  <span className="text-[13px] text-faint">{m.sub}</span>
                </span>
              </label>
            ))}
          </div>
          {mode === 'episodes' && parts && (
            <div className="flex max-h-[320px] flex-col gap-1 overflow-y-auto rounded-xl border border-line p-2">
              {[...picked].map((k) => (
                <input key={k} type="hidden" name="ep" value={k} />
              ))}
              {parts.map((p) => {
                const keys = p.episodes.map((e) => key(p.season, e.number));
                const all = keys.every((k) => picked.has(k));
                const some = !all && keys.some((k) => picked.has(k));
                return (
                  <div key={p.season} className="flex flex-col">
                    <div className="flex min-h-11 items-center gap-3 px-2">
                      <input
                        type="checkbox"
                        aria-label={`Сезон ${p.season}`}
                        checked={all}
                        ref={(el) => {
                          if (el) el.indeterminate = some;
                        }}
                        onChange={(e) => toggle(keys, e.target.checked)}
                        className="h-[18px] w-[18px] accent-[var(--color-destructive)]"
                      />
                      <button type="button" onClick={() => setOpenSeason(openSeason === p.season ? null : p.season)} className="flex grow cursor-pointer items-baseline justify-between gap-3 text-left">
                        <span className="text-[15px]">
                          Сезон {p.season} <span className="text-[13px] text-faint">· серий: {p.episodes.length}</span>
                        </span>
                        <span className="font-mono text-[13px] text-muted">{formatSize(p.size)} {openSeason === p.season ? '▴' : '▾'}</span>
                      </button>
                    </div>
                    {openSeason === p.season &&
                      p.episodes.map((e) => (
                        <label key={e.number} className="flex min-h-10 cursor-pointer items-center gap-3 pr-2 pl-9 text-sm text-text-2">
                          <input type="checkbox" checked={picked.has(key(p.season, e.number))} onChange={(ev) => toggle([key(p.season, e.number)], ev.target.checked)} className="h-[18px] w-[18px] accent-[var(--color-destructive)]" />
                          <span className="grow">Серия {e.number}</span>
                          <span className="font-mono text-[13px] text-faint">{formatSize(e.size)}</span>
                        </label>
                      ))}
                  </div>
                );
              })}
            </div>
          )}
          {mode === 'episodes' && <p className="m-0 text-[13px] text-faint">{picked.size ? `Выбрано серий: ${picked.size} · ${formatSize(pickedSize)}. Если серия ещё раздаётся, место освободится после окончания раздачи.` : 'Отметьте сезон целиком или раскройте его и выберите серии.'}</p>}
          {mode !== 'sub' && mode !== 'episodes' && <p className="m-0 text-[13px] text-faint">Торренты сериала уберутся из qBittorrent вместе с их файлами в папке загрузок.</p>}
          {state.error && (
            <p role="alert" className="m-0 text-sm text-danger">
              {state.error}
            </p>
          )}
          {state.ok && <p className="m-0 text-sm text-progress">{state.ok}</p>}
          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {state.ok ? 'Закрыть' : 'Отмена'}
            </Button>
            {!state.ok && (
              <Button type="submit" variant="destructive" disabled={pending || (mode === 'episodes' && !picked.size)}>
                {MODES.find((m) => m.id === mode)!.label}
              </Button>
            )}
          </div>
        </form>
      </Modal>
    </>
  );
}
