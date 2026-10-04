import path from 'node:path';
import { PageTitle } from '@/components/shell/PageTitle';
import { Card } from '@/components/ui/Card';
import { getDb } from '@/lib/db/client';
import { getSetting } from '@/lib/settings';
import { getQbit } from '@/lib/qbit';
import { pendingCleanup } from '@/lib/cleanup';
import type { Paths } from '@/lib/downloads';
import { plural } from '@/lib/plural';
import { CleanupForm } from './CleanupForm';
import { requirePage } from '@/lib/auth/current';

export const metadata = { title: 'Уборка загрузок · Dublyarr' };
export const dynamic = 'force-dynamic';

/** Что ждёт подтверждения; null — qBittorrent недоступен или не настроен. */
async function loadPending() {
  const db = getDb();
  const qbit = getQbit(db);
  const paths = getSetting<Paths>(db, 'paths');
  if (!qbit || !paths) return null;
  return pendingCleanup(db, qbit, paths, Date.now()).catch(() => null);
}

export default async function CleanupPage() {
  await requirePage('storage');
  const items = await loadPending();
  const rows = (items ?? []).map((i) =>
    i.kind === 'torrent'
      ? { key: i.key, title: `${i.title} · ${i.name}`, detail: `${i.reason} · ${i.files.length} ${plural(i.files.length, 'файл', 'файла', 'файлов')}`, size: i.size }
      : { key: i.key, title: path.basename(i.path), detail: 'Брошенный файл в папке загрузок', size: i.size },
  );
  return (
    <div className="flex max-w-[760px] flex-col gap-6">
      <div className="flex flex-col gap-2.5">
        <span className="text-sm text-muted">Уборка в qBittorrent · первое срабатывание</span>
        <PageTitle>Уборка загрузок</PageTitle>
      </div>
      {items === null ? (
        <Card tone="danger">
          <p className="m-0 text-[15px] text-text-2">qBittorrent не отвечает или не настроен — список собрать не удалось.</p>
        </Card>
      ) : rows.length ? (
        <CleanupForm rows={rows} />
      ) : (
        <Card>
          <p className="m-0 text-[15px] text-muted">Убирать нечего.</p>
        </Card>
      )}
    </div>
  );
}
