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

test('жёсткая ссылка; повторный импорт своей серии заменяет', async () => {
  const { src, media } = tmp();
  const r = await importFile(src, media, 'Show (2011)/Season 01/Show S01E01.mkv');
  expect(r.method).toBe('hardlink');
  expect(statSync(r.path).ino).toBe(statSync(src).ino);
  writeFileSync(src + '2', 'другое');
  const again = await importFile(src + '2', media, 'Show (2011)/Season 01/Show S01E01.mkv', undefined, { replace: true });
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

test('по пути уже лежит файл — без замены отказ, файл не тронут, ссылка не делается', async () => {
  const { src, media } = tmp();
  mkdirSync(path.join(media, 'S'));
  writeFileSync(path.join(media, 'S', 'x.mkv'), 'чужое');
  let links = 0;
  const fsx = { link: async () => { links++; } };
  await expect(importFile(src, media, 'S/x.mkv', fsx)).rejects.toThrow('Файл уже есть в медиатеке: S/x.mkv');
  expect(readFileSync(path.join(media, 'S', 'x.mkv'), 'utf8')).toBe('чужое');
  expect(links).toBe(0);
});

test('медиатека без жёстких ссылок — копия кладётся и без замены', async () => {
  const { src, media } = tmp();
  const fsx = { link: async () => { throw Object.assign(new Error('not supported'), { code: 'EPERM' }); } };
  const r = await importFile(src, media, 'S/y.mkv', fsx);
  expect(r.method).toBe('copy');
  expect(readFileSync(r.path, 'utf8')).toBe('video');
});
