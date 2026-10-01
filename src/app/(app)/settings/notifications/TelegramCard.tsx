'use client';

import { useActionState } from 'react';
import { Card } from '@/components/ui/Card';
import { Field, PasswordField } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { telegramAction, type TgState } from './actions';

type Props = { hasToken: boolean; chatId: string; proxy: string; baseUrl: string; tmdbProxy: boolean };

export function TelegramCard(p: Props) {
  const [state, action, pending] = useActionState<TgState, FormData>(telegramAction, {});
  const v = state.values;
  return (
    <Card className="flex min-w-0 flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="m-0 text-base font-semibold">Telegram-бот</h3>
        <span className="text-[13px] text-muted">{p.chatId ? 'чат привязан' : p.hasToken ? 'чат не привязан' : 'не настроен'}</span>
      </div>
      <form action={action} className="flex max-w-[560px] flex-col gap-4">
        <PasswordField label="Токен бота" name="token" autoComplete="off" placeholder={p.hasToken ? 'сохранён — оставьте пустым' : '123456:ABC…'} hint="Выдаёт @BotFather. Хранится зашифрованным" />
        <Field label="Chat ID" name="chatId" mono defaultValue={v?.chatId ?? p.chatId} placeholder="заполнится при привязке" hint="Проще привязать кнопкой ниже" />
        <Field
          label="Прокси"
          name="proxy"
          mono
          defaultValue={v?.proxy ?? p.proxy}
          placeholder={p.tmdbProxy ? 'как у TMDB' : 'http://host:port'}
          hint={p.tmdbProxy ? 'Пусто — используется прокси TMDB' : 'Нужен, если Telegram недоступен с NAS напрямую'}
        />
        <Field label="Адрес Dublyarr" name="baseUrl" mono defaultValue={v?.baseUrl ?? p.baseUrl} placeholder="http://nas:3000" hint="Для кнопок-ссылок в сообщениях. Необязательно" />
        {state.code && (
          <div className="flex flex-col gap-1 rounded-xl border border-accent/50 bg-accent/[0.06] p-4">
            <span className="font-mono text-[28px] tracking-[0.2em] text-accent">{state.code}</span>
            <span className="text-[13px] text-text-2">{state.ok}</span>
          </div>
        )}
        {state.error && (
          <p role="alert" className="m-0 text-sm text-danger">
            {state.error}
          </p>
        )}
        {state.ok && !state.code && <p className="m-0 text-sm text-progress">{state.ok}</p>}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" name="intent" value="save" disabled={pending}>
            Сохранить
          </Button>
          <Button type="submit" name="intent" value="check" variant="secondary" disabled={pending}>
            Проверить
          </Button>
          <Button type="submit" name="intent" value="pair" variant="secondary" disabled={pending}>
            Привязать чат
          </Button>
          <Button type="submit" name="intent" value="test" variant="secondary" disabled={pending}>
            Отправить тестовое
          </Button>
        </div>
      </form>
    </Card>
  );
}
