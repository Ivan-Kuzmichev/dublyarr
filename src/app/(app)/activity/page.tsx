import Link from 'next/link';
import { PageTitle } from '@/components/shell/PageTitle';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { getDb } from '@/lib/db/client';
import { activityQueue, type QueueRow } from '@/lib/activity';
import { getQbit } from '@/lib/qbit';
import { jobs } from '@/lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { pauseAction, removeAction, resumeAction, searchNowAction } from './actions';

export const metadata = { title: 'Активность · Dublyarr' };
export const dynamic = 'force-dynamic';

const BAR: Record<QueueRow['tone'], string> = { progress: 'bg-progress', danger: 'bg-danger', ok: 'bg-text-2', muted: 'bg-dim' };
const TEXT: Record<QueueRow['tone'], string> = { progress: 'text-progress', danger: 'text-danger', ok: 'text-muted', muted: 'text-muted' };

function Row({ r }: { r: QueueRow }) {
  const btn = 'h-11 cursor-pointer rounded-[10px] border border-line-strong px-3 text-[13px] text-text-2 hover:text-text';
  return (
    <div className="flex flex-col gap-2 border-t border-line-soft px-4 py-3.5 first:border-t-0 lg:px-[18px]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Link href={`/series/${r.tmdbId}`} className="text-[15px] font-semibold text-text no-underline hover:text-accent">
          {r.title} · {r.code}
        </Link>
        <span className="font-mono text-[13px] text-text-3">{r.speed}</span>
      </div>
      <span className="truncate font-mono text-xs text-faint">{r.release}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-line">
        <div className={`h-full ${BAR[r.tone]}`} style={{ width: `${r.pct}%` }} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`text-[13px] ${TEXT[r.tone]}`}>{r.state}</span>
        <form className="flex gap-2">
          <input type="hidden" name="id" value={r.id} />
          {r.canPause && (
            <button formAction={pauseAction} className={btn}>
              Пауза
            </button>
          )}
          {r.canResume && (
            <button formAction={resumeAction} className={btn}>
              Продолжить
            </button>
          )}
          {r.canRemove && (
            <button formAction={removeAction} className="h-11 cursor-pointer rounded-[10px] px-2 text-[13px] text-faint hover:text-danger" title="Торрент уберётся из qBittorrent, файлы останутся">
              Убрать из клиента
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

function searchQueued() {
  const db = getDb();
  return !!db
    .select()
    .from(jobs)
    .where(and(eq(jobs.type, 'subscriptions.search'), inArray(jobs.status, ['queued', 'running'])))
    .get();
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const db = getDb();
  const queue = activityQueue(db);
  const qbit = !!getQbit(db);
  const searching = searchQueued();
  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle>Активность</PageTitle>
        <form action={searchNowAction}>
          <Button type="submit" variant="secondary" disabled={searching}>
            {searching ? 'Поиск идёт…' : 'Искать сейчас'}
          </Button>
        </form>
      </div>
      {error && (
        <Card tone="danger">
          <p role="alert" className="m-0 text-[15px] text-danger">
            {error.slice(0, 200)}
          </p>
        </Card>
      )}
      {!qbit && (
        <Card tone="danger">
          <p className="m-0 text-[15px] text-text-2">
            qBittorrent не подключён — Dublyarr находит серии, но не качает. <Link href="/settings/download">Подключить</Link>
          </p>
        </Card>
      )}
      <section className="flex flex-col gap-3">
        <h2 className="m-0 text-xl font-semibold">Загрузки</h2>
        {queue.length === 0 ? (
          <Card>
            <p className="m-0 text-[15px] text-muted">Сейчас ничего не качается. Новые серии подписок Dublyarr ищет раз в час.</p>
          </Card>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            {queue.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
