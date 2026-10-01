import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageTitle } from '@/components/shell/PageTitle';
import { buttonClass } from '@/components/ui/Button';
import { Icon, ICONS } from '@/components/ui/Icon';
import { Poster } from '@/components/catalog/Poster';
import { getDb } from '@/lib/db/client';
import { getTmdb } from '@/lib/tmdb';
import { TmdbError } from '@/lib/tmdb/client';
import { openMovie } from '@/lib/movies';
import { movieCard, type MovieStep } from '@/lib/movie-card';
import { imageUrl, posterColor } from '@/lib/image-url';
import { todayIso } from '@/lib/dates';
import { formatSize } from '@/lib/format';
import { getSubscription } from '@/lib/subscriptions';
import { getMovieDefault } from '@/lib/profile';
import { describeMovieProfile, isMovieProfile } from '@/lib/movie-profile';
import { getRetention } from '@/lib/retention-settings';
import { RetentionToggles } from '@/app/(app)/series/[tmdbId]/RetentionToggles';
import { DeleteSeriesDialog } from '@/app/(app)/storage/DeleteSeriesDialog';
import { MovieRefreshButton, MovieSubscribeButton } from './MovieButtons';

export const metadata = { title: 'Фильм · Dublyarr' };
export const dynamic = 'force-dynamic';

const runtime = (m: number | null) => (m ? (m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60 ? `${m % 60} мин` : ''}`.trim() : `${m} мин`) : null);
const fileLine = (f: NonNullable<ReturnType<typeof movieCard>['file']>) => [f.dub, f.quality + (f.hdr ? ' HDR' : ''), formatSize(f.size), f.processed ? 'пересобран' : null].filter(Boolean).join(' · ');
const refreshedLabel = (ts: number) => new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

// Прогноз — пунктирная янтарная рамка; есть — светлая заливка; ждём — янтарный текст; нет — серая рамка.
const STEP: Record<MovieStep['state'], { box: string; label: string; text: string }> = {
  done: { box: 'border border-line bg-surface-2', label: 'вышел', text: 'text-text-2' },
  forecast: { box: 'border-[1.5px] border-dashed border-accent', label: 'прогноз', text: 'text-accent' },
  wait: { box: 'border border-line', label: 'ждём', text: 'text-accent' },
  none: { box: 'border border-line', label: 'нет', text: 'text-faint' },
};

async function load(tmdbId: number) {
  const db = getDb();
  try {
    return { ok: true as const, r: await openMovie(db, getTmdb(db), tmdbId) };
  } catch (e) {
    if (e instanceof TmdbError && e.code === 'not_found') notFound();
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

export default async function MoviePage({ params }: { params: Promise<{ tmdbId: string }> }) {
  const { tmdbId: raw } = await params;
  const tmdbId = Number(raw);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) notFound();
  const loaded = await load(tmdbId);
  if (!loaded.ok)
    return (
      <div className="flex flex-col gap-5">
        <PageTitle>Не удалось загрузить из TMDB</PageTitle>
        <p className="m-0 text-[15px] text-danger">{loaded.error}</p>
        <Link href={`/movie/${tmdbId}`} className={buttonClass('secondary', 'md', 'self-start no-underline hover:text-text')}>
          Повторить
        </Link>
      </div>
    );

  const t = loaded.r.title;
  const db = getDb();
  const today = todayIso();
  const sub = getSubscription(db, t.id);
  const profile = sub && isMovieProfile(sub.profile) ? sub.profile : getMovieDefault(db);
  const card = movieCard(db, t, today);
  const backdrop = imageUrl('w1280', t.backdropPath);
  const meta = [t.nameOriginal !== t.nameRu ? t.nameOriginal : null, t.year, runtime(t.runtime), t.genres.slice(0, 3).join(', ').toLowerCase() || null].filter(Boolean);

  return (
    <div className="flex flex-col gap-7">
      <section className="relative -mx-4 -mt-6 overflow-hidden sm:-mx-5 lg:-mx-10 lg:-mt-10">
        <div className="absolute inset-0" style={{ background: posterColor(t.tmdbId) }}>
          {backdrop && (
            // eslint-disable-next-line @next/next/no-img-element -- через свой прокси картинок
            <img src={backdrop} alt="" className="h-full w-full object-cover opacity-60" />
          )}
          <div className="absolute inset-0 bg-[linear-gradient(to_top,#121110_8%,rgba(18,17,16,0.55)_60%,rgba(18,17,16,0.35))]" />
        </div>
        <div className="relative flex flex-col gap-5 px-4 pt-5 pb-6 sm:px-5 lg:px-10 lg:pt-8 lg:pb-8">
          <Link href="/discover" className="flex min-h-11 items-center gap-1 self-start text-sm text-text no-underline hover:text-text">
            <Icon d={ICONS.back} size={16} strokeWidth={2} />
            Поиск и тренды
          </Link>
          <div className="flex items-end gap-4 lg:gap-7">
            <div className="aspect-[2/3] w-[110px] shrink-0 overflow-hidden rounded-[14px] shadow-2xl lg:w-[180px]">
              <Poster tmdbId={t.tmdbId} name={t.nameRu} path={t.posterPath} className="h-full w-full" />
            </div>
            <div className="flex min-w-0 flex-col gap-2 lg:gap-3">
              <span className="text-[13px] text-text-2 lg:text-sm">
                <span className="mr-2 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs text-text-2">Фильм</span>
                {meta.join(' · ')}
              </span>
              <h1 className="m-0 font-display text-[24px] leading-tight font-semibold tracking-[-0.02em] lg:text-[40px]">{t.nameRu}</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <MovieSubscribeButton tmdbId={t.tmdbId} subscribed={!!sub} title={t.nameRu} subtitle={meta.join(' · ')} profile={profile} />
            <Link href={`/search/${t.tmdbId}?type=movie`} className={buttonClass('secondary', 'md', 'no-underline hover:text-text')}>
              Ручной поиск
            </Link>
            <MovieRefreshButton tmdbId={t.tmdbId} />
          </div>
        </div>
      </section>

      {loaded.r.stale && <p className="m-0 text-sm text-accent">TMDB не ответил, данные от {refreshedLabel(t.refreshedAt)}</p>}
      {t.overview && <p className="m-0 max-w-[760px] text-[15px] leading-relaxed text-text-2">{t.overview}</p>}

      <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="flex min-w-0 flex-col gap-5">
          <ol aria-label="Путь фильма" className="m-0 grid list-none grid-cols-2 gap-2.5 p-0 xl:grid-cols-4">
            {card.steps.map((s) => (
              <li key={s.key} className={`flex flex-col gap-1.5 rounded-xl p-3.5 ${STEP[s.state].box}`}>
                <span className={`text-xs font-semibold tracking-[0.04em] uppercase ${STEP[s.state].text}`}>
                  {s.state === 'done' && s.key === 'file' ? 'скачан' : s.state === 'done' && s.key === 'dub' ? 'есть' : STEP[s.state].label}
                </span>
                <span className="text-sm font-medium">{s.title}</span>
                <span className="text-xs text-faint">{s.key === 'file' && card.file ? fileLine(card.file) : s.sub}</span>
              </li>
            ))}
          </ol>
          {!sub && <p className="m-0 text-sm text-muted">Подпишитесь — Dublyarr дождётся цифрового релиза и нужного перевода и скачает фильм сам.</p>}
          {sub && card.status && !card.file && !card.steps.some((x) => x.state === 'forecast') && <p className="m-0 text-sm text-accent">{card.status}</p>}
        </section>
        {sub && (
          <div className="flex flex-col gap-5">
            <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="m-0 text-base font-semibold">Подписка</h3>
                <span className="text-[13px] text-accent">активна</span>
              </div>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {describeMovieProfile(profile).map((line) => (
                  <li key={line} className="flex gap-2.5 text-sm text-text-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    {line}
                  </li>
                ))}
              </ul>
            </section>
            <section className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-5">
              <h3 className="m-0 text-base font-semibold">Хранение</h3>
              <RetentionToggles tmdbId={t.tmdbId} keepAll={sub.keepAll} autoDelete={sub.autoDelete} days={getRetention(db).age.days} movie />
              <div className="pt-2">
                <DeleteSeriesDialog tmdbId={t.tmdbId} title={t.nameRu} trigger="button" movie />
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
