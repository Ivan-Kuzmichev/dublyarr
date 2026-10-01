'use client';

import { useState } from 'react';
import { Checkbox } from '@/components/ui/Checkbox';
import { Stepper } from '@/components/ui/Stepper';
import { dubKey, setWait, toggleDub, type DubPosition, type Profile } from '@/lib/profile-core';

export type StudioOption = { id: number; name: string };

type Props = { studios: StudioOption[]; names: Record<number, string>; value: Profile; onChange: (p: Profile) => void };

const H = ({ children, note }: { children: React.ReactNode; note?: string }) => (
  <div className="flex items-baseline justify-between gap-3">
    <h3 className="m-0 text-base font-semibold">{children}</h3>
    {note && <span className="text-[13px] text-faint">{note}</span>}
  </div>
);

function Choice<T extends string | number>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 self-start rounded-[10px] bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`h-9 cursor-pointer rounded-[7px] px-3 text-[13px] ${o.value === value ? 'bg-text font-semibold text-bg' : 'text-muted hover:text-text-2'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

type Item = { key: string; label: string; pos: DubPosition };

/** Редактор профиля: окно подписки и профили по умолчанию. */
export function ProfileEditor({ studios, names, value: p, onChange }: Props) {
  const [filter, setFilter] = useState('');
  const set = (patch: Partial<Profile>) => onChange({ ...p, ...patch });

  const keyOf = dubKey;
  const all: Item[] = [
    ...studios.map((s) => ({ key: `s${s.id}`, label: s.name, pos: { kind: 'studio' as const, studioId: s.id, waitDays: 2 } })),
    { key: 'any', label: 'Любая', pos: { kind: 'any', waitDays: 5 } },
    { key: 'original', label: 'Оригинал с субтитрами', pos: { kind: 'original', waitDays: 0 } },
  ];
  const selectedKeys = p.dubs.map(keyOf);
  const labelOf = (d: DubPosition) => (d.kind === 'studio' ? (names[d.studioId] ?? 'Студия удалена') : d.kind === 'any' ? 'Любая' : 'Оригинал с субтитрами');
  const q = filter.trim().toLowerCase();
  const rest = all.filter((i) => !selectedKeys.includes(i.key) && (!q || i.label.toLowerCase().includes(q)));

  const toggle = (item: Item) => set({ dubs: toggleDub(p.dubs, item.pos) });

  const row = 'flex min-h-12 items-center gap-3 rounded-[12px] border px-3';
  const q2 = p.quality;
  const scope = p.scope;

  return (
    <div className="flex flex-col gap-7">
      <section className="flex flex-col gap-3">
        <H note="нажми, чтобы задать порядок">Озвучки</H>
        <div className="flex flex-col gap-2">
          {p.dubs.map((d, i) => (
            <div key={keyOf(d)} className={`${row} border-accent bg-surface-2`}>
              <button type="button" onClick={() => toggle({ key: keyOf(d), label: labelOf(d), pos: d })} className="flex min-h-11 grow cursor-pointer items-center gap-3 text-left">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-xs font-semibold text-on-accent">{i + 1}</span>
                <span className="text-[15px] font-medium">{labelOf(d)}</span>
              </button>
              {i === 0 ? (
                <span className="text-[13px] text-faint">в день эфира</span>
              ) : (
                <span className="flex items-center gap-2 text-[13px] text-muted">
                  через
                  <Stepper
                    label={`Через сколько дней после эфира брать «${labelOf(d)}»`}
                    value={d.waitDays}
                    min={p.dubs[i - 1].waitDays}
                    max={60}
                    suffix=" дн"
                    onChange={(v) => set({ dubs: setWait(p.dubs, i, v) })}
                  />
                </span>
              )}
            </div>
          ))}
        </div>
        {all.length > 10 && (
          <input
            type="search"
            aria-label="Найти студию"
            placeholder="Найти студию"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-11 rounded-[10px] border border-field-line bg-bg px-3 text-sm text-text outline-none placeholder:text-dim focus:border-accent"
          />
        )}
        <div className="flex max-h-[260px] flex-wrap gap-2 overflow-y-auto">
          {rest.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => toggle(item)}
              className="h-11 cursor-pointer rounded-[10px] border border-line px-3 text-sm text-text-2 hover:border-line-strong hover:text-text"
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <H>Качество</H>
        <Choice
          label="Качество"
          value={q2.target}
          onChange={(target) => set({ quality: { ...q2, target } })}
          options={[
            { value: 720, label: '720p' },
            { value: 1080, label: '1080p' },
            { value: 2160, label: '2160p' },
          ]}
        />
        <Checkbox
          label={`Если ${q2.target}p нет — брать ниже`}
          checked={q2.allowLower}
          onChange={(e) => set({ quality: { ...q2, allowLower: e.target.checked } })}
        />
        <Checkbox label="Предпочитать HDR / Dolby Vision" checked={q2.preferHdr} onChange={(e) => set({ quality: { ...q2, preferHdr: e.target.checked } })} />
        <div className="flex flex-wrap items-center gap-3">
          <Checkbox
            label="Не больше"
            checked={q2.maxSizeGb !== null}
            onChange={(e) => set({ quality: { ...q2, maxSizeGb: e.target.checked ? 4 : null } })}
          />
          {q2.maxSizeGb !== null && (
            <span className="flex items-center gap-2 text-sm text-text-2">
              <input
                type="number"
                aria-label="Лимит размера, ГБ"
                min={0.5}
                max={200}
                step={0.5}
                value={q2.maxSizeGb}
                onChange={(e) => set({ quality: { ...q2, maxSizeGb: Number(e.target.value) } })}
                className="h-11 w-20 rounded-[10px] border border-field-line bg-bg px-2 text-center font-mono text-sm text-text outline-none focus:border-accent"
              />
              ГБ на серию
            </span>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <H>Что скачать</H>
        <div role="radiogroup" aria-label="Что скачать" className="flex flex-col gap-1">
          {(
            [
              ['all', 'Все сезоны'],
              ['new', 'Только новые серии'],
              ['from', 'Начиная с серии'],
            ] as const
          ).map(([mode, label]) => (
            <label key={mode} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-text-2">
              <input
                type="radio"
                name="scope-mode"
                checked={scope.mode === mode}
                onChange={() => set({ scope: mode === 'from' ? { mode, season: 1, episode: 1, until: 'onward' } : { mode } })}
                className="h-[18px] w-[18px] accent-accent"
              />
              {label}
            </label>
          ))}
        </div>
        {scope.mode === 'from' && (
          <div className="flex flex-wrap items-center gap-4 pl-7">
            <span className="flex items-center gap-2 text-sm text-muted">
              Сезон
              <Stepper label="Сезон" value={scope.season} min={1} max={99} onChange={(season) => set({ scope: { ...scope, season } })} />
            </span>
            <span className="flex items-center gap-2 text-sm text-muted">
              Серия
              <Stepper label="Серия" value={scope.episode} min={1} max={999} onChange={(episode) => set({ scope: { ...scope, episode } })} />
            </span>
            <Choice
              label="До какой серии"
              value={scope.until}
              onChange={(until) => set({ scope: { ...scope, until } })}
              options={[
                { value: 'season_end', label: 'до конца сезона' },
                { value: 'onward', label: 'и дальше' },
              ]}
            />
          </div>
        )}
        <Checkbox
          label="Качать сезон целиком после финала"
          description="Дождаться всех серий в нужной озвучке и скачать разом"
          checked={p.wholeSeasonAfterFinale}
          onChange={(e) => set({ wholeSeasonAfterFinale: e.target.checked })}
        />
      </section>

      <section className="flex flex-col gap-3">
        <H>Правила</H>
        <Checkbox label="Заменить, когда выйдет озвучка выше по приоритету" checked={p.replaceWithHigher} onChange={(e) => set({ replaceWithHigher: e.target.checked })} />
        <Checkbox label="Подписаться на новый сезон, когда его объявят" checked={p.autoNextSeason} onChange={(e) => set({ autoNextSeason: e.target.checked })} />
      </section>
    </div>
  );
}
