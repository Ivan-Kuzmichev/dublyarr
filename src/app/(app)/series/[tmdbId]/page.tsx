import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageTitle } from '@/components/shell/PageTitle';
import { buttonClass } from '@/components/ui/Button';
import { Icon, ICONS } from '@/components/ui/Icon';
import { Poster } from '@/components/catalog/Poster';
import { getDb } from '@/lib/db/client';
import { getTmdb } from '@/lib/tmdb';
import { TmdbError } from '@/lib/tmdb/client';
import { listEpisodes, listSeasons, openTitle, type OpenResult } from '@/lib/catalog';
import { imageUrl, posterColor } from '@/lib/image-url';
import { formatAirDate, pickDefaultSeason, todayIso } from '@/lib/dates';
import type { Title } from '@/lib/db/schema';
import { KindSwitch } from './KindSwitch';
import { RefreshButton } from './RefreshButton';
import { SubscribeButton } from './SubscribeButton';
import { SubscriptionPanel } from './SubscriptionPanel';
import { getSubscription } from '@/lib/subscriptions';
import { getDefaultProfile } from '@/lib/profile';
import { listStudios } from '@/lib/studios';

export const dynamic = 'force-dynamic';

const STATUS: Record<Title['status'], string> = {
  returning: 'выходит',
  ended: 'завершён',
  canceled: 'закрыт',
  in_production: 'в производстве',
  planned: 'анонсирован',
};

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

async function load(tmdbId: number): Promise<{ ok: true; r: OpenResult } | { ok: false; error: string }> {
  const db = getDb();
  try {
    return { ok: true, r: await openTitle(db, getTmdb(db), tmdbId) };
  } catch (e) {
    if (e instanceof TmdbError && e.code === 'not_found') notFound();
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const refreshedLabel = (ts: number) => new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export default async function SeriesPage({ params, searchParams }: { params: Promise<{ tmdbId: string }>; searchParams: Promise<{ season?: string }> }) {
  const { tmdbId: raw } = await params;
  const tmdbId = Number(raw);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) notFound();
  const loaded = await load(tmdbId);
  if (!loaded.ok)
    return (
      <div className="flex flex-col gap-5">
        <PageTitle>Не удалось загрузить из TMDB</PageTitle>
        <p className="m-0 text-[15px] text-danger">{loaded.error}</p>
        <Link href={`/series/${tmdbId}`} className={buttonClass('secondary', 'md', 'self-start no-underline hover:text-text')}>
          Повторить
        </Link>
      </div>
    );

  const { title: t } = loaded.r;
  const db = getDb();
  const today = todayIso();
  const seasons = listSeasons(db, t.id);
  const { season: seasonParam } = await searchParams;
  const current = seasons.some((s) => String(s.number) === seasonParam) ? Number(seasonParam) : pickDefaultSeason(seasons, today);
  const eps = listEpisodes(db, t.id, current);
  const regular = seasons.filter((s) => s.number > 0).length;
  const ordered = [...seasons.filter((s) => s.number > 0), ...seasons.filter((s) => s.number === 0)];
  const backdrop = imageUrl('w1280', t.backdropPath);
  const sub = getSubscription(db, t.id);
  const studios = listStudios(db, t.kind).map((s) => ({ id: s.id, name: s.name }));
  const studioNames = Object.fromEntries(listStudios(db).map((s) => [s.id, s.name]));
  const episodeTotal = seasons.filter((s) => s.number > 0).reduce((n, s) => n + s.episodeCount, 0);
  const meta = [
    t.nameOriginal !== t.nameRu ? t.nameOriginal : null,
    t.year,
    t.genres.slice(0, 3).join(', ').toLowerCase() || null,
    regular ? `${regular} ${plural(regular, 'сезон', 'сезона', 'сезонов')}` : null,
    STATUS[t.status],
  ].filter(Boolean);

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
              <span className="text-[13px] text-text-2 lg:text-sm">{meta.join(' · ')}</span>
              <h1 className="m-0 font-display text-[24px] leading-tight font-semibold tracking-[-0.02em] lg:text-[40px]">{t.nameRu}</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SubscribeButton
              tmdbId={t.tmdbId}
              subscribed={!!sub}
              title={t.nameRu}
              subtitle={[t.nameOriginal !== t.nameRu ? t.nameOriginal : null, t.year, `${regular} ${plural(regular, 'сезон', 'сезона', 'сезонов')}, ${episodeTotal} ${plural(episodeTotal, 'серия', 'серии', 'серий')}`, STATUS[t.status]].filter(Boolean).join(' · ')}
              studios={studios}
              profile={sub?.profile ?? getDefaultProfile(db, t.kind)}
            />
            <RefreshButton tmdbId={t.tmdbId} />
            <KindSwitch tmdbId={t.tmdbId} kind={t.kind} />
          </div>
        </div>
      </section>

      {loaded.r.stale && <p className="m-0 text-sm text-accent">TMDB не ответил, данные от {refreshedLabel(t.refreshedAt)}</p>}
      {t.overview && <p className="m-0 max-w-[760px] text-[15px] leading-relaxed text-text-2">{t.overview}</p>}

      <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_340px]">
      {sub && (
        <div className="lg:order-2">
          <SubscriptionPanel profile={sub.profile} studioNames={studioNames} />
        </div>
      )}
      <section className="flex min-w-0 flex-col gap-4 lg:order-1">
        <nav aria-label="Сезоны" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {ordered.map((s) => {
            const on = s.number === current;
            return (
              <Link
                key={s.number}
                href={`/series/${t.tmdbId}?season=${s.number}`}
                aria-current={on ? 'page' : undefined}
                scroll={false}
                className={`flex h-11 shrink-0 items-center rounded-[10px] px-4 text-sm font-medium whitespace-nowrap no-underline ${
                  on ? 'bg-text text-bg hover:text-bg' : 'border border-line text-text-2 hover:border-line-strong hover:text-text'
                }`}
              >
                {s.number === 0 ? 'Спецвыпуски' : `Сезон ${s.number}`} · {s.episodeCount}
              </Link>
            );
          })}
        </nav>
        {eps.length === 0 ? (
          <p className="m-0 text-[15px] text-muted">Серии ещё не объявлены.</p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line">
            <div className="grid grid-cols-[48px_minmax(0,1fr)_110px] gap-3.5 bg-surface px-4 py-3 text-[11px] font-semibold tracking-[0.06em] text-faint uppercase lg:grid-cols-[60px_minmax(0,1fr)_140px] lg:px-[18px]">
              <span>№</span>
              <span>Серия</span>
              <span>Эфир</span>
            </div>
            {eps.map((e) => {
              const future = !e.airDate || e.airDate > today;
              return (
                <div
                  key={e.number}
                  className={`grid grid-cols-[48px_minmax(0,1fr)_110px] items-center gap-3.5 border-t border-line-soft px-4 py-3 text-sm lg:grid-cols-[60px_minmax(0,1fr)_140px] lg:px-[18px] ${future ? 'text-faint' : ''}`}
                >
                  <span className="font-mono text-[13px] text-muted">{String(e.number).padStart(2, '0')}</span>
                  <span className={`truncate ${future ? '' : 'font-medium text-text'}`}>{e.name}</span>
                  <span className="text-[13px]">{formatAirDate(e.airDate, today)}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
      </div>
    </div>
  );
}
