import { SectionHeader } from '@/components/ui/Card';
import { Table } from '@/components/ui/Table';
import { buttonClass } from '@/components/ui/Button';
import { getDb } from '@/lib/db/client';
import { listStudios } from '@/lib/studios';
import { getDefaultProfile } from '@/lib/profile';
import type { Studio } from '@/lib/db/schema';
import { DefaultProfileCard } from './DefaultProfileCard';
import { StudioEditor } from './StudioEditor';

export const metadata = { title: 'Подписки и студии · Dublyarr' };

const KIND: Record<Studio['kind'], string> = { series: 'Сериалы', anime: 'Аниме', both: 'Оба' };
const SOURCE: Record<Studio['source'], string> = { seed: 'Начальный набор', manual: 'Вручную', laya: 'Laya' };

export default function StudiosSettingsPage() {
  const db = getDb();
  const all = listStudios(db);
  const names = Object.fromEntries(all.map((s) => [s.id, s.name]));
  const opts = (kind: 'series' | 'anime') => listStudios(db, kind).map((s) => ({ id: s.id, name: s.name }));
  return (
    <>
      <SectionHeader title="Подписки и студии" description="Профиль подставляется в новую подписку по типу: сериал или аниме (тип берётся из TMDB)." />
      <div className="grid gap-4 md:grid-cols-2">
        <DefaultProfileCard kind="series" profile={getDefaultProfile(db, 'series')} studios={opts('series')} studioNames={names} />
        <DefaultProfileCard kind="anime" profile={getDefaultProfile(db, 'anime')} studios={opts('anime')} studioNames={names} />
      </div>
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
          { key: 'aliases', label: 'Варианты написания', render: (s) => <span className="font-mono text-xs text-text-3">{s.aliases.join(', ') || '—'}</span> },
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
