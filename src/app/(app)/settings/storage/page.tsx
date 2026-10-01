import { SectionHeader } from '@/components/ui/Card';
import { getDb } from '@/lib/db/client';
import { getSetting } from '@/lib/settings';
import { getRetention, nextRetentionAt } from '@/lib/retention-settings';
import { retentionPlan } from '@/lib/retention';
import { diskUsage } from '@/lib/storage';
import { formatSize } from '@/lib/format';
import { todayIso } from '@/lib/dates';
import type { Paths } from '@/lib/downloads';
import { RetentionForm } from './RetentionForm';

export const metadata = { title: 'Хранение · Dublyarr' };
export const dynamic = 'force-dynamic';

async function load() {
  const db = getDb();
  const now = new Date();
  const settings = getRetention(db);
  const next = nextRetentionAt(settings.schedule, getSetting<number>(db, 'retention.lastRun') ?? null, now);
  const declined = new Set(getSetting<string[]>(db, 'retention.declined') ?? []);
  const freeable = retentionPlan(db, settings, now.getTime(), todayIso())
    .filter((i) => !declined.has(i.key))
    .reduce((n, i) => n + i.size, 0);
  const paths = getSetting<Paths>(db, 'paths');
  const disk = paths ? await diskUsage(paths.media) : null;
  const nextText = !next
    ? 'Только вручную'
    : next.getTime() - now.getTime() < 10 * 60_000
      ? 'Следующая — в ближайшие минуты'
      : `Следующая: ${next.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' })}, ${next.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  return { settings, nextText, freeable: formatSize(freeable), diskPct: disk?.pct ?? null };
}

export default async function StorageSettingsPage() {
  const d = await load();
  return (
    <>
      <SectionHeader title="Правила хранения" description="Что Dublyarr удаляет сам. Правила срабатывают во время уборки, а не сразу." />
      <RetentionForm value={d.settings} next={d.nextText} freeable={d.freeable} diskPct={d.diskPct} />
    </>
  );
}
