import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { Card, SectionHeader } from '@/components/ui/Card';
import { getDb } from '@/lib/db/client';
import { getMovieDefault } from '@/lib/profile';
import { subscriptions, titles } from '@/lib/db/schema';
import { movieCard } from '@/lib/movie-card';
import { todayIso } from '@/lib/dates';
import { MovieDefaultForm } from './MovieDefaultForm';
import { requirePage } from '@/lib/auth/current';

export const metadata = { title: 'Фильмы · Dublyarr' };
export const dynamic = 'force-dynamic';

const BOX = { done: 'border border-line bg-surface-2', forecast: 'border-[1.5px] border-dashed border-accent', wait: 'border border-line', none: 'border border-line' } as const;
const TEXT = { done: 'text-text-2', forecast: 'text-accent', wait: 'text-accent', none: 'text-faint' } as const;

export default async function MovieSettingsPage() {
  await requirePage('admin');
  const db = getDb();
  // «Как это выглядит» — по последнему фильму в подписках
  const last = db.select({ t: titles }).from(subscriptions).innerJoin(titles, eq(titles.id, subscriptions.titleId)).where(eq(titles.kind, 'movie')).orderBy(desc(subscriptions.subscribedAt)).get()?.t;
  const card = last ? movieCard(db, last, todayIso()) : null;
  return (
    <>
      <SectionHeader title="Фильмы" description="У фильмов нет серий и студий-сериальщиков: важнее, какой это релиз и какой перевод. Это профиль для новых подписок на фильмы." />
      <MovieDefaultForm initial={getMovieDefault(db)} />
      {last && card && (
        <Card className="flex min-w-0 flex-col gap-3.5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <span className="text-base font-semibold">
              Как это выглядит ·{' '}
              <Link href={`/movie/${last.tmdbId}`} className="text-text no-underline hover:text-accent">
                {last.nameRu}
              </Link>
            </span>
            {card.status && <span className="text-[13px] text-accent">{card.status}</span>}
          </div>
          <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
            {card.steps.map((s) => (
              <div key={s.key} className={`flex flex-col gap-1.5 rounded-xl p-3.5 ${BOX[s.state]}`}>
                <span className={`text-sm font-medium ${TEXT[s.state]}`}>{s.title}</span>
                <span className="text-xs text-faint">{s.sub}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
