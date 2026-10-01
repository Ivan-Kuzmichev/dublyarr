import Link from 'next/link';
import { Poster } from './Poster';
import { dubLabel } from '@/lib/profile-core';
import { formatAirDate } from '@/lib/dates';
import type { LibraryItem } from '@/lib/subscriptions';

const qualityLabel = (q: number) => (q === 2160 ? '4K' : `${q}p`);
import { isMovieProfile, MOVIE_DUB_LABEL } from '@/lib/movie-profile';

const code = (s: number, e: number) => `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`;

/** Карточка сериала в библиотеке (Library.dc.html). */
export function LibraryCard({ item, studioNames, today }: { item: LibraryItem; studioNames: Record<number, string>; today: string }) {
  const { title: t, profile, next } = item;
  const dubs = isMovieProfile(profile) ? profile.dubs.filter((d) => d.on).map((d) => MOVIE_DUB_LABEL[d.kind]) : profile.dubs.map((d) => dubLabel(d, (id) => studioNames[id]));
  const chain = dubs.slice(0, 2).join(' → ') + (dubs.length > 2 ? ' → …' : '');
  const ended = t.status === 'ended' || t.status === 'canceled';
  const line = next
    ? { text: `${code(next.season, next.number)} · ${formatAirDate(next.airDate, today)}`, cls: 'text-text-2' }
    : ended
      ? { text: 'Завершён', cls: 'text-faint' }
      : { text: 'Новых серий пока не объявлено', cls: 'text-faint' };
  return (
    <Link href={`/series/${t.tmdbId}`} className="group flex min-w-0 flex-col gap-2 text-text no-underline hover:text-text">
      <div className="aspect-[2/3] overflow-hidden rounded-[14px] bg-surface-2 transition group-hover:ring-2 group-hover:ring-accent">
        <Poster tmdbId={t.tmdbId} name={t.nameRu} path={t.posterPath} className="h-full w-full" />
      </div>
      <span className="line-clamp-2 text-[15px] leading-tight font-semibold">{t.nameRu}</span>
      <span className="truncate text-[13px] text-muted">
        {qualityLabel(profile.quality.target)} · {chain}
      </span>
      <span className={`text-[13px] ${line.cls}`}>{line.text}</span>
    </Link>
  );
}
