// Даты эфира TMDB — строки YYYY-MM-DD без времени; сравниваем и считаем их как даты UTC.

const MONTHS = ['янв', 'февр', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сент', 'окт', 'нояб', 'дек'];
const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / DAY);

export function formatAirDate(date: string | null, today: string): string {
  if (!date) return '—';
  const diff = daysBetween(date, today);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  if (diff > 1 && diff <= 7) return `через ${diff} дн`;
  return formatShortDate(date, today);
}

/** «3 окт», другой год — «5 янв 2027». */
export function formatShortDate(date: string, today: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}${y !== Number(today.slice(0, 4)) ? ` ${y}` : ''}`;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);
}

/** Последний вышедший обычный сезон; если ни один не вышел — первый; спецвыпуски — только если больше ничего нет. */
export function pickDefaultSeason(seasons: { number: number; airDate: string | null }[], today: string): number {
  const regular = seasons.filter((s) => s.number > 0).sort((a, b) => a.number - b.number);
  const aired = regular.filter((s) => s.airDate && s.airDate <= today);
  return aired.at(-1)?.number ?? regular[0]?.number ?? 0;
}

/** Сегодняшняя дата YYYY-MM-DD по часовому поясу сервера (TZ контейнера). */
export const todayIso = () => new Date().toLocaleDateString('sv-SE');
