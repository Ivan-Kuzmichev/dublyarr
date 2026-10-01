import { SectionHeader, Card } from '@/components/ui/Card';
import { Table } from '@/components/ui/Table';
import { buttonClass } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { getDb } from '@/lib/db/client';
import { getTmdbSettings } from '@/lib/tmdb';
import { sourceCards, trackersTable, type TrackerRow } from '@/lib/trackers';
import { sources } from '@/lib/db/schema';
import { TmdbCard } from './TmdbCard';
import { plural } from '@/lib/plural';
import { SourceEditor } from './SourceEditor';
import { setPrimaryAction, refreshTrackersAction } from './source-actions';

export const metadata = { title: 'Источники · Dublyarr' };
export const dynamic = 'force-dynamic';

const KIND: Record<TrackerRow['kind'], string> = { series: 'Сериалы', anime: 'Аниме', both: 'Сериалы, аниме', unknown: '—' };
const SLIDERS = 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4';

export default function SourcesSettingsPage() {
  const db = getDb();
  const saved = getTmdbSettings(db);
  const cards = sourceCards(db);
  const full = new Map(db.select().from(sources).all().map((s) => [s.id, s]));
  const rows = trackersTable(db);
  return (
    <>
      <SectionHeader
        title="Источники поиска"
        description="Jackett, JacRed или любой Torznab (Prowlarr). Опрашиваются параллельно, одинаковые раздачи склеиваются."
        action={<SourceEditor className={buttonClass('primary', 'md')}>+ Добавить источник</SourceEditor>}
      />
      {cards.length === 0 ? (
        <Card>
          <p className="m-0 text-[15px] text-muted">Источников пока нет — добавьте Jackett или JacRed.</p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((c) => {
            const s = full.get(c.id)!;
            return (
              <article key={c.id} className={`flex flex-col gap-3 rounded-2xl border bg-surface p-[18px] ${c.lastError ? 'border-danger-line' : 'border-line'}`}>
                <div className="flex items-center gap-2.5">
                  <span className={`h-2 w-2 rounded-full ${c.lastError ? 'bg-danger' : c.lastOkAt ? 'bg-progress' : 'bg-dim'}`} />
                  <span className="grow text-base font-semibold">{c.name}</span>
                  <SourceEditor
                    source={{ id: s.id, name: s.name, url: s.url, timeoutMs: s.timeoutMs, kind: s.kind }}
                    className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-line text-muted hover:text-text"
                  >
                    <Icon d={SLIDERS} size={14} strokeWidth={2} />
                  </SourceEditor>
                </div>
                <span className="truncate font-mono text-xs text-faint">{c.url}</span>
                <div className="flex items-center gap-4 text-[13px] text-text-3">
                  <span>
                    {c.trackers} {plural(c.trackers, 'трекер', 'трекера', 'трекеров')}
                  </span>
                  <form action={refreshTrackersAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <button type="submit" className="h-11 cursor-pointer text-[13px] text-accent hover:text-accent-hover">
                      Обновить список
                    </button>
                  </form>
                </div>
                <span className={`text-[13px] ${c.lastError ? 'text-danger' : 'text-muted'}`}>
                  {c.lastError ? c.lastError : c.lastOkAt ? 'Отвечает' : 'Ещё не опрашивался'}
                </span>
              </article>
            );
          })}
        </div>
      )}
      {rows.length > 0 && (
        <Table<TrackerRow>
          rowKey={(r) => r.indexerId}
          rows={rows}
          columns={[
            { key: 'name', label: 'Трекер', render: (r) => <span className="font-medium">{r.name}</span> },
            { key: 'kind', label: 'Контент', width: '130px', render: (r) => <span className="text-[13px] text-text-3">{KIND[r.kind]}</span> },
            {
              key: 'primary',
              label: 'Основной',
              width: '190px',
              render: (r) =>
                r.backups.length === 0 ? (
                  <span className="text-[13px]">{r.primary?.sourceName ?? '—'}</span>
                ) : (
                  <form action={setPrimaryAction} className="flex items-center gap-2">
                    <select
                      name="trackerId"
                      defaultValue={r.primary?.trackerId}
                      aria-label={`Основной источник для ${r.name}`}
                      className="h-11 rounded-[10px] border border-field-line bg-bg px-2 text-[13px] text-text"
                    >
                      {[r.primary, ...r.backups].filter(Boolean).map((x) => (
                        <option key={x!.trackerId} value={x!.trackerId}>
                          {x!.sourceName}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="h-11 cursor-pointer px-1 text-[13px] text-accent">
                      ОК
                    </button>
                  </form>
                ),
            },
            { key: 'backup', label: 'Запасной', width: '170px', render: (r) => <span className="text-[13px] text-faint">{r.backups.map((b) => b.sourceName).join(', ') || '—'}</span> },
            {
              key: 'status',
              label: 'Статус',
              width: '150px',
              render: (r) => (
                <span className={`text-[13px] ${r.status === 'error' ? 'text-danger' : r.status === 'ok' ? 'text-text-3' : 'text-faint'}`}>
                  {r.status === 'error' ? 'Не отвечает' : r.status === 'ok' ? 'Отвечает' : 'Нет данных'}
                </span>
              ),
            },
          ]}
        />
      )}
      <p className="m-0 text-[13px] leading-normal text-faint">
        Если трекер есть в нескольких источниках, Dublyarr ходит только через основной, а запасной включается, когда основной не ответил. Торрент-файл скачивает сам
        Dublyarr и передаёт в qBittorrent.
      </p>
      <TmdbCard hasKey={!!saved} proxy={saved?.proxy ?? ''} />
    </>
  );
}
