'use client';

import { useActionState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { myChatAction, type TgState } from './actions';

/** Свой чат Telegram: у каждой учётки свой Telegram ID (бот присылает его в ответ на /start). */
export function MyChatCard({ linked, chatId, bot }: { linked: boolean; chatId?: string | null; bot: boolean }) {
  const [state, action, pending] = useActionState<TgState, FormData>(myChatAction, {});
  return (
    <Card className="flex min-w-0 flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="m-0 text-base font-semibold">Мой чат</h3>
        <span className="text-[13px] text-muted">{linked ? 'привязан' : 'не привязан'}</span>
      </div>
      {!bot ? (
        <p className="m-0 text-sm text-muted">Бот Telegram ещё не настроен — это делает администратор.</p>
      ) : (
        <form action={action} className="flex flex-col gap-4">
          <p className="m-0 text-sm text-muted">Бот общий, у каждого свой Telegram ID. Напишите боту /start — он пришлёт ваш ID, впишите его сюда.</p>
          <div className="flex flex-col gap-1.5">
            {/* подсказка — под строкой, чтобы кнопка стояла вровень с полем */}
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Telegram ID" name="chatId" mono inputMode="numeric" defaultValue={chatId ?? ''} placeholder="например, 123456789" className="min-w-[200px] grow" />
              <Button type="submit" name="intent" value="set" variant="secondary" disabled={pending}>
                Сохранить ID
              </Button>
            </div>
            <span className="text-[13px] leading-[1.45] text-faint">ID — число из ответа бота на /start</span>
          </div>
          {state.error && (
            <p role="alert" className="m-0 text-sm text-danger">
              {state.error}
            </p>
          )}
          {state.ok && <p className="m-0 text-sm text-progress">{state.ok}</p>}
          {linked && (
            <div className="flex flex-wrap gap-3">
              <Button type="submit" name="intent" value="test" variant="secondary" disabled={pending}>
                Отправить тестовое
              </Button>
              <Button type="submit" name="intent" value="unpair" variant="ghost" disabled={pending}>
                Отвязать
              </Button>
            </div>
          )}
        </form>
      )}
    </Card>
  );
}
