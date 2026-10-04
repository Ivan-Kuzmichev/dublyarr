import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { users } from '../db/schema';

type User = typeof users.$inferSelect;
import { deleteSetting, getSetting, tryGetSecretSetting, setSecretSetting } from '../settings';

// Роли и права (2.3): админ — всё; пользователь — флаги, заданные админом. Проверка — на сервере в каждом действии.

export const PERMISSIONS = ['subscribe', 'search', 'answer', 'downloads', 'storage'] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABEL: Record<Permission, { title: string; sub: string }> = {
  subscribe: { title: 'Подписки', sub: 'Подписаться, изменить подписку, отписаться' },
  search: { title: 'Ручной поиск и «Скачать»', sub: 'Ручной поиск, загрузка раздачи, обновление из TMDB' },
  answer: { title: 'Ответы на вопросы', sub: '«Это он / Не тот сериал», студии, нумерация аниме' },
  downloads: { title: 'Загрузки', sub: 'Пауза, продолжить, убрать в «Активности», «Искать сейчас»' },
  storage: { title: 'Хранилище и удаление', sub: 'Удалить сериал или файлы, подтвердить уборку и старые копии' },
};

export const DEFAULT_PERMISSIONS: Record<Permission, boolean> = { subscribe: true, search: true, answer: true, downloads: false, storage: false };

type Who = Pick<User, 'role' | 'permissions' | 'disabled'>;

export const isAdmin = (u: Who) => !u.disabled && u.role === 'admin';

export function can(u: Who, p: Permission): boolean {
  if (u.disabled) return false;
  if (u.role === 'admin') return true;
  return u.permissions[p] === true;
}

/** До 2.3 чат Telegram и события были общими настройками — теперь у первого админа. Повторный вызов ничего не меняет. */
export function migrateTelegramChat(db: Db) {
  const admin = db.select().from(users).where(eq(users.role, 'admin')).orderBy(asc(users.id)).get();
  if (!admin) return;
  const tg = tryGetSecretSetting<{ token: string; chatId?: string } & Record<string, unknown>>(db, 'telegram');
  const events = getSetting<Record<string, boolean>>(db, 'telegram.events');
  const set: Partial<typeof users.$inferInsert> = {};
  if (tg?.chatId && !admin.telegramChatId) set.telegramChatId = tg.chatId;
  if (events && !admin.notifyEvents) set.notifyEvents = events;
  if (Object.keys(set).length) db.update(users).set(set).where(eq(users.id, admin.id)).run();
  if (tg?.chatId) {
    const { chatId: _c, ...rest } = tg;
    setSecretSetting(db, 'telegram', rest);
  }
  if (events) deleteSetting(db, 'telegram.events');
}
