import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Icon, ICONS } from '@/components/ui/Icon';
import { getDb } from '@/lib/db/client';
import { examplesData } from '@/lib/laya/examples-view';
import { deleteExampleAction } from '../actions';
import { requirePage } from '@/lib/auth/current';

export const metadata = { title: 'Примеры Laya · Dublyarr' };
export const dynamic = 'force-dynamic';

export default async function ExamplesPage({ searchParams }: { searchParams: Promise<{ wrong?: string }> }) {
  await requirePage('admin');
  const { wrong } = await searchParams;
  const d = examplesData(getDb(), { wrong: !!wrong });
  return (
    <>
      <div className="flex flex-col gap-2">
        <Link href="/settings/ai" className="flex min-h-11 items-center gap-1 self-start text-sm text-muted no-underline hover:text-text-2">
          <Icon d={ICONS.back} size={16} strokeWidth={2} />
          Настройки · AI
        </Link>
        <h2 className="m-0 text-2xl font-semibold">Примеры</h2>
        <p className="m-0 text-sm text-muted">
          Ваши ответы Laya: «Это он», «Не тот сериал», «Назначить студию», кнопки в Telegram. По ним дообучается модель для следующих версий Dublyarr — на NAS обучение не идёт.
          Ошибочный ответ можно убрать.
        </p>
      </div>
      <Card className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="m-0 text-base font-semibold">По задачам</h3>
          <span className="text-[13px] text-faint">всего {d.total}</span>
        </div>
        {d.tasks.map((t) => (
          <div key={t.task} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 border-t border-line-soft pt-3">
            <span className="min-w-0 text-sm font-medium">{t.name}</span>
            <span className="font-mono text-[13px] text-text-2">{t.n} прим.</span>
            <span className={`font-mono text-[13px] ${t.wrong ? 'text-danger' : 'text-faint'}`}>ошиблась {t.wrong}</span>
          </div>
        ))}
      </Card>
      <Card className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="m-0 text-base font-semibold">Ваши ответы</h3>
          <div className="flex gap-1 rounded-[10px] bg-surface-2 p-1 text-[13px]">
            <Link href="/settings/ai/examples" className={`flex h-11 items-center rounded-[7px] px-3 no-underline ${!wrong ? 'bg-text font-semibold text-bg hover:text-bg' : 'text-muted'}`}>
              Все
            </Link>
            <Link href="/settings/ai/examples?wrong=1" className={`flex h-11 items-center rounded-[7px] px-3 no-underline ${wrong ? 'bg-text font-semibold text-bg hover:text-bg' : 'text-muted'}`}>
              Где ошиблась · {d.wrongTotal}
            </Link>
          </div>
        </div>
        {d.examples.length === 0 ? (
          <span className="text-sm text-faint">Пока нет. Отвечайте «Это он» / «Не тот сериал» в ручном поиске и Telegram — здесь появятся примеры.</span>
        ) : (
          d.examples.map((e) => (
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
    </>
  );
}
