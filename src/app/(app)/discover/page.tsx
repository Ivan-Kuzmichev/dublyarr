import Link from 'next/link';
import { PageTitle } from '@/components/shell/PageTitle';
import { Card } from '@/components/ui/Card';
import { buttonClass } from '@/components/ui/Button';
import { PosterCard } from '@/components/catalog/PosterCard';
import { getDb } from '@/lib/db/client';
import { getTmdb } from '@/lib/tmdb';
import { loadDiscover, type Card as CardData } from '@/lib/discover';
import { formatAirDate, todayIso } from '@/lib/dates';
import { SearchBox } from './SearchBox';

export const metadata = { title: 'Поиск и тренды · Dublyarr' };
export const dynamic = 'force-dynamic';

const grid = 'grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 lg:grid-cols-5 lg:gap-x-5 xl:grid-cols-6';

function Grid({ cards, note }: { cards: CardData[]; note?: (c: CardData) => string | undefined }) {
  return (
    <div className={grid}>
      {cards.map((c) => (
        <PosterCard key={`${c.movie ? 'm' : 's'}${c.tmdbId}`} {...c} note={note?.(c)} />
      ))}
    </div>
  );
}

const Heading = ({ children }: { children: React.ReactNode }) => <h2 className="m-0 text-xl font-semibold lg:text-2xl">{children}</h2>;

const ErrorLine = ({ message }: { message?: string }) =>
  message ? (
    <p role="alert" className="m-0 text-sm text-danger">
      {message}
    </p>
  ) : null;

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const db = getDb();
  const today = todayIso();
  const data = await loadDiscover(db, getTmdb(db), q, today);
  return (
    <div className="flex flex-col gap-7">
      <PageTitle>Поиск и тренды</PageTitle>
      {data.mode === 'no-key' ? (
        <Card className="flex max-w-xl flex-col items-start gap-4">
          <p className="m-0 text-[15px] leading-normal text-text-2">Добавьте ключ TMDB — без него поиск не работает.</p>
          <Link href="/settings/sources" className={buttonClass('primary', 'md', 'no-underline hover:text-on-accent')}>
            Открыть настройки
          </Link>
        </Card>
      ) : (
        <>
          <SearchBox initial={q ?? ''} />
          {data.mode === 'search' ? (
            <section className="flex flex-col gap-4">
              <ErrorLine message={data.error} />
              {!data.error && <span className="text-sm text-muted">Найдено: {data.cards.length}</span>}
              {data.cards.length > 0 ? (
                <Grid cards={data.cards} />
              ) : (
                !data.error && <p className="m-0 text-[15px] text-muted">Ничего не нашлось. Попробуйте оригинальное название.</p>
              )}
            </section>
          ) : (
            <>
              {data.upcoming.length > 0 && (
                <section className="flex flex-col gap-4">
                  <Heading>Скоро новые сезоны</Heading>
                  <Grid cards={data.upcoming} note={(c) => `с ${formatAirDate((c as (typeof data.upcoming)[number]).nextAirDate, today)}`} />
                </section>
              )}
              <section className="flex flex-col gap-4">
                <Heading>Популярное за неделю</Heading>
                <ErrorLine message={data.error} />
                <Grid cards={data.trending} />
              </section>
              {data.movies.length > 0 && (
                <section className="flex flex-col gap-4">
                  <Heading>Популярные фильмы</Heading>
                  <Grid cards={data.movies} />
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
