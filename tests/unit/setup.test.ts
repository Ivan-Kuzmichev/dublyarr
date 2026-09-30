import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { createUser } from '@/lib/auth/users';
import { getSetupState, markStep, completeSetup } from '@/lib/setup';
import { addSource, listSources } from '@/lib/sources';
import { sources } from '@/lib/db/schema';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');

test('порядок шагов мастера', async () => {
  const db = testDb();
  expect(getSetupState(db).step).toBe('account');
  await createUser(db, 'admin', 'пароль-длинный');
  expect(getSetupState(db).step).toBe('qbittorrent');
  markStep(db, 'qbittorrent', 'skipped');
  expect(getSetupState(db).step).toBe('sources');
  markStep(db, 'sources', 'done');
  markStep(db, 'folders', 'done');
  expect(getSetupState(db).step).toBe('folders'); // пока не завершён явно
  completeSetup(db);
  expect(getSetupState(db)).toEqual({ step: 'done', completed: ['account', 'qbittorrent', 'sources', 'folders'] });
});

test('ключ источника хранится зашифрованным и не отдаётся в списке', () => {
  const db = testDb();
  addSource(db, { name: 'Jackett', url: 'http://j/', apiKey: 'SECRETKEY' });
  expect(db.select().from(sources).get()!.apiKeyEnc).not.toContain('SECRETKEY');
  expect(listSources(db)).toEqual([{ id: 1, name: 'Jackett', url: 'http://j/', enabled: true }]);
});
