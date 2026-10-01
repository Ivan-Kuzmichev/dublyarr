import { existsSync } from 'node:fs';
import { Card, CardTitle, SectionHeader } from '@/components/ui/Card';
import { requireSession } from '@/lib/auth/current';
import { getDb } from '@/lib/db/client';
import { getQbit } from '@/lib/qbit';
import { getLogSettings } from '@/lib/log-settings';
import { LOG_AREAS } from '@/lib/log';
import { logDir, readLog, type LogLevel } from '@/lib/log-read';
import { reconcile, type ReconcileRow } from '@/lib/reconcile';
import { serviceStatuses } from '@/lib/heartbeat';
import { AREA_LABELS, jobsSummary } from '@/lib/diagnostics';
import { LogSettingsForm } from './LogSettingsForm';

export const metadata = { title: 'Диагностика · Dublyarr' };
export const dynamic = 'force-dynamic';

const PROBLEM: Record<NonNullable<ReconcileRow['problem']>, string> = { stopped: 'В клиенте остановлена', missing: 'Нет в клиенте', 'files-off': 'Все файлы выключены' };
const LEVEL_LABEL: Record<LogLevel, string> = { debug: 'подробно', info: 'обычно', warn: 'внимание', error: 'ошибка' };
const time = (ts: number) => new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const field = 'h-11 rounded-[10px] border border-line bg-surface-2 px-3 text-sm text-text';

async function reconcileRows() {
  const qbit = getQbit(getDb());
  if (!qbit) return { error: 'qBittorrent не подключён' };
  try {
    return { rows: await reconcile(getDb(), qbit) };
  } catch (e) {
    return { error: `qBittorrent не отвечает: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export default async function DiagnosticsPage({ searchParams }: { searchParams: Promise<{ level?: string; area?: string; q?: string }> }) {
  await requireSession();
  const db = getDb();
  const f = await searchParams;
  const level = (['debug', 'info', 'warn', 'error'] as const).find((l) => l === f.level);
  const area = LOG_AREAS.find((a) => a === f.area);
  const dir = logDir();
  const lines = existsSync(dir) ? readLog(dir, { level, area, q: f.q || undefined, lines: 500 }) : null;
  const rec = await reconcileRows();
  const jobs = jobsSummary(db);
  return (
    <>
      <SectionHeader title="Диагностика" description="Журнал, сверка с qBittorrent и задачи — чтобы понять, почему что-то не скачалось." />
      <LogSettingsForm value={getLogSettings(db)} areas={LOG_AREAS.map((a) => ({ id: a, label: AREA_LABELS[a] }))} />

      <Card className="flex min-w-0 flex-col gap-4">
        <CardTitle note={<a href="/api/logs/download" className="text-accent">Скачать логи</a>}>Журнал</CardTitle>
        <form method="get" className="flex flex-wrap gap-2">
          <select name="level" defaultValue={level ?? ''} aria-label="Уровень" className={field}>
            <option value="">Все уровни</option>
            <option value="info">Обычно и выше</option>
            <option value="warn">Предупреждения и ошибки</option>
            <option value="error">Только ошибки</option>
          </select>
          <select name="area" defaultValue={area ?? ''} aria-label="Область" className={field}>
            <option value="">Все области</option>
            {LOG_AREAS.map((a) => (
              <option key={a} value={a}>
                {AREA_LABELS[a]}
              </option>
            ))}
          </select>
          <input name="q" defaultValue={f.q ?? ''} placeholder="Текст, хэш, название" aria-label="Поиск по журналу" className={`${field} min-w-[180px] grow`} />
          <button type="submit" className="h-11 cursor-pointer rounded-[10px] border border-line-strong bg-transparent px-4 text-sm text-text">
            Показать
          </button>
        </form>
        {lines === null ? (
          <p className="m-0 text-sm text-muted">Журнал недоступен: нет каталога {dir}</p>
        ) : lines.length === 0 ? (
          <p className="m-0 text-sm text-muted">Записей нет</p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {lines.map((l, i) => (
              <li key={i} className="flex min-w-0 flex-col gap-1 border-b border-line-soft py-2 text-[13px]">
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-xs text-faint">{time(l.time)}</span>
                  <span className={l.level === 'warn' || l.level === 'error' ? 'text-danger' : 'text-muted'}>{LEVEL_LABEL[l.level]}</span>
                  <span className="text-muted">{AREA_LABELS[l.area as keyof typeof AREA_LABELS] ?? l.area}</span>
                  <span className="min-w-0 break-words text-text-2">{l.msg}</span>
                </span>
                {Object.keys(l.data).length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-xs text-faint">подробности</summary>
                    <pre className="m-0 overflow-x-auto font-mono text-xs whitespace-pre-wrap text-text-3">{JSON.stringify(l.data, null, 2)}</pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex min-w-0 flex-col gap-3">
        <CardTitle>Сверка с qBittorrent</CardTitle>
        {'error' in rec ? (
          <p className="m-0 text-sm text-muted">{rec.error}</p>
        ) : rec.rows.length === 0 ? (
          <p className="m-0 text-sm text-muted">Загрузок Dublyarr нет</p>
        ) : (
          <>
            {!rec.rows.some((r) => r.problem) && <p className="m-0 text-sm text-progress">Расхождений нет</p>}
            <ul className="m-0 flex list-none flex-col p-0">
              {rec.rows.map((r) => (
                <li key={r.id} className="flex min-w-0 flex-col gap-1 border-b border-line-soft py-2 text-[13px]">
                  <span className="truncate text-sm text-text">
                    {r.title} · <span className="font-mono text-xs text-text-3">{r.name}</span>
                  </span>
                  <span className="flex flex-wrap gap-x-3 text-muted">
                    <span>у нас: {r.state}</span>
                    <span>в клиенте: {r.qbitState ?? '—'}</span>
                    <span>
                      файлы: {r.filesOn}/{r.filesTotal}
                    </span>
                    <span>{Math.round(r.progress * 100)} %</span>
                    {r.problem && <span className="text-danger">{PROBLEM[r.problem]}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card className="flex min-w-0 flex-col gap-3">
        <CardTitle>Сервисы и задачи</CardTitle>
        <ul className="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 text-sm">
          {serviceStatuses(db).map((s) => (
            <li key={s.name} className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${s.state === 'ok' ? 'bg-progress' : s.state === 'warn' ? 'bg-danger' : 'bg-dim'}`} />
              {s.name} <span className="text-muted">· {s.note}</span>
            </li>
          ))}
        </ul>
        <ul className="m-0 flex list-none flex-col p-0">
          {jobs.map((j) => (
            <li key={j.type} className="flex flex-wrap items-baseline gap-x-3 border-b border-line-soft py-2 text-[13px]">
              <span className="font-mono text-xs text-text-2">{j.type}</span>
              <span className="text-muted">{j.lastDoneAt ? `последний запуск ${time(j.lastDoneAt)}` : 'ещё не выполнялась'}</span>
              {j.queued > 0 && <span className="text-muted">в очереди {j.queued}</span>}
              {j.lastError && <span className="min-w-0 break-words text-danger">{j.lastError}</span>}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
