import { eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { episodes, studioSightings } from './db/schema';
import { dubLabel, type Profile } from './profile-core';
import { addDays, formatShortDate } from './dates';
import { plural } from './plural';

// Задержка студии после эфира и прогноз озвучки (spec §9).

const DAY = 86_400_000;
const dayOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const daysBetween = (a: string, b: string) => Math.round((dayOf(a) - dayOf(b)) / DAY);
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export type StudioDelay = { studioId: number; days: number | null; count: number; basis: 'seen' | 'published' | 'packs' | 'none'; basisText: string };

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return Math.round(m * 2) / 2;
};

/** Медиана задержки по лучшему доступному классу наблюдений: отдельные серии «видели сами» → «по датам раздач» → паки. */
export function studioDelays(db: Db, titleId: number): Map<number, StudioDelay> {
  const air = new Map(
    db
      .select()
      .from(episodes)
      .where(eq(episodes.titleId, titleId))
      .all()
      .map((e) => [`${e.season}:${e.number}`, e.airDate]),
  );
  const out = new Map<number, StudioDelay>();
  const byStudio = new Map<number, { d: number; basis: 'seen' | 'published'; pack: boolean }[]>();
  for (const s of db.select().from(studioSightings).where(eq(studioSightings.titleId, titleId)).all()) {
    if (!byStudio.has(s.studioId)) byStudio.set(s.studioId, []);
    const a = air.get(`${s.season}:${s.number}`);
    if (!a) continue;
    const d = (s.seenAt - dayOf(a)) / DAY;
    if (d < 0) continue;
    byStudio.get(s.studioId)!.push({ d, basis: s.basis, pack: s.fromPack });
  }
  for (const [studioId, list] of byStudio) {
    const seen = list.filter((x) => !x.pack && x.basis === 'seen');
    const pub = list.filter((x) => !x.pack && x.basis === 'published');
    const packs = list.filter((x) => x.pack);
    const [cls, basis] = seen.length ? [seen, 'seen' as const] : pub.length ? [pub, 'published' as const] : packs.length ? [packs, 'packs' as const] : [[], 'none' as const];
    const count = cls.length;
    const basisText =
      basis === 'seen' ? `по ${count} ${plural(count, 'серии', 'сериям', 'сериям')}` : basis === 'published' ? '≈ по датам раздач' : basis === 'packs' ? 'только паки' : 'нет данных';
    out.set(studioId, { studioId, days: count ? median(cls.map((x) => x.d)) : null, count, basis, basisText });
  }
  return out;
}

const comma = (n: number) => String(n).replace('.', ',');

/** «в день эфира», «+1 день», «+1,5 дня», «+5 дней». */
export function formatDelay(days: number): string {
  if (days === 0) return 'в день эфира';
  if (!Number.isInteger(days)) return `+${comma(days)} дня`;
  return `+${days} ${plural(days, 'день', 'дня', 'дней')}`;
}

export type PositionForecast = { label: string; studioId: number | null; expected: string | null; observedDays: number | null; delay: StudioDelay | null };
export type EpisodeForecast = { positions: PositionForecast[]; eta: string | null; etaText: string; fallbackNote: string; progress: number | null; fallbackMark: number | null };

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS_GEN = ['воскресенья', 'понедельника', 'вторника', 'среды', 'четверга', 'пятницы', 'субботы'];
const clamp = (x: number) => Math.min(1, Math.max(0, x));

function etaText(eta: string | null, today: string) {
  if (!eta) return 'прогноза нет';
  const d = daysBetween(eta, today);
  if (d <= 0) return '≈ сегодня';
  if (d === 1) return '≈ завтра';
  const [, m, day] = eta.split('-').map(Number);
  return `≈ ${day} ${MONTHS_GEN[m - 1]}`;
}

/** «сегодня», «до завтра», «до пятницы» на ближайшую неделю, дальше — «до 9 окт». */
function until(date: string, today: string) {
  const d = daysBetween(date, today);
  if (d <= 0) return 'сегодня';
  if (d === 1) return 'до завтра';
  return `до ${d <= 6 ? WEEKDAYS_GEN[new Date(dayOf(date)).getUTCDay()] : formatShortDate(date, today)}`;
}

export function forecastEpisode(
  profile: Profile,
  ep: { season: number; number: number; airDate: string },
  delays: Map<number, StudioDelay>,
  sightings: { studioId: number; season: number; number: number; seenAt: number }[],
  studioName: (id: number) => string | undefined,
  today: string,
): EpisodeForecast {
  const positions: PositionForecast[] = profile.dubs.map((d) => {
    const label = dubLabel(d, studioName);
    if (d.kind !== 'studio') return { label, studioId: null, expected: null, observedDays: null, delay: null };
    const delay = delays.get(d.studioId) ?? null;
    const seen = sightings.find((s) => s.studioId === d.studioId && s.season === ep.season && s.number === ep.number);
    return {
      label,
      studioId: d.studioId,
      expected: delay?.days !== null && delay?.days !== undefined ? addDays(ep.airDate, Math.ceil(delay.days)) : null,
      observedDays: seen ? Math.max(0, daysBetween(isoOf(seen.seenAt), ep.airDate)) : null,
      delay,
    };
  });
  const eta = positions.find((p) => p.expected)?.expected ?? null;
  const span = eta ? daysBetween(eta, ep.airDate) : 0;
  const next = profile.dubs[1];
  const open = next ? addDays(ep.airDate, next.waitDays) : null;
  const first = positions[0]?.label ?? '';
  const fallbackNote = next
    ? `Если ${first} не выйдет ${until(open!, today)} — возьму ${next.kind === 'any' ? 'любую' : positions[1].label}${profile.replaceWithHigher ? ', потом заменю' : ''}.`
    : `Жду только ${first} — запасная озвучка не задана.`;
  return {
    positions,
    eta,
    etaText: etaText(eta, today),
    fallbackNote,
    progress: eta ? (span > 0 ? clamp(daysBetween(today, ep.airDate) / span) : 1) : null,
    fallbackMark: eta && open ? (span > 0 ? clamp(daysBetween(open, ep.airDate) / span) : 1) : null,
  };
}

/** Наблюдения сериала — для прогноза и колонок карточки. */
export const titleSightings = (db: Db, titleId: number) => db.select().from(studioSightings).where(eq(studioSightings.titleId, titleId)).all();
