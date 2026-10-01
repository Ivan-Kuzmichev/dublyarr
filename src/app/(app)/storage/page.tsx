import Link from 'next/link';
import { PageTitle } from '@/components/shell/PageTitle';
import { Card } from '@/components/ui/Card';
import { Poster } from '@/components/catalog/Poster';
import { getDb } from '@/lib/db/client';
import { getSetting } from '@/lib/settings';
import { diskUsage, storageData } from '@/lib/storage';
import { getRetention } from '@/lib/retention-settings';
import { formatSize } from '@/lib/format';
import { todayIso } from '@/lib/dates';
import type { Paths } from '@/lib/downloads';
import { DeleteSeriesDialog } from './DeleteSeriesDialog';
import { FirstCleanup } from './FirstCleanup';

export const metadata = { title: 'Хранилище · Dublyarr' };
export const dynamic = 'force-dynamic';

const COLORS = ['bg-text-2', 'bg-[#9C8F7E]', 'bg-[#4A4642]', 'bg-line'];
const when = (ms: number) => new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
const weeks = (w: number | null) => (w === null ? '—' : w > 520 ? 'больше 10 лет' : `~${Math.round(w)} нед`);

async function load() {
  const db = getDb();
  const paths = getSetting<Paths>(db, 'paths');
  const disk = paths ? await diskUsage(paths.media) : null;
  return { paths, data: storageData(db, disk, getRetention(db), Date.now(), todayIso()) };
}

export default async function StoragePage({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const { sort } = await searchParams;
  const { paths, data } = await load();
  const shows = sort === 'date' ? [...data.shows].sort((a, b) => b.lastAt - a.lastAt) : data.shows;
  const d = data.disk;
  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2.5">
          <span className="font-mono text-sm break-all text-muted">NAS · {paths?.media ?? 'медиатека не настроена'}</span>
          <PageTitle>Хранилище</PageTitle>
        </div>
        <Link href="/settings/storage" className="text-sm no-underline">
          Правила хранения →
        </Link>
      </div>

      <Card className="flex flex-col gap-4 !p-6">
        {d ? (
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="font-display text-[34px] font-semibold">{formatSize(d.used)}</span>
            <span className="text-sm text-muted">
              занято из {formatSize(d.total)} · свободно {formatSize(d.free)} · {d.pct} %
            </span>
          </div>
        ) : (
          <span className="text-sm text-muted">Не удалось прочитать диск медиатеки</span>
        )}
        <div className="flex h-3 overflow-hidden rounded-full bg-line">
          {data.segments
            .filter((s) => s.name !== 'Свободно')
            .map((s, i) => (
              <div key={s.name} className={COLORS[i]} style={{ width: `${s.pct}%` }} />
            ))}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-text-3">
          {data.segments.map((s, i) => (
            <span key={s.name} className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-sm ${s.name === 'Свободно' ? 'border border-line-strong' : COLORS[i]}`} />
              {s.name} <span className="font-mono text-muted">{formatSize(s.size)}</span>
            </span>
          ))}
        </div>
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="m-0 text-xl font-semibold">По сериалам</h2>
            <div className="flex gap-1 rounded-[10px] bg-surface-2 p-1 text-[13px]">
              <Link href="/storage" className={`flex h-9 items-center rounded-[7px] px-3 no-underline ${sort !== 'date' ? 'bg-text font-semibold text-bg hover:text-bg' : 'text-muted'}`}>
                По размеру
              </Link>
              <Link href="/storage?sort=date" className={`flex h-9 items-center rounded-[7px] px-3 no-underline ${sort === 'date' ? 'bg-text font-semibold text-bg hover:text-bg' : 'text-muted'}`}>
                По дате
              </Link>
            </div>
          </div>
          {shows.length === 0 ? (
            <Card>
              <p className="m-0 text-[15px] text-muted">В медиатеке пока нет серий от Dublyarr.</p>
            </Card>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-line">
              {shows.map((s) => (
                <div key={s.tmdbId} className="flex items-center gap-3 border-t border-line-soft px-4 py-3 first:border-t-0">
                  <Poster tmdbId={s.tmdbId} name={s.title} path={s.posterPath} size="w185" className="h-12 w-8 shrink-0 rounded" />
                  <div className="flex min-w-0 grow flex-col gap-1.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <Link href={`/series/${s.tmdbId}`} className="truncate text-[15px] font-semibold text-text no-underline hover:text-accent">
                        {s.title}
                      </Link>
                      <span className="font-mono text-[13px] text-text-2">{formatSize(s.size)}</span>
                    </div>
                    <div className="flex h-1.5 overflow-hidden rounded-full bg-line">
                      <div className="bg-text-2" style={{ width: `${s.keepPct}%` }} />
                      <div className="bg-accent" style={{ width: `${s.dropPct}%` }} />
                    </div>
                    <div className="flex flex-wrap gap-x-3 text-xs text-faint">
                      <span className="font-mono">{s.seasons}</span>
                      <span>{s.quality}</span>
                      <span className={s.dropPct ? 'text-accent' : ''}>{s.rule}</span>
                    </div>
                  </div>
                  <DeleteSeriesDialog tmdbId={s.tmdbId} title={s.title} />
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-5">
          {data.pending.length > 0 && data.pendingRule && (
            <FirstCleanup items={data.pending.filter((i) => i.rule === data.pendingRule).map((i) => ({ key: i.key, label: i.label, why: i.why, size: i.size }))} rule={data.pendingRule} />
          )}
          <Card className="flex flex-col gap-3">
            <h2 className="m-0 text-lg font-semibold">Прогноз</h2>
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-lg whitespace-nowrap">+{formatSize(data.forecast.perWeek)}</span>
              <span className="text-right text-[13px] text-faint">в неделю, по последнему месяцу</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-lg whitespace-nowrap">{weeks(data.forecast.weeksLeft)}</span>
              <span className="text-right text-[13px] text-faint">до заполнения · {weeks(data.forecast.weeksAfter)} после уборки</span>
            </div>
          </Card>
          <Card className="flex flex-col gap-3">
            <h2 className="m-0 text-lg font-semibold">Недавно удалено</h2>
            {data.history.length === 0 ? (
              <span className="text-[13px] text-faint">Пока ничего</span>
            ) : (
              data.history.map((h) => (
                <div key={h.id} className="flex items-start justify-between gap-3 text-sm">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate">{h.label}</span>
                    <span className="text-xs text-faint">
                      {h.why} · {when(h.at)}
                    </span>
                  </span>
                  <span className="font-mono text-[13px] whitespace-nowrap text-muted">{formatSize(h.size)}</span>
                </div>
              ))
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
