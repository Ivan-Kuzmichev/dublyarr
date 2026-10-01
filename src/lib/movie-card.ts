import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from './db/client';
import { downloads, episodeFiles, subscriptions, wantedState, type Title } from './db/schema';
import { isMovieProfile } from './movie-profile';
import { digitalReleased } from './movies';
import { formatShortDate } from './dates';
import { formatSize } from './format';

// Карточка фильма: лента «Кинотеатры → Цифровой релиз → Дубляж → В медиатеке», файл и статус для библиотеки.

export type MovieStep = { key: 'theatrical' | 'digital' | 'dub' | 'file'; title: string; date: string | null; state: 'done' | 'forecast' | 'wait' | 'none'; sub: string };
const ACTIVE = ['adding', 'downloading', 'paused', 'stalled', 'completed'] as const;

export function movieCard(db: Db, t: Title, today: string) {
  const sub = db.select().from(subscriptions).where(eq(subscriptions.titleId, t.id)).get();
  const profile = sub && isMovieProfile(sub.profile) ? sub.profile : null;
  const file = db.select().from(episodeFiles).where(and(eq(episodeFiles.titleId, t.id), eq(episodeFiles.season, 0), eq(episodeFiles.number, 0))).get();
  const wanted = db.select().from(wantedState).where(and(eq(wantedState.titleId, t.id), eq(wantedState.season, 0), eq(wantedState.number, 0))).get();
  const active = db
    .select()
    .from(downloads)
    .where(and(eq(downloads.titleId, t.id), inArray(downloads.state, [...ACTIVE])))
    .get();
  const short = (d: string) => formatShortDate(d, today);
  const isDub = (pos: number | null | undefined) => pos !== null && pos !== undefined && (profile ? profile.dubs[pos]?.kind === 'dub' : pos === 0);

  const th = t.releaseDates?.theatrical ?? null;
  const digital = digitalReleased(t, today);
  const futureDigital = t.releaseDates?.digital && t.releaseDates.digital > today ? t.releaseDates.digital : null;
  const pct = active ? `${Math.round((active.progress ?? 0) * 100)} %` : '';
  const fileLine = file ? [file.studioLabel, file.resolution ? `${file.resolution}p` : null, formatSize(file.size)].filter(Boolean).join(' · ') : '';

  const dub: MovieStep = file && isDub(file.dubPosition)
    ? { key: 'dub', title: 'Дубляж', date: null, state: 'done', sub: 'есть' }
    : active && isDub(active.dubPosition)
      ? { key: 'dub', title: 'Дубляж', date: null, state: 'wait', sub: 'качается' }
      : wanted?.until
        ? { key: 'dub', title: 'Дубляж', date: wanted.until, state: 'forecast', sub: `ждём до ${short(wanted.until)}` }
        : file && profile?.replaceWithDub
          ? { key: 'dub', title: 'Дубляж', date: null, state: 'wait', sub: 'заменим, когда выйдет' }
          : { key: 'dub', title: 'Дубляж', date: null, state: 'none', sub: '—' };

  const steps: MovieStep[] = [
    { key: 'theatrical', title: 'Кинотеатры', date: th, state: th ? (th <= today ? 'done' : 'wait') : 'none', sub: th ? short(th) : 'нет даты' },
    digital
      ? { key: 'digital', title: 'Цифровой релиз', date: digital, state: 'done', sub: short(digital) }
      : { key: 'digital', title: 'Цифровой релиз', date: futureDigital, state: futureDigital ? 'wait' : 'none', sub: futureDigital ? `ожидается ${short(futureDigital)}` : 'ещё нет' },
    dub,
    file
      ? { key: 'file', title: 'В медиатеке', date: null, state: 'done', sub: fileLine }
      : active
        ? { key: 'file', title: 'В медиатеке', date: null, state: 'wait', sub: `качается · ${pct}` }
        : { key: 'file', title: 'В медиатеке', date: null, state: 'none', sub: 'ещё нет' },
  ];
  const status = file ? fileLine : active ? `Качается · ${pct}` : sub && wanted ? wanted.reason : '';
  return {
    steps,
    file: file ? { dub: file.studioLabel ?? '—', quality: file.resolution ? `${file.resolution}p` : '—', hdr: file.hdr, size: file.size, processed: file.processed } : null,
    status,
  };
}
