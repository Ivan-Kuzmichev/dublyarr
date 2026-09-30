import { openDb, migrateDb, type Db } from '@/lib/db/client';

export function testDb(): Db {
  const db = openDb(':memory:');
  migrateDb(db);
  return db;
}
