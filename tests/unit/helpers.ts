import { users } from '@/lib/db/schema';
import { openDb, migrateDb, type Db } from '@/lib/db/client';

export function testDb(): Db {
  const db = openDb(':memory:');
  migrateDb(db);
  return db;
}

/** База с получателем уведомлений: админ с привязанным чатом (без него события не пишутся в очередь). */
export function testDbWithChat(events?: Record<string, boolean>): Db {
  const db = testDb();
  db.insert(users).values({ username: 'admin', passwordHash: 'x', telegramChatId: '1', notifyEvents: events ?? null, createdAt: 1, updatedAt: 1 }).run();
  return db;
}
