import { inArray } from 'drizzle-orm';
import type { Db } from './db/client';
import { downloads, titles } from './db/schema';
import type { Qbit } from './qbit';
import { CATEGORY } from './downloads';

// Сверка Dublyarr ↔ qBittorrent: «Диагностика» и GET /api/v1/qbit/reconcile.

export type ReconcileProblem = 'missing' | 'stopped' | 'files-off';
export type ReconcileRow = {
  id: number;
  title: string;
  name: string;
  state: string;
  qbitState: string | null;
  progress: number;
  filesOn: number;
  filesTotal: number;
  problem: ReconcileProblem | null;
};

const LIVE = ['adding', 'downloading', 'paused', 'stalled', 'completed'] as const;

export async function reconcile(db: Db, qbit: Qbit): Promise<ReconcileRow[]> {
  const rows = db.select().from(downloads).where(inArray(downloads.state, [...LIVE])).orderBy(downloads.id).all();
  const names = new Map(db.select({ id: titles.id, name: titles.nameRu }).from(titles).all().map((t) => [t.id, t.name]));
  const byHash = new Map((await qbit.list(CATEGORY)).map((t) => [t.hash, t]));
  const out: ReconcileRow[] = [];
  for (const d of rows) {
    const t = byHash.get(d.hash);
    const files = t ? await qbit.files(d.hash) : [];
    const on = files.filter((f) => f.priority > 0).length;
    const stopped = !!t && /^(stopped|paused)/i.test(t.state);
    const problem: ReconcileProblem | null = !t
      ? 'missing'
      : (d.kind === 'pack' || d.kind === 'movie') && files.length > 0 && on === 0
        ? 'files-off'
        : stopped && (d.state === 'downloading' || d.state === 'stalled')
          ? 'stopped'
          : null;
    out.push({ id: d.id, title: names.get(d.titleId) ?? '', name: d.name, state: d.state, qbitState: t?.state ?? null, progress: t?.progress ?? d.progress, filesOn: on, filesTotal: files.length, problem });
  }
  return out;
}
