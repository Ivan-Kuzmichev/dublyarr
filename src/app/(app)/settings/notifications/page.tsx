import { desc } from 'drizzle-orm';
import { SectionHeader, Card } from '@/components/ui/Card';
import { getDb } from '@/lib/db/client';
import { notifications } from '@/lib/db/schema';
import { getTelegramSettings } from '@/lib/telegram';
import { getTmdbSettings } from '@/lib/tmdb';
import { getEvents } from '@/lib/notify';
import { TelegramCard } from './TelegramCard';
import { EventsCard } from './EventsCard';

export const metadata = { title: 'Уведомления · Dublyarr' };
export const dynamic = 'force-dynamic';

const when = (ms: number) => new Date(ms).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function NotificationsPage() {
  const db = getDb();
  const s = getTelegramSettings(db);
  const recent = db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(10).all();
  return (
    <>
      <SectionHeader title="Уведомления" description="Сообщения в Telegram о новых сериях, проблемах и вопросах." />
      <TelegramCard hasToken={!!s?.token} chatId={s?.chatId ?? ''} proxy={s?.proxy ?? ''} baseUrl={s?.baseUrl ?? ''} tmdbProxy={!!getTmdbSettings(db)?.proxy} />
      <EventsCard value={getEvents(db)} />
      {recent.length > 0 && (
        <Card className="flex min-w-0 flex-col gap-3">
          <h3 className="m-0 text-base font-semibold">Последние сообщения</h3>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {recent.map((n) => (
              <li key={n.id} className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
                <span className="truncate text-text-2">{n.text.split('\n')[0]}</span>
                <span className={`shrink-0 text-xs ${n.error ? 'text-danger' : n.sentAt ? 'text-faint' : 'text-accent'}`}>
                  {n.error ? n.error : n.sentAt ? when(n.sentAt) : 'в очереди'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
