import { desc, eq } from 'drizzle-orm';
import { SectionHeader, Card } from '@/components/ui/Card';
import { getDb } from '@/lib/db/client';
import { episodeFiles, titles } from '@/lib/db/schema';
import { getProcessing } from '@/lib/media/tracks';
import { systemRunner } from '@/lib/media/runner';
import { formatSize } from '@/lib/format';
import { ProcessingForm } from './ProcessingForm';
import { requirePage } from '@/lib/auth/current';

export const metadata = { title: 'Обработка файлов · Dublyarr' };
export const dynamic = 'force-dynamic';

const pad = (n: number) => String(n).padStart(2, '0');

function Tracks({ label, items }: { label: string; items: { kind: string; name: string; flag?: string }[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-semibold tracking-[0.06em] text-faint uppercase">{label}</span>
      {items.map((t, i) => (
        <div key={i} className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-baseline gap-2 text-[13px]">
          <span className="text-faint">{t.kind}</span>
          <span className="truncate font-mono text-text-2">{t.name}</span>
          <span className="text-xs text-accent">{t.flag ?? ''}</span>
        </div>
      ))}
    </div>
  );
}

export default async function FilesPage() {
  await requirePage('admin');
  const db = getDb();
  const avail = await systemRunner.available();
  const last = db
    .select({ f: episodeFiles, title: titles.nameRu })
    .from(episodeFiles)
    .innerJoin(titles, eq(titles.id, episodeFiles.titleId))
    .where(eq(episodeFiles.processed, true))
    .orderBy(desc(episodeFiles.importedAt))
    .limit(1)
    .get();
  return (
    <>
      <SectionHeader
        title="Обработка файлов"
        description="После скачивания Dublyarr пересобирает mkv без перекодирования: меняет только набор и порядок дорожек. Качество не страдает."
      />
      {!(avail.ffprobe && avail.mkvmerge) && (
        <Card tone="danger">
          <p className="m-0 text-[15px] text-text-2">
            Обработка недоступна: нет {[!avail.ffprobe && 'ffprobe', !avail.mkvmerge && 'mkvmerge'].filter(Boolean).join(' и ')}. Серии кладутся в медиатеку как есть.
          </p>
        </Card>
      )}
      <ProcessingForm value={getProcessing(db)} />
      {last?.f.tracks && (
        <Card className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="m-0 text-base font-semibold">
              Пример · {last.title} S{pad(last.f.season)}E{pad(last.f.number)}
            </h3>
            <span className="font-mono text-[13px] text-muted">{formatSize(last.f.size)}</span>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <Tracks label="В раздаче" items={last.f.tracks.before} />
            <Tracks label="В библиотеке" items={last.f.tracks.after} />
          </div>
          <p className="m-0 text-[13px] text-faint">
            Пока торрент раздаётся, исходный файл лежит в папке загрузок. Если позже выйдет озвучка выше по приоритету, серия пересоберётся из новой раздачи.
          </p>
        </Card>
      )}
    </>
  );
}
