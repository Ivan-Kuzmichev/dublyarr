import Link from 'next/link';
import { PageTitle } from '@/components/shell/PageTitle';
import { Icon } from '@/components/ui/Icon';
import { getDb } from '@/lib/db/client';
import { addDays, formatShortDate, todayIso } from '@/lib/dates';
import { calendarWeek, mondayOf } from '@/lib/dashboard';

export const metadata = { title: 'Календарь · Dublyarr' };
export const dynamic = 'force-dynamic';

const EVENT = {
  downloaded: 'bg-text-2 border-text-2 text-bg',
  aired: 'border-line-strong text-text-2',
  upcoming: 'border-line-soft text-faint',
} as const;

const navBtn = 'flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface text-text-2 hover:text-text';

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams;
  const today = todayIso();
  const monday = mondayOf(week && /^\d{4}-\d{2}-\d{2}$/.test(week) && !Number.isNaN(Date.parse(week)) ? week : today);
  const { days } = calendarWeek(getDb(), monday, today);
  const thisWeek = monday === mondayOf(today);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2.5">
          <span className="text-sm text-muted">
            {formatShortDate(monday, today)} — {formatShortDate(addDays(monday, 6), today)}
          </span>
          <PageTitle>Календарь</PageTitle>
        </div>
        <div className="flex items-center gap-2.5">
          {!thisWeek && (
            <Link href="/calendar" className="flex h-11 items-center rounded-xl border border-line bg-surface px-4 text-sm text-text no-underline hover:text-text">
              Эта неделя
            </Link>
          )}
          <Link href={`/calendar?week=${addDays(monday, -7)}`} aria-label="Предыдущая неделя" className={navBtn}>
            <Icon d="M15 18l-6-6 6-6" size={18} />
          </Link>
          <Link href={`/calendar?week=${addDays(monday, 7)}`} aria-label="Следующая неделя" className={navBtn}>
            <Icon d="M9 18l6-6-6-6" size={18} />
          </Link>
        </div>
      </div>
      <div className="flex flex-wrap gap-5 text-[13px] text-text-3">
        <span className="flex items-center gap-2">
          <span className="h-3.5 w-3.5 rounded border-[1.5px] border-line-strong" />
          Эфир оригинала
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3.5 w-3.5 rounded bg-text-2" />
          Скачано в озвучке
        </span>
      </div>
      <div className="grid gap-2.5 lg:grid-cols-7">
        {days.map((d) => (
          <div key={d.date} className={`flex flex-col gap-2 rounded-2xl border px-2.5 py-3 ${d.today ? 'border-accent bg-surface' : 'border-line-soft'} ${d.events.length ? '' : 'max-lg:hidden'}`}>
            <div className="flex items-baseline justify-between px-1 pb-1.5">
              <span className="text-[13px] text-muted">{d.label.split(' ')[0]}</span>
              <span className={`font-display text-xl font-semibold ${d.today ? 'text-accent' : ''}`}>{d.label.split(' ')[1]}</span>
            </div>
            {d.events.map((e) => (
              <Link key={`${e.tmdbId}-${e.code}`} href={`/series/${e.tmdbId}`} className={`flex flex-col gap-1 rounded-[10px] border-[1.5px] p-2.5 no-underline ${EVENT[e.kind]} hover:opacity-90`}>
                <span className="text-[13px] leading-tight font-semibold">{e.title}</span>
                <span className="font-mono text-[11px] opacity-85">{e.code}</span>
                <span className="text-xs opacity-85">{e.sub}</span>
              </Link>
            ))}
          </div>
        ))}
      </div>
      {days.every((d) => !d.events.length) && <p className="m-0 text-[15px] text-muted">На этой неделе у подписок нет серий.</p>}
    </div>
  );
}
