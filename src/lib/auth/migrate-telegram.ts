import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { deleteSetting, getSetting, tryGetSecretSetting, setSecretSetting } from '../settings';

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
