import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Icon, ICONS } from '@/components/ui/Icon';
import { getDb } from '@/lib/db/client';
import { getLayaSettings } from '@/lib/laya/settings';
import { trainingData } from '@/lib/laya/training-data';
import { deleteExampleAction, rollbackAction } from '../actions';
import { TrainNow } from './TrainNow';
import { requirePage } from '@/lib/auth/current';

export const metadata = { title: 'Дообучение Laya · Dublyarr' };
export const dynamic = 'force-dynamic';

const RULES = [
  { title: 'Автоматически ночью', sub: 'Если накопилось 30 новых примеров — в ночное окно из «Расписания»' },
  { title: 'Применять, только если не хуже', sub: 'Новая версия проверяется на 20 % примеров, которые не видела при обучении' },
  { title: 'Хранить 3 последние версии', sub: 'Чтобы можно было вернуть прошлую, если стало хуже' },
];

export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ wrong?: string }> }) {
  await requirePage('admin');
  const { wrong } = await searchParams;
  const db = getDb();
  const d = trainingData(db);
  const threshold = Math.round(getLayaSettings(db).threshold * 100);
  const shown = wrong ? d.examples.filter((e) => e.wrong) : d.examples;
  const wrongCount = d.examples.filter((e) => e.wrong).length;
  return (
    <>
      <div className="flex flex-col gap-2">
        <Link href="/settings/ai" className="flex min-h-11 items-center gap-1 self-start text-sm text-muted no-underline hover:text-text-2">
          <Icon d={ICONS.back} size={16} strokeWidth={2} />
          Настройки · AI
        </Link>
        <h2 className="m-0 text-2xl font-semibold">Дообучение Laya</h2>
        <p className="m-0 text-sm text-muted">Модель учится на ваших ответах. Обучение идёт в фоне и не мешает загрузкам.</p>
      </div>
      <Card className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-text-2">{d.lastTrain ?? 'Обучения ещё не было'}</span>
        <TrainNow />
      </Card>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="m-0 text-base font-semibold">Точность по задачам</h3>
              <span className="text-[13px] text-faint">{d.versions.find((v) => v.current)?.name.toLowerCase() ?? 'базовая'}</span>
            </div>
            {d.tasks.map((t) => (
              <div key={t.task} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-t border-line-soft pt-3 sm:grid-cols-[minmax(0,1fr)_70px_80px_90px]">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium">{t.name}</span>
                  <span className={`text-xs ${t.low ? 'text-accent' : 'text-faint'}`}>{t.note}</span>
                </span>
                <span className="font-mono text-[13px] text-text-3 sm:text-right">{t.n} прим.</span>
                <span className="font-mono text-[13px] text-text-2 sm:text-right">{t.accuracy}</span>
                <span className="font-mono text-[13px] text-muted sm:text-right">{t.auto}</span>
              </div>
            ))}
            <span className="text-xs text-faint">Колонки: примеров · точность · «решает сама» — доля решений выше порога {threshold} %, которые не пришлось подтверждать.</span>
          </Card>
          <Card className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="m-0 text-base font-semibold">
                Ваши ответы <span className="text-sm font-normal text-faint">· {d.newCount} новых</span>
              </h3>
              <div className="flex gap-1 rounded-[10px] bg-surface-2 p-1 text-[13px]">
                <Link href="/settings/ai/training" className={`flex h-11 items-center rounded-[7px] px-3 no-underline ${!wrong ? 'bg-text font-semibold text-bg hover:text-bg' : 'text-muted'}`}>
                  Все
                </Link>
                <Link href="/settings/ai/training?wrong=1" className={`flex h-11 items-center rounded-[7px] px-3 no-underline ${wrong ? 'bg-text font-semibold text-bg hover:text-bg' : 'text-muted'}`}>
                  Где ошиблась · {wrongCount}
                </Link>
              </div>
            </div>
            {shown.length === 0 ? (
              <span className="text-sm text-faint">Пока нет. Отвечайте «Это он» / «Не тот сериал» в ручном поиске и Telegram — здесь появятся примеры.</span>
            ) : (
              shown.map((e) => (
                <div key={e.id} className="grid grid-cols-[minmax(0,1fr)_44px] items-center gap-3 border-t border-line-soft pt-3 sm:grid-cols-[minmax(0,1fr)_130px_130px_44px]">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-mono text-xs text-text">{e.title}</span>
                    <span className="text-xs text-faint">{e.question}</span>
                  </span>
                  <span className="order-3 flex flex-col gap-0.5 sm:order-none">
                    <span className="text-[11px] text-faint">Laya думала</span>
                    <span className={`text-[13px] ${e.wrong ? 'text-danger' : 'text-text-3'}`}>{e.model}</span>
                  </span>
                  <span className="order-4 flex flex-col gap-0.5 sm:order-none">
                    <span className="text-[11px] text-faint">вы ответили</span>
                    <span className="text-[13px] text-text-2">{e.you}</span>
                  </span>
                  <form action={deleteExampleAction} className="order-2 sm:order-none">
                    <input type="hidden" name="id" value={e.id} />
                    <button type="submit" aria-label="Убрать пример" className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-faint hover:bg-surface-2 hover:text-text">
                      <Icon d="M6 6l12 12M18 6L6 18" size={14} />
                    </button>
                  </form>
                </div>
              ))
            )}
          </Card>
        </div>
        <aside className="flex min-w-0 flex-col gap-5">
          <Card className="flex min-w-0 flex-col gap-3">
            <h3 className="m-0 text-base font-semibold">Версии модели</h3>
            {d.versions.map((v) => (
              <form key={String(v.id)} action={rollbackAction} className="flex items-center justify-between gap-3 border-t border-line-soft pt-3 first-of-type:border-t-0 first-of-type:pt-0">
                <input type="hidden" name="version" value={String(v.id)} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium">
                    {v.name}
                    {v.current && <span className="ml-2 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-accent">сейчас</span>}
                  </span>
                  <span className="text-xs text-faint">{v.meta}</span>
                </span>
                {v.canRollback && (
                  <button type="submit" className="h-11 cursor-pointer rounded-[10px] border border-line-strong px-3 text-[13px] text-text-2 hover:text-text">
                    Вернуть
                  </button>
                )}
              </form>
            ))}
          </Card>
          <Card className="flex min-w-0 flex-col gap-3">
            <h3 className="m-0 text-base font-semibold">Правила</h3>
            {RULES.map((r) => (
              <span key={r.title} className="flex flex-col gap-0.5">
                <span className="text-sm text-text-2">✓ {r.title}</span>
                <span className="text-xs text-faint">{r.sub}</span>
              </span>
            ))}
          </Card>
        </aside>
      </div>
    </>
  );
}
