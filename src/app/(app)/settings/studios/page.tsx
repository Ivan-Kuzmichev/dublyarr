import { SectionHeader } from '@/components/ui/Card';
import { Table } from '@/components/ui/Table';
import { buttonClass } from '@/components/ui/Button';
import { getDb } from '@/lib/db/client';
import { listStudios } from '@/lib/studios';
import { getDefaultProfile } from '@/lib/profile';
import type { Studio } from '@/lib/db/schema';
import { DefaultProfileCard } from './DefaultProfileCard';
import { StudioEditor } from './StudioEditor';
import { confirmLayaAliasAction } from './actions';

export const metadata = { title: 'Подписки и студии · Dublyarr' };

const KIND: Record<Studio['kind'], string> = { series: 'Сериалы', anime: 'Аниме', both: 'Оба' };
const SOURCE: Record<Studio['source'], string> = { seed: 'Начальный набор', manual: 'Вручную', laya: 'Laya' };

export default function StudiosSettingsPage() {
  const db = getDb();
  const all = listStudios(db);
  const names = Object.fromEntries(all.map((s) => [s.id, s.name]));
  const pending = all.flatMap((s) => s.layaAliases.map((alias) => ({ s, alias })));
  const opts = (kind: 'series' | 'anime') => listStudios(db, kind).map((s) => ({ id: s.id, name: s.name }));
  return (
    <>
      <SectionHeader title="Подписки и студии" description="Профиль подставляется в новую подписку по типу: сериал или аниме (тип берётся из TMDB)." />
      <div className="grid gap-4 md:grid-cols-2">
        <DefaultProfileCard kind="series" profile={getDefaultProfile(db, 'series')} studios={opts('series')} studioNames={names} />
        <DefaultProfileCard kind="anime" profile={getDefaultProfile(db, 'anime')} studios={opts('anime')} studioNames={names} />
      </div>
      {pending.length > 0 && (
        <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
          <div className="flex flex-col gap-1">
            <h3 className="m-0 text-base font-semibold">Laya добавила варианты написания</h3>
            <span className="text-[13px] text-faint">Проверьте: каждый ответ — пример для дообучения. «Нет» уберёт вариант и разберёт раздачи заново.</span>
          </div>
          {pending.map(({ s, alias }) => (
            <form key={`${s.id}:${alias}`} action={confirmLayaAliasAction} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-soft pt-3 first-of-type:border-t-0 first-of-type:pt-0">
              <input type="hidden" name="studioId" value={s.id} />
              <input type="hidden" name="alias" value={alias} />
              <span className="font-mono text-sm text-accent">{alias}</span>
              <span className="text-sm text-muted">→ {s.name}</span>
              <span className="grow" />
              <button type="submit" name="verdict" value="ok" className="h-11 cursor-pointer rounded-[10px] border border-line-strong px-4 text-[13px] text-text-2 hover:text-text">
                Верно
              </button>
              <button type="submit" name="verdict" value="no" className="h-11 cursor-pointer rounded-[10px] px-3 text-[13px] text-faint hover:text-danger">
                Нет
              </button>
            </form>
          ))}
        </section>
      )}
      <div className="flex items-center justify-between gap-3">
        <h3 className="m-0 text-lg font-semibold">
          Словарь студий <span className="text-sm font-normal text-faint">· {all.length}</span>
        </h3>
        <StudioEditor className={buttonClass('secondary', 'sm')}>+ Студия</StudioEditor>
      </div>
      <Table<Studio>
        rowKey={(s) => s.id}
        rows={all}
        columns={[
          { key: 'name', label: 'Студия', width: '180px', render: (s) => <span className="font-medium">{s.name}</span> },
          {
            key: 'aliases',
            label: 'Варианты написания',
            render: (s) =>
              s.aliases.length ? (
                <span className="font-mono text-xs text-text-3">
                  {s.aliases.map((a, i) => (
                    <span key={a} className={s.layaAliases.includes(a) ? 'text-accent' : ''}>
                      {i ? ', ' : ''}
                      {a}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="font-mono text-xs text-text-3">—</span>
              ),
          },
          { key: 'kind', label: 'Тип', width: '100px', render: (s) => <span className="text-[13px] text-text-3">{KIND[s.kind]}</span> },
          { key: 'trackers', label: 'Свой трекер', width: '130px', render: (s) => <span className="text-[13px] text-text-3">{s.trackers.join(', ') || '—'}</span> },
          { key: 'source', label: 'Кто добавил', width: '140px', render: (s) => <span className="text-[13px] text-faint">{SOURCE[s.source]}</span> },
          {
            key: 'edit',
            label: '',
            width: '110px',
            render: (s) => (
              <StudioEditor studio={s} className={buttonClass('ghost', 'sm')}>
                Изменить
              </StudioEditor>
            ),
          },
        ]}
      />
    </>
  );
}
