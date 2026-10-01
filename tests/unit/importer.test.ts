import { expect, test } from 'vitest';
import { mkdtempSync, writeFileSync, statSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { importFile, checkHardlink } from '@/lib/importer';

function tmp() {
  const root = mkdtempSync(path.join(tmpdir(), 'dy-imp-'));
  mkdirSync(path.join(root, 'dl'));
  mkdirSync(path.join(root, 'media'));
  const src = path.join(root, 'dl', 'a.mkv');
  writeFileSync(src, 'video');
  return { root, src, media: path.join(root, 'media') };
}

test('жёсткая ссылка; повторный импорт заменяет', async () => {
  const { src, media } = tmp();
  const r = await importFile(src, media, 'Show (2011)/Season 01/Show S01E01.mkv');
  expect(r.method).toBe('hardlink');
  expect(statSync(r.path).ino).toBe(statSync(src).ino);
  writeFileSync(src + '2', 'другое');
  const again = await importFile(src + '2', media, 'Show (2011)/Season 01/Show S01E01.mkv');
  expect(readFileSync(again.path, 'utf8')).toBe('другое');
});

test('ссылку нельзя (EXDEV) — копия', async () => {
  const { src, media } = tmp();
  const fsx = { link: async () => { throw Object.assign(new Error('cross-device'), { code: 'EXDEV' }); } };
  const r = await importFile(src, media, 'S/x.mkv', fsx);
  expect(r.method).toBe('copy');
  expect(statSync(r.path).ino).not.toBe(statSync(src).ino);
  expect(readFileSync(r.path, 'utf8')).toBe('video');
});

test('путь вне медиатеки — отказ', async () => {
  const { src, media } = tmp();
  await expect(importFile(src, media, '../evil.mkv')).rejects.toThrow('Путь вне медиатеки');
});

test('проверка жёстких ссылок', async () => {
  const { root, media } = tmp();
  expect(await checkHardlink(path.join(root, 'dl'), media)).toEqual({ ok: true, message: 'Жёсткие ссылки работают' });
  expect((await checkHardlink('/nope', media)).ok).toBe(false);
});
