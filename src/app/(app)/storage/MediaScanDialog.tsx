'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { formatSize } from '@/lib/format';
import { Poster } from '@/components/catalog/Poster';
import type { AdoptPick, MediaScanState, ScanEntry } from '@/lib/media-scan/state';
import type { Candidate } from '@/lib/media-scan/recognize';
import { adoptMediaAction, searchCandidatesAction } from './actions';

type Pick = { on: boolean; candidate: Candidate | null; filesOnly: boolean; process: boolean };
const KIND = { series: 'сериал', movie: 'фильм' } as const;

/** Сезоны и серии позиции коротко: «Season 03: 1–10». */
function seasonsLine(e: ScanEntry) {
  if (e.kind === 'movie') return null;
  const by = new Map<number, number[]>();
  for (const x of e.episodes) by.set(x.season, [...(by.get(x.season) ?? []), x.number]);
  return [...by]
    .map(([s, ns]) => {
      const sorted = ns.sort((a, b) => a - b);
      const runs: string[] = [];
      for (let i = 0; i < sorted.length; ) {
        let j = i;
        while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
        runs.push(i === j ? `${sorted[i]}` : `${sorted[i]}–${sorted[j]}`);
        i = j + 1;
      }
      return `Season ${String(s).padStart(2, '0')}: ${runs.join(', ')}`;
    })
    .join(' · ');
}
const code = (s: number, n: number) => `S${String(s).padStart(2, '0')}E${String(n).padStart(2, '0')}`;

function Row({ e, pick, set, canSubscribe }: { e: ScanEntry; pick: Pick; set: (p: Partial<Pick>) => void; canSubscribe: boolean }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Candidate[] | null>(null);
  const c = pick.candidate;
  const search = async () => setFound(await searchCandidatesAction(q || e.names[0], e.kind === 'movie' ? 'movie' : 'tv'));
  return (
    <div className="flex gap-3 border-t border-line-soft pt-3">
      <input type="checkbox" aria-label={`Добавить ${e.key}`} checked={pick.on} disabled={!c} onChange={(ev) => set({ on: ev.target.checked })} className="mt-1 h-[18px] w-[18px] shrink-0 accent-accent" />
      {c ? <Poster tmdbId={c.tmdbId} name={c.name} path={c.posterPath} size="w185" className="h-[72px] w-12 shrink-0 overflow-hidden rounded-md" /> : <span className="h-[72px] w-12 shrink-0 rounded-md bg-surface-2" />}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-[15px] font-semibold">
          {c ? `${c.name}${c.year ? ` · ${c.year}` : ''}` : 'Не нашлось в TMDB'} <span className="text-[13px] font-normal text-faint">· {KIND[e.kind]}</span>
          {c && !e.sure && pick.candidate === e.candidate && <span className="ml-2 text-[13px] font-normal text-accent">не уверен</span>}
        </span>
        <span className="truncate font-mono text-xs text-muted">
          {e.key} · {e.episodes.length} {e.kind === 'movie' ? 'файл' : 'сер.'} · {formatSize(e.size)}
        </span>
        {seasonsLine(e) && <span className="text-[13px] text-text-2">{seasonsLine(e)}</span>}
        {e.have.length > 0 && <span className="text-[13px] text-faint">Уже есть в Dublyarr — не добавляются: {e.have.join(', ')}</span>}
        {e.unknown.length > 0 && <span className="text-[13px] text-faint">Не возьмём: {e.unknown.map((u) => `${u.rel.split('/').pop()} — ${u.why}`).join('; ')}</span>}
        {e.example && pick.candidate === e.candidate && <span className="truncate font-mono text-xs text-faint">→ {e.example}</span>}
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          {e.kind === 'series' && (
            <span className="flex gap-1 rounded-[10px] bg-surface-2 p-1">
              {(canSubscribe ? [false, true] : [true]).map((fo) => (
                <button key={String(fo)} type="button" onClick={() => set({ filesOnly: fo })} className={`h-9 cursor-pointer rounded-[7px] px-3 ${pick.filesOnly === fo ? 'bg-text font-semibold text-bg' : 'text-muted'}`}>
                  {fo ? 'Только файлы' : 'С подпиской'}
                </button>
              ))}
            </span>
          )}
          <label className="flex min-h-9 cursor-pointer items-center gap-2 text-text-2">
            <input type="checkbox" checked={pick.process} onChange={(ev) => set({ process: ev.target.checked })} className="h-4 w-4 accent-accent" />
            Пересобрать как при импорте
          </label>
          <button type="button" onClick={() => setFound(found ? null : [])} className="h-9 cursor-pointer text-muted hover:text-text">
            Это не он
          </button>
        </div>
        {found && (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder={e.names[0]} aria-label="Поиск в TMDB" className="h-10 min-w-0 flex-1 rounded-[10px] border border-field-line bg-bg px-3 text-sm text-text" />
              <Button variant="secondary" size="sm" onClick={search}>
                Найти
              </Button>
            </div>
            {found.map((f) => (
              <button key={`${f.type}:${f.tmdbId}`} type="button" onClick={() => (set({ candidate: f, on: true }), setFound(null))} className="cursor-pointer rounded-lg px-2 py-1.5 text-left text-sm text-text-2 hover:bg-surface-2">
                {f.name}
                {f.year ? ` · ${f.year}` : ''} <span className="text-faint">· {f.original}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Окно «Найдено в медиатеке»: что взять в Dublyarr и как (2.7). */
export function MediaScanDialog({ state, canSubscribe, onClose, onStarted }: { state: MediaScanState; canSubscribe: boolean; onClose: () => void; onStarted: (s: MediaScanState) => void }) {
  const [picks, setPicks] = useState<Record<string, Pick>>(() =>
    Object.fromEntries(state.items.map((e) => [e.key, { on: !!e.candidate && e.sure, candidate: e.candidate, filesOnly: true, process: false }])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const recognized = state.items.filter((e) => e.candidate);
  const unrecognized = state.items.filter((e) => !e.candidate);
  const chosen = recognized.filter((e) => picks[e.key]?.on && picks[e.key]?.candidate);
  const total = chosen.reduce((n, e) => n + e.episodes.filter((x) => !e.have.includes(code(x.season, x.number))).reduce((m, x) => m + x.size, 0), 0);
  const anyProcess = chosen.some((e) => picks[e.key].process);

  const add = async () => {
    setPending(true);
    setError(null);
    const list: AdoptPick[] = chosen.map((e) => {
      const p = picks[e.key];
      return { key: e.key, tmdbId: p.candidate!.tmdbId, type: p.candidate!.type, filesOnly: e.kind === 'movie' ? false : p.filesOnly, process: p.process, episodes: e.episodes.filter((x) => !e.have.includes(code(x.season, x.number))).map((x) => x.rel) };
    });
    const r = await adoptMediaAction(list);
    setPending(false);
    if (r.error) return setError(r.error);
    onStarted({ ...state, status: 'adopting', progress: { done: 0, total: list.length } });
  };

  return (
    <Modal open onClose={onClose} labelledBy="media-scan-title" width={880}>
      <div className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <h2 id="media-scan-title" className="m-0 text-xl font-semibold">
            Найдено в медиатеке
          </h2>
          <span className="text-sm text-muted">Отмеченное Dublyarr возьмёт к себе и разложит по своим папкам. Файлы, которые раздаются в qBittorrent, станут жёсткими ссылками — раздача не сломается.</span>
        </div>
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
          {recognized.map((e) => (
            <Row key={e.key} e={e} pick={picks[e.key]} set={(p) => setPicks((s) => ({ ...s, [e.key]: { ...s[e.key], ...p } }))} canSubscribe={canSubscribe} />
          ))}
          {(unrecognized.length > 0 || state.skipped.length > 0) && (
            <div className="flex flex-col gap-1 border-t border-line-soft pt-3">
              <span className="text-sm font-semibold text-text-2">Не распознано</span>
              {unrecognized.map((e) => (
                <Row key={e.key} e={e} pick={picks[e.key]} set={(p) => setPicks((s) => ({ ...s, [e.key]: { ...s[e.key], ...p } }))} canSubscribe={canSubscribe} />
              ))}
              {state.skipped.map((s) => (
                <span key={s.key} className="font-mono text-xs text-faint">
                  {s.key} — {s.why}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <span className="text-sm text-text-2">
            Добавить {chosen.length} · {formatSize(total)}
            {anyProcess && <span className="block text-[13px] text-faint">Оригиналы после пересборки удаляются (кроме раздающихся)</span>}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Отмена
            </Button>
            <Button onClick={add} disabled={pending || !chosen.length}>
              Добавить
            </Button>
          </div>
        </div>
        {error && (
          <p role="alert" className="m-0 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
