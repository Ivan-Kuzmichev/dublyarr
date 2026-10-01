import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageTitle } from '@/components/shell/PageTitle';
import { Card } from '@/components/ui/Card';
import { Icon, ICONS } from '@/components/ui/Icon';
import { getDb } from '@/lib/db/client';
import { getTmdb } from '@/lib/tmdb';
import { listSeasons, openTitle } from '@/lib/catalog';
import { runManualMovieSearch, runManualSearch, type ManualResult, type ManualRow } from '@/lib/manual-search';
import { openMovie } from '@/lib/movies';
import { listStudios } from '@/lib/studios';
import { pickDefaultSeason, todayIso } from '@/lib/dates';
import { formatSize, qualityLabel } from '@/lib/format';
import type { Verdict } from '@/lib/evaluate';
import { AssignStudio } from './AssignStudio';
import { DownloadButton } from './DownloadButton';
import { answerMatchAction } from './actions';

export const metadata = { title: 'Ручной поиск · Dublyarr' };
export const dynamic = 'force-dynamic';

const BY: Record<string, string> = { tracker: 'по трекеру', title: 'по названию', tag: 'по тегу', none: 'не распознано' };
const TONE: Record<Verdict['tone'], string> = { best: 'text-accent font-semibold', ok: 'text-text-2', wait: 'text-accent', ask: 'text-accent', reject: 'text-faint' };
const code = (s: number, e?: number) => `S${String(s).padStart(2, '0')}${e !== undefined ? `E${String(e).padStart(2, '0')}` : ''}`;
const GENERIC = /^(?:DUB|MVO|DVO|VO|AVO)$/;
// Как распознана озвучка раздачи: по самому надёжному из способов.
const recognizedBy = (dubs: ManualRow['dubs']) => (['tracker', 'title', 'tag'] as const).find((b) => dubs.some((d) => d.by === b && (d.studioName || b === 'tag'))) ?? 'none';

function Row({ row, tmdbId, studios, season, episode, movie = false }: { row: ManualRow; tmdbId: number; studios: { id: number; name: string }[]; season: number; episode?: number; movie?: boolean }) {
  const { release: r, verdict: v, dubs } = row;
  const unknown = dubs.find((d) => !d.studioName && d.by !== 'tag' && !GENERIC.test(d.label));
  const dim = v.tone === 'reject' ? 'opacity-60' : '';
  const canReject = !(r.match.rule === 'reject');
  const canConfirm = r.match.level !== 'match' || r.match.rule === 'reject';
  return (
    <div
      className={`grid grid-cols-1 gap-2 border-t border-line-soft px-4 py-3 text-sm lg:grid-cols-[minmax(0,1fr)_170px_150px_80px_64px_190px_170px] lg:items-center lg:gap-3.5 lg:px-[18px] ${v.best ? 'bg-[rgba(240,164,66,0.06)]' : ''}`}
    >
      <div className={`flex min-w-0 flex-col gap-1 ${dim}`}>
        <span className="font-mono text-xs leading-snug break-words text-text">{r.title}</span>
        <span className="text-xs text-faint">{r.trackerName}</span>
      </div>
      <div className={`flex flex-col gap-0.5 ${dim}`}>
        <span className={unknown ? 'text-accent' : ''}>
          {dubs.length ? dubs.map((d) => d.studioName ?? `${d.label}${GENERIC.test(d.label) ? '' : '?'}`).join(', ') : '—'}
        </span>
        <span className="text-xs text-faint">{BY[recognizedBy(dubs)]}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 lg:contents">
        <span className={`text-[13px] text-text-3 ${dim}`}>{qualityLabel(r.parsed)}</span>
        <span className={`font-mono text-[13px] text-text-3 ${dim}`}>{formatSize(r.size)}</span>
        <span className={`font-mono text-[13px] ${r.seeders === 0 ? 'text-danger' : 'text-text-3'} ${dim}`}>
          {r.seeders ?? '—'}
          <span className="lg:hidden"> сид.</span>
        </span>
      </div>
      <span className={`text-[13px] ${TONE[v.tone]}`}>{v.reason}</span>
      <div className="flex flex-wrap items-center gap-2">
        {(v.tone === 'best' || v.tone === 'ok') && <DownloadButton tmdbId={tmdbId} releaseId={r.id} season={season} episode={episode} movie={movie} />}
        {unknown && !movie && <AssignStudio tmdbId={tmdbId} label={unknown.label} studios={studios} />}
        {(canConfirm || canReject) && (
          <form action={answerMatchAction} className="flex gap-1">
            <input type="hidden" name="tmdbId" value={tmdbId} />
            <input type="hidden" name="releaseId" value={r.id} />
            {movie && <input type="hidden" name="type" value="movie" />}
            {canConfirm && (
              <button type="submit" name="verdict" value="match" className="h-11 cursor-pointer rounded-[10px] border border-line-strong px-3 text-[13px] text-text-2 hover:text-text">
                Это он
              </button>
            )}
            {canReject && v.tone !== 'reject' && (
              <button type="submit" name="verdict" value="reject" className="h-11 cursor-pointer rounded-[10px] px-2 text-[13px] text-faint hover:text-danger">
                {movie ? 'Не тот фильм' : 'Не тот сериал'}
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

export default async function ManualSearchPage({ params, searchParams }: { params: Promise<{ tmdbId: string }>; searchParams: Promise<{ s?: string; e?: string; type?: string }> }) {
  const { tmdbId: raw } = await params;
  const tmdbId = Number(raw);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) notFound();
  if ((await searchParams).type === 'movie') return <MovieSearch tmdbId={tmdbId} />;
  const db = getDb();
  const { title } = await openTitle(db, getTmdb(db), tmdbId);
  const seasons = listSeasons(db, title.id);
  const today = todayIso();
  const sp = await searchParams;
  const season = seasons.some((s) => String(s.number) === sp.s) ? Number(sp.s) : pickDefaultSeason(seasons, today);
  const episode = sp.e && /^\d+$/.test(sp.e) ? Number(sp.e) : undefined;
  const result = await runManualSearch(db, tmdbId, { season, episode }, { today });
  const studios = listStudios(db).map((s) => ({ id: s.id, name: s.name }));
  const regular = seasons.filter((s) => s.number > 0);

  return (
    <div className="flex flex-col gap-6">
      <Link href={`/series/${tmdbId}`} className="flex min-h-11 items-center gap-1 self-start text-sm text-muted no-underline hover:text-text-2">
        <Icon d={ICONS.back} size={16} strokeWidth={2} />
        {title.nameRu}
      </Link>
      <div className="flex flex-col gap-2">
        <PageTitle>Ручной поиск</PageTitle>
        <span className="text-[15px] text-muted">
          {title.nameRu} · {code(season, episode)}
          {episode !== undefined && (
            <>
              {' · '}
              <Link href={`/search/${tmdbId}?s=${season}`}>весь сезон</Link>
            </>
          )}
          {result.profileSource === 'default' && ' · без подписки — оценка по профилю по умолчанию'}
        </span>
      </div>
      {regular.length > 1 && (
        <nav aria-label="Сезоны" className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          {regular.map((s) => (
            <Link
              key={s.number}
              href={`/search/${tmdbId}?s=${s.number}`}
              className={`flex h-11 shrink-0 items-center rounded-[10px] px-4 text-sm no-underline ${s.number === season && episode === undefined ? 'bg-text text-bg hover:text-bg' : 'border border-line text-text-2 hover:text-text'}`}
            >
              Сезон {s.number}
            </Link>
          ))}
        </nav>
      )}
      <Results result={result} tmdbId={tmdbId} studios={studios} season={season} episode={episode} />
    </div>
  );
}

function Results({ result, tmdbId, studios, season, episode, movie = false }: { result: ManualResult; tmdbId: number; studios: { id: number; name: string }[]; season: number; episode?: number; movie?: boolean }) {
  return (
    <>
      {result.sources.length === 0 ? (
        <Card>
          <p className="m-0 text-[15px] text-muted">
            Источников нет. <Link href="/settings/sources">Добавьте Jackett или Prowlarr</Link> в настройках.
          </p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" aria-label="Источники">
            {result.sources.map((s) => (
              <span key={s.sourceId} className={`rounded-lg px-2.5 py-1.5 text-[13px] ${s.ok ? 'bg-surface-2 text-text-3' : 'bg-danger-bg text-danger'}`}>
                {s.name} · {s.ok ? `${s.found} · ${String(Math.round(s.ms / 100) / 10).replace('.', ',')} с` : s.error}
              </span>
            ))}
          </div>
          {result.rows.length === 0 ? (
            <Card>
              <p className="m-0 text-[15px] text-muted">{result.sources.some((s) => s.ok) ? 'Раздач не нашлось.' : 'Ни один источник не ответил.'}</p>
            </Card>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-line">
              <div className="hidden gap-3.5 bg-surface px-[18px] py-3 text-[11px] font-semibold tracking-[0.06em] text-faint uppercase lg:grid lg:grid-cols-[minmax(0,1fr)_170px_150px_80px_64px_190px_170px]">
                <span>Раздача</span>
                <span>Озвучка</span>
                <span>Качество</span>
                <span>Размер</span>
                <span>Сиды</span>
                <span>Вердикт</span>
                <span />
              </div>
              {result.rows.map((row) => (
                <Row key={row.release.id} row={row} tmdbId={tmdbId} studios={studios} season={season} episode={episode} movie={movie} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

async function MovieSearch({ tmdbId }: { tmdbId: number }) {
  const db = getDb();
  const { title } = await openMovie(db, getTmdb(db), tmdbId);
  const result = await runManualMovieSearch(db, tmdbId, { today: todayIso() });
  return (
    <div className="flex flex-col gap-6">
      <Link href={`/movie/${tmdbId}`} className="flex min-h-11 items-center gap-1 self-start text-sm text-muted no-underline hover:text-text-2">
        <Icon d={ICONS.back} size={16} strokeWidth={2} />
        {title.nameRu}
      </Link>
      <div className="flex flex-col gap-2">
        <PageTitle>Ручной поиск</PageTitle>
        <span className="text-[15px] text-muted">
          {title.nameRu}
          {title.year ? ` · ${title.year}` : ''}
          {result.profileSource === 'default' && ' · без подписки — оценка по профилю фильмов по умолчанию'}
        </span>
      </div>
      <Results result={result} tmdbId={tmdbId} studios={[]} season={0} movie />
    </div>
  );
}
