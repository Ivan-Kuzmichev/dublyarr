import Link from 'next/link';
import { Card, SectionHeader } from '@/components/ui/Card';
import { getDb } from '@/lib/db/client';
import { getSetting } from '@/lib/settings';
import { getLayaSettings } from '@/lib/laya/settings';
import { layaHealthInfo } from '@/lib/laya/health';
import { exampleStats } from '@/lib/laya/examples';
import { LayaForm, LayaStatus } from './LayaForm';
import { HeadsCard } from './HeadsCard';
import { headsAvailable, headsEnabled } from '@/lib/laya/heads';
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
  const sub = [STATUS[h.status ?? ''] ?? 'Нет данных', bench ? `в среднем ${String(Math.round(bench.mean / 100) / 10).replace('.', ',')} с на вопрос` : null, h.status === 'error' ? h.error : null].filter(Boolean).join(' · ');
  return (
    <>
      <SectionHeader title="AI · Laya" description="Локальная модель решений: выбирает из вариантов и отвечает «да/нет» с уверенностью. Текст не пишет, поэтому ничего не выдумывает. Без неё всё работает на словаре и правилах." />
      <LayaStatus ok={h.status === 'ready'} title="Laya работает внутри Dublyarr" sub={sub} />
      <Card className="flex min-w-0 flex-wrap items-center justify-between gap-4">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-[15px] font-semibold">Примеры</span>
          <span className="text-[13px] text-muted">Каждое «Это он», «Не тот сериал» и «Назначить студию» сохраняется — на них дообучается модель следующих версий. Накоплено {stats.total}.</span>
        </span>
        <Link href="/settings/ai/examples" className="flex h-11 items-center rounded-[11px] border border-line-strong px-4 text-sm text-text no-underline hover:text-text">
          Примеры
        </Link>
      </Card>
      <HeadsCard on={headsEnabled(getConfig().dataDir)} active={/\+(heads|probe)-/.test(h.model ?? '')} available={headsAvailable(getConfig().dataDir)} />
      <LayaForm value={getLayaSettings(db)} />
    </>
  );
}
