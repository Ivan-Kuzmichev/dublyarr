import Link from 'next/link';
import { Card, SectionHeader } from '@/components/ui/Card';
import { getDb } from '@/lib/db/client';
import { getSetting } from '@/lib/settings';
import { getLayaSettings, layaEnabled } from '@/lib/laya/settings';
import { layaHealthInfo } from '@/lib/laya/health';
import { exampleStats } from '@/lib/laya/examples';
import { LayaForm, LayaStatus } from './LayaForm';
import { headsAvailable } from '@/lib/laya/heads';
import { getConfig } from '@/lib/config';
import { requirePage } from '@/lib/auth/current';

export const metadata = { title: 'AI · Dublyarr' };
export const dynamic = 'force-dynamic';

const STATUS: Record<string, string> = { ready: 'Модель загружена', downloading: 'Скачивается модель (около 1 ГБ)', loading: 'Модель загружается', error: 'Модель недоступна' };

export default async function AiSettingsPage() {
  await requirePage('admin');
  const db = getDb();
  const h = layaHealthInfo(db) as { status?: string; runtime?: string; error?: string; model?: string };
  const bench = getSetting<{ mean: number }>(db, 'laya.bench');
  const stats = exampleStats(db);
  const on = layaEnabled(db);
  // дообученная Laya — всегда, если есть в образе или в {DATA_DIR}/laya (2.8)
  const tuned = /\+(heads|probe)-/.test(h.model ?? '') ? 'дообученная на ваших ответах' : null;
  const sub = [STATUS[h.status ?? ''] ?? 'Нет данных', h.status === 'ready' ? tuned : null, bench ? `в среднем ${String(Math.round(bench.mean / 100) / 10).replace('.', ',')} с на вопрос` : null, h.status === 'error' ? h.error : null].filter(Boolean).join(' · ');
  return (
    <>
      <SectionHeader title="AI · Laya" description="Локальная модель решений: выбирает из вариантов и отвечает «да/нет» с уверенностью. Текст не пишет, поэтому ничего не выдумывает. Без неё всё работает на словаре и правилах." />
      <LayaStatus on={on} ok={h.status === 'ready'} sub={sub} />
      {!on && (
        <p className="m-0 rounded-xl border border-dashed border-line px-4 py-3 text-[13px] text-muted">
          Разделы ниже не действуют, пока Laya выключена. Настройки сохранены — после включения всё вернётся как было.
        </p>
      )}
      <LayaForm value={getLayaSettings(db)} off={!on} />
      <Card className={`flex min-w-0 flex-wrap items-center justify-between gap-4 ${on ? '' : 'opacity-45'}`}>
        <span className="flex min-w-0 basis-60 grow flex-col gap-1">
          <span className="text-[15px] font-semibold">Примеры для дообучения</span>
          <span className="text-[13px] text-muted">
            Каждое «Это он», «Не тот сериал» и «Назначить студию» сохраняется — на них дообучается модель следующих версий.
            {headsAvailable(getConfig().dataDir) ? '' : ' В этой версии дообученной модели нет — работает базовая.'}
          </span>
        </span>
        <span className="flex items-center gap-4">
          <span className="flex flex-col items-center">
            <span className="font-display text-xl font-semibold">{stats.total}</span>
            <span className="text-[11px] text-faint">накоплено</span>
          </span>
          <Link href="/settings/ai/examples" className="flex h-11 items-center rounded-[11px] border border-line-strong px-4 text-sm text-text no-underline hover:text-text">
            Открыть
          </Link>
        </span>
      </Card>
    </>
  );
}
