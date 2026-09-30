import Link from 'next/link';
import { PageTitle } from '@/components/shell/PageTitle';
import { Card } from '@/components/ui/Card';
import { buttonClass } from '@/components/ui/Button';
import { LibraryCard } from '@/components/catalog/LibraryCard';
import { getDb } from '@/lib/db/client';
import { listStudios } from '@/lib/studios';
import { filterLibrary, libraryCounts, libraryItems, type LibraryFilter } from '@/lib/subscriptions';
import { todayIso } from '@/lib/dates';

export const metadata = { title: 'Библиотека · Dublyarr' };
export const dynamic = 'force-dynamic';

const FILTERS: { id: LibraryFilter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'airing', label: 'В эфире' },
  { id: 'ended', label: 'Завершены' },
];

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter: raw } = await searchParams;
  const filter = FILTERS.some((f) => f.id === raw) ? (raw as LibraryFilter) : 'all';
  const db = getDb();
  const today = todayIso();
  const items = libraryItems(db, today);
  const counts = libraryCounts(items);
  const shown = filterLibrary(items, filter);
  const studioNames = Object.fromEntries(listStudios(db).map((s) => [s.id, s.name]));
  return (
    <div className="flex flex-col gap-7">
      <div className="flex items-baseline gap-3">
        <PageTitle>Библиотека</PageTitle>
        <span className="font-mono text-lg text-muted">{counts.all}</span>
      </div>
      {items.length === 0 ? (
        <Card className="flex max-w-xl flex-col items-start gap-4">
          <p className="m-0 text-[15px] leading-normal text-text-2">Библиотека пуста. Найдите сериал в «Поиске и трендах» и подпишитесь.</p>
          <Link href="/discover" className={buttonClass('primary', 'md', 'no-underline hover:text-on-accent')}>
            Поиск и тренды
          </Link>
        </Card>
      ) : (
        <>
          <nav aria-label="Фильтр" className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            {FILTERS.map((f) => {
              const on = f.id === filter;
              return (
                <Link
                  key={f.id}
                  href={f.id === 'all' ? '/library' : `/library?filter=${f.id}`}
                  aria-current={on ? 'page' : undefined}
                  className={`flex h-11 shrink-0 items-center rounded-full px-4 text-sm font-medium whitespace-nowrap no-underline ${
                    on ? 'bg-text text-bg hover:text-bg' : 'border border-line text-text-2 hover:border-line-strong hover:text-text'
                  }`}
                >
                  {f.label} · {counts[f.id]}
                </Link>
              );
            })}
          </nav>
          <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 lg:grid-cols-5 lg:gap-x-5 xl:grid-cols-6">
            {shown.map((i) => (
              <LibraryCard key={i.title.id} item={i} studioNames={studioNames} today={today} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
