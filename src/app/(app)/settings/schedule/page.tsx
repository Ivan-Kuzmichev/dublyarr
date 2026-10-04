import { SectionHeader } from '@/components/ui/Card';
import { getDb } from '@/lib/db/client';
import { subscriptions } from '@/lib/db/schema';
import { getSchedule, getSpeed, nextSearchAt, speedSummary } from '@/lib/schedule';
import { eagerTitles } from '@/lib/forecast';
import { ScheduleForm } from './ScheduleForm';
import { SpeedGrid } from './SpeedGrid';
import { requirePage } from '@/lib/auth/current';

export const metadata = { title: 'Расписание · Dublyarr' };
export const dynamic = 'force-dynamic';

const hhmm = (d: Date) => d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

function nextLabel(db: ReturnType<typeof getDb>, now: Date) {
  const subs = db.select({ last: subscriptions.lastSearchedAt }).from(subscriptions).all();
  if (!subs.length) return 'подписок пока нет';
  const oldest = subs.some((s) => s.last === null) ? null : Math.min(...subs.map((s) => s.last!));
  const next = nextSearchAt({ lastSearchedAt: oldest, now, settings: getSchedule(db) });
  if (next.getTime() - now.getTime() < 5 * 60_000) return 'следующая проверка — в ближайшие минуты';
  const sameDay = next.toDateString() === now.toDateString();
  return `следующая проверка ${sameDay ? '' : 'завтра '}в ${hhmm(next)}`;
}

export default async function SchedulePage() {
  await requirePage('admin');
  const db = getDb();
  const now = new Date();
  const speed = getSpeed(db);
  return (
    <>
      <SectionHeader title="Расписание" description="Когда искать новые серии и когда качать." />
      <ScheduleForm value={getSchedule(db)} next={nextLabel(db, now)} eagerCount={eagerTitles(db, now.toLocaleDateString('sv-SE')).size} />
      <SpeedGrid value={speed} summary={speedSummary(speed, now)} />
    </>
  );
}
