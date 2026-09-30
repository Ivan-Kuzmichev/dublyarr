import { expect, test } from 'vitest';
import { mkdtempSync, writeFileSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkWritableDir } from '@/lib/fs-check';

test('проверка папки', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dy-'));
  expect(await checkWritableDir(dir)).toEqual({ ok: true });
  expect(readdirSync(dir)).toEqual([]); // тестовый файл удалён
  expect(await checkWritableDir('rel/path')).toEqual({ ok: false, error: 'Нужен абсолютный путь' });
  expect(await checkWritableDir(path.join(dir, 'nope'))).toEqual({ ok: false, error: 'Папка не найдена' });
  const f = path.join(dir, 'file');
  writeFileSync(f, '');
  expect(await checkWritableDir(f)).toEqual({ ok: false, error: 'Это не папка' });
});

test.skipIf(process.getuid?.() === 0)('нет прав на запись', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dy-ro-'));
  chmodSync(dir, 0o500);
  expect(await checkWritableDir(dir)).toEqual({ ok: false, error: 'Нет прав на запись' });
  chmodSync(dir, 0o700);
});
