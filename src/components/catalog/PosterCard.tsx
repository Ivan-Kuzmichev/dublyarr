import Link from 'next/link';
import { Poster } from './Poster';

type Props = { tmdbId: number; name: string; year: number | null; posterPath: string | null; anime: boolean; note?: string };

export function PosterCard({ tmdbId, name, year, posterPath, anime, note }: Props) {
  return (
    <Link href={`/series/${tmdbId}`} className="group flex min-w-0 flex-col gap-2 text-text no-underline hover:text-text">
      <div className="aspect-[2/3] overflow-hidden rounded-[14px] bg-surface-2 ring-accent/0 transition group-hover:ring-2 group-hover:ring-accent">
        <Poster tmdbId={tmdbId} name={name} path={posterPath} className="h-full w-full" />
      </div>
      <span className="line-clamp-2 text-[15px] leading-tight font-semibold">{name}</span>
      <span className="text-[13px] text-muted">
        {note ?? year ?? ''}
        {anime && (
          <>
            {note || year ? ' · ' : ''}
            <span className="text-accent">Аниме</span>
          </>
        )}
      </span>
    </Link>
  );
}
