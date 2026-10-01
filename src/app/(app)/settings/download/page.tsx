import { SectionHeader, Card, CardTitle } from '@/components/ui/Card';
import { getDb } from '@/lib/db/client';
import { getSetting, tryGetSecretSetting } from '@/lib/settings';
import { serviceStatuses } from '@/lib/heartbeat';
import { DEFAULT_TEMPLATE, renderTemplate } from '@/lib/library-path';
import type { Paths } from '@/lib/downloads';
import type { QbitConfig } from '@/lib/integrations/qbittorrent';
import { QbitCard } from './QbitCard';
import { PathsCard } from './PathsCard';
import { CleanupCard } from './CleanupCard';
import { getCleanup } from '@/lib/cleanup';

export const metadata = { title: 'Загрузка и папки · Dublyarr' };
export const dynamic = 'force-dynamic';

const STEPS = [
  ['Текущая раздача', 'Серия уже есть в качающемся паке — Dublyarr включает её файл, нового торрента не добавляет.'],
  ['Отдельная серия', 'Раздача одной серии в нужной озвучке и качестве — предпочтительна.'],
  ['Пак сезона', 'Добавляется на паузе, остальным файлам — «не качать», затем запуск.'],
];

function example(template: string) {
  try {
    return renderTemplate(template, { name: 'Игра престолов', original: 'Game of Thrones', year: 2011, season: 1, episode: 3, studio: 'LostFilm', quality: '1080p' }, '.mkv');
  } catch {
    return '—';
  }
}

export default function DownloadSettingsPage() {
  const db = getDb();
  const qbit = tryGetSecretSetting<QbitConfig>(db, 'qbittorrent');
  const paths = getSetting<Paths>(db, 'paths');
  const st = serviceStatuses(db).find((s) => s.name === 'qBittorrent')!;
  const status = !qbit ? { text: 'не подключён', tone: 'off' as const } : { text: st.state === 'ok' ? `подключён · ${st.note}` : st.note, tone: st.state };
  const template = paths?.template ?? DEFAULT_TEMPLATE;
  return (
    <>
      <SectionHeader title="Загрузка и папки" description="qBittorrent, куда он качает и куда Dublyarr кладёт готовые серии." />
      <QbitCard url={qbit?.url ?? ''} username={qbit?.username ?? 'admin'} hasPassword={!!qbit?.password} status={status} />
      <PathsCard
        qbitDownloads={paths?.qbitDownloads ?? ''}
        downloads={paths?.downloads ?? ''}
        media={paths?.media ?? ''}
        template={template}
        example={example(template)}
        defaultTemplate={DEFAULT_TEMPLATE}
      />
      <Card className="flex flex-col gap-4">
        <CardTitle>Как качается серия</CardTitle>
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {STEPS.map(([title, sub], i) => (
            <li key={title} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono text-xs text-accent">{i + 1}</span>
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{title}</span>
                <span className="text-[13px] text-faint">{sub}</span>
              </span>
            </li>
          ))}
        </ol>
      </Card>
      <CleanupCard value={getCleanup(db)} />
    </>
  );
}
