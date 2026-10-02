'use client';

import { Checkbox } from '@/components/ui/Checkbox';
import { Stepper } from '@/components/ui/Stepper';
import { MOVIE_DUB_LABEL, type MovieDubKind, type MovieProfile } from '@/lib/movie-profile';
import { Choice } from './ProfileEditor';

type Props = { value: MovieProfile; onChange: (p: MovieProfile) => void; found?: { kinds: Partial<Record<MovieDubKind, number>>; searching: boolean } | null };

/** Редактор профиля фильма: окно подписки и «Настройки → Фильмы». */
export function MovieProfileEditor({ value: p, onChange, found }: Props) {
  const set = (patch: Partial<MovieProfile>) => onChange({ ...p, ...patch });
  const q = p.quality;
  const move = (i: number, by: -1 | 1) => {
    const dubs = [...p.dubs];
    [dubs[i], dubs[i + by]] = [dubs[i + by], dubs[i]];
    set({ dubs });
  };
  const firstOn = p.dubs.findIndex((d) => d.on);
  const btn = 'flex h-11 w-11 cursor-pointer items-center justify-center rounded-[10px] text-muted hover:bg-surface hover:text-text disabled:cursor-default disabled:opacity-30';
  return (
    <div className="flex flex-col gap-7">
      <section className="flex flex-col gap-3">
        <h3 className="m-0 text-base font-semibold">Перевод</h3>
        {found?.searching && <span className="text-[13px] text-faint">Ищем раздачи на трекерах…</span>}
        <div className="flex flex-col gap-2">
          {p.dubs.map((d, i) => (
            <div key={d.kind} className={`flex min-h-12 items-center gap-2 rounded-[12px] border px-3 ${d.on ? 'border-accent bg-surface-2' : 'border-line'}`}>
              <label className="flex min-h-11 grow cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={d.on}
                  onChange={(e) => set({ dubs: p.dubs.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)) })}
                  className="h-[18px] w-[18px] accent-accent"
                />
                <span className="flex flex-col">
                  <span className={`text-[15px] font-medium ${d.on ? '' : 'text-muted'}`}>
                    {MOVIE_DUB_LABEL[d.kind]}
                    {found?.kinds[d.kind] ? <span className="ml-2 text-xs font-normal text-accent">нашлось раздач: {found.kinds[d.kind]}</span> : null}
                  </span>
                  {d.on && <span className="text-xs text-faint">{d.kind === 'dub' || i === firstOn ? 'сразу' : `через ${p.waitDubDays} дн после цифрового релиза`}</span>}
                </span>
              </label>
              <button type="button" aria-label={`«${MOVIE_DUB_LABEL[d.kind]}» выше`} disabled={i === 0} onClick={() => move(i, -1)} className={btn}>
                ↑
              </button>
              <button type="button" aria-label={`«${MOVIE_DUB_LABEL[d.kind]}» ниже`} disabled={i === p.dubs.length - 1} onClick={() => move(i, 1)} className={btn}>
                ↓
              </button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-2">
          Ждать дубляж после цифрового релиза
          <Stepper label="Ждать дубляж, дней" value={p.waitDubDays} min={0} max={90} suffix=" дн" onChange={(waitDubDays) => set({ waitDubDays })} />
        </div>
        <Checkbox label="Заменить на дубляж, когда выйдет" checked={p.replaceWithDub} onChange={(e) => set({ replaceWithDub: e.target.checked })} />
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="m-0 text-base font-semibold">Какие релизы брать</h3>
        <Checkbox label="Не качать экранки" description="CAMRip, TS, TC и прочие записи из кинотеатра" checked={p.noCam} onChange={(e) => set({ noCam: e.target.checked })} />
        <Checkbox label="Ждать цифровой релиз" description="WEB-DL или BDRip — раньше ничего не скачается" checked={p.digitalOnly} onChange={(e) => set({ digitalOnly: e.target.checked })} />
        <Checkbox label="Улучшить до BDRemux, когда выйдет" description="Старая копия удалится по правилам хранения" checked={p.remux} onChange={(e) => set({ remux: e.target.checked })} />
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="m-0 text-base font-semibold">Качество</h3>
        <Choice
          label="Качество"
          value={q.target}
          onChange={(target) => set({ quality: { ...q, target } })}
          options={[
            { value: 720, label: '720p' },
            { value: 1080, label: '1080p' },
            { value: 2160, label: '2160p' },
          ]}
        />
        <Checkbox label={`Если ${q.target}p нет — брать ниже`} checked={q.allowLower} onChange={(e) => set({ quality: { ...q, allowLower: e.target.checked } })} />
        <Checkbox label="Предпочитать HDR / Dolby Vision" checked={q.preferHdr} onChange={(e) => set({ quality: { ...q, preferHdr: e.target.checked } })} />
        <div className="flex flex-wrap items-center gap-3">
          <Checkbox label="Не больше" checked={q.maxSizeGb !== null} onChange={(e) => set({ quality: { ...q, maxSizeGb: e.target.checked ? 30 : null } })} />
          {q.maxSizeGb !== null && (
            <span className="flex items-center gap-2 text-sm text-text-2">
              <input
                type="number"
                aria-label="Лимит размера, ГБ"
                min={1}
                max={200}
                step={1}
                value={q.maxSizeGb}
                onChange={(e) => set({ quality: { ...q, maxSizeGb: Number(e.target.value) } })}
                className="h-11 w-20 rounded-[10px] border border-field-line bg-bg px-2 text-center font-mono text-sm text-text outline-none focus:border-accent"
              />
              ГБ
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
