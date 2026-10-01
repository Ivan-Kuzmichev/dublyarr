import Link from 'next/link';
import { episodeStatuses, seriesDubColumns, speedBlock, delayBasis, type EpisodeStatus, type DubCell } from '@/lib/dashboard';
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
import { plural } from '@/lib/plural';
import { RefreshButton } from './RefreshButton';
import { SubscribeButton } from './SubscribeButton';
import { SubscriptionPanel } from './SubscriptionPanel';
import { seriesKind } from '@/lib/profile';
import { isMovieProfile } from '@/lib/movie-profile';
import { RetentionToggles } from './RetentionToggles';
import { DeleteSeriesDialog } from '@/app/(app)/storage/DeleteSeriesDialog';
import { getRetention } from '@/lib/retention-settings';
import { getSubscription } from '@/lib/subscriptions';
import { getDefaultProfile, subscribeDialogStudios } from '@/lib/profile';

const EP_TONE: Record<EpisodeStatus['state'], string> = {
  downloaded: 'text-text-2',
  downloading: 'text-progress',
  waiting: 'text-accent',
  missing: 'text-muted',
  ask: 'text-danger',
  upcoming: 'text-faint',
  skipped: 'text-faint',
};

/** Прогноз — пунктирная янтарная рамка; вышла — светлая заливка. */
function DubBadge({ cell }: { cell: DubCell }) {
  if (cell.kind === 'none') return <span className="text-[13px] text-dim">—</span>;
  const cls = cell.kind === 'done' ? 'bg-text-2 text-bg' : 'border-[1.5px] border-dashed border-accent text-accent';
  return <span className={`inline-flex h-7 min-w-11 items-center justify-center rounded-md px-1.5 font-mono text-xs ${cls}`}>{cell.text}</span>;
}

export const dynamic = 'force-dynamic';

const STATUS: Record<Title['status'], string> = {
  returning: 'выходит',
  ended: 'завершён',
  canceled: 'закрыт',
  in_production: 'в производстве',
  planned: 'анонсирован',
  released: 'вышел',
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
  const statuses = episodeStatuses(db, t.id, today);
  const dubCols = seriesDubColumns(db, t.id, current, today);
  const basis = delayBasis(db, t.id);
  const cols = `48px minmax(120px,1fr) ${dubCols.columns.map(() => '60px').join(' ')} 150px 110px`;
  const regular = seasons.filter((s) => s.number > 0).length;
  const ordered = [...seasons.filter((s) => s.number > 0), ...seasons.filter((s) => s.number === 0)];
  const backdrop = imageUrl('w1280', t.backdropPath);
  const sub = getSubscription(db, t.id);
  const speed = sub ? speedBlock(db, t.id) : [];
  const { addable: studios, names: studioNames } = subscribeDialogStudios(db, t.kind);
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
              names={studioNames}
              profile={sub && !isMovieProfile(sub.profile) ? sub.profile : getDefaultProfile(db, t.kind)}
              basis={basis}
            />
            <Link href={`/search/${t.tmdbId}?s=${current}`} className={buttonClass('secondary', 'md', 'no-underline hover:text-text')}>
              Ручной поиск
            </Link>
            <RefreshButton tmdbId={t.tmdbId} />
            <KindSwitch tmdbId={t.tmdbId} kind={seriesKind(t.kind)} />
          </div>
        </div>
      </section>

      {loaded.r.stale && <p className="m-0 text-sm text-accent">TMDB не ответил, данные от {refreshedLabel(t.refreshedAt)}</p>}
      {t.overview && <p className="m-0 max-w-[760px] text-[15px] leading-relaxed text-text-2">{t.overview}</p>}

      <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_340px]">
      {sub && (
        <div className="lg:order-2">
          {!isMovieProfile(sub.profile) && <SubscriptionPanel profile={sub.profile} studioNames={studioNames} />}
          <section className="mt-5 flex flex-col gap-2 rounded-2xl border border-line bg-surface p-5">
            <h3 className="m-0 text-base font-semibold">Хранение</h3>
            <RetentionToggles tmdbId={t.tmdbId} keepAll={sub.keepAll} autoDelete={sub.autoDelete} days={getRetention(db).age.days} />
            <div className="pt-2">
              <DeleteSeriesDialog tmdbId={t.tmdbId} title={t.nameRu} trigger="button" />
            </div>
          </section>
          {speed.length > 0 && (
            <section className="mt-5 flex flex-col gap-3.5 rounded-2xl border border-line bg-surface p-5">
              <h3 className="m-0 text-base font-semibold">Скорость озвучки</h3>
              {speed.map((x) => (
                <div key={x.name} className="flex flex-col gap-1.5">
                  <div className="flex justify-between gap-3 text-sm">
                    <span>{x.name}</span>
                    <span className="font-mono text-[13px] text-muted">{x.text}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-line">
                    <div className="h-1.5 rounded-full bg-text-2" style={{ width: x.width }} />
                  </div>
                </div>
              ))}
              <span className="text-xs text-faint">После эфира оригинала, медиана по этому сериалу</span>
            </section>
          )}
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
            <div
              className="grid grid-cols-[40px_minmax(0,1fr)_minmax(0,150px)] gap-3.5 bg-surface px-4 py-3 text-[11px] font-semibold tracking-[0.06em] text-faint uppercase lg:[grid-template-columns:var(--cols)] lg:px-[18px]"
              style={{ '--cols': cols } as React.CSSProperties}
            >
              <span>№</span>
              <span>Серия</span>
              {dubCols.columns.map((c) => (
                <span key={c} className="truncate max-lg:hidden">
                  {c}
                </span>
              ))}
              <span className="max-lg:hidden">Статус</span>
              <span>Эфир</span>
            </div>
            {eps.map((e) => {
              const future = !e.airDate || e.airDate > today;
              const st = statuses.get(`${e.season}:${e.number}`);
              return (
                <div
                  key={e.number}
                  className={`grid grid-cols-[40px_minmax(0,1fr)_minmax(0,150px)] items-center gap-3.5 border-t border-line-soft px-4 py-3 text-sm lg:[grid-template-columns:var(--cols)] lg:px-[18px] ${future ? 'text-faint' : ''}`}
                  style={{ '--cols': cols } as React.CSSProperties}
                >
                  <span className="font-mono text-[13px] text-muted">{String(e.number).padStart(2, '0')}</span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className={`truncate ${future ? '' : 'font-medium text-text'}`}>{e.name}</span>
                    {st && <span className={`truncate text-xs lg:hidden ${EP_TONE[st.state]}`}>{[st.text, st.detail].filter(Boolean).join(' · ')}</span>}
                  </span>
                  {(dubCols.cells.get(e.number) ?? dubCols.columns.map(() => null)).map((c, i) => (
                    <span key={i} className="max-lg:hidden">
                      {c && <DubBadge cell={c} />}
                    </span>
                  ))}
                  <span className="flex min-w-0 flex-col gap-0.5 max-lg:hidden">
                    {st && <span className={`text-[13px] ${EP_TONE[st.state]}`}>{st.text}</span>}
                    {st?.detail && <span className="truncate text-xs text-faint" title={st.detail}>{st.detail}</span>}
                  </span>
                  <span className="flex items-center justify-between gap-2 text-[13px]">
                    {formatAirDate(e.airDate, today)}
                    {!future && (
                      <Link
                        href={`/search/${t.tmdbId}?s=${e.season}&e=${e.number}`}
                        aria-label={`Ручной поиск ${e.season}×${e.number}`}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-faint hover:bg-surface-2 hover:text-text"
                      >
                        <Icon d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" size={16} />
                      </Link>
                    )}
                  </span>
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
