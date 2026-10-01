import { expect, test } from 'vitest';
import { parsePathsForm } from '@/lib/paths-form';

const f = (o: Record<string, string>) => {
  const d = new FormData();
  for (const [k, v] of Object.entries(o)) d.set(k, v);
  return d;
};
const ok = { qbitDownloads: '/downloads', downloads: '/storage/downloads', media: '/storage/media', template: '{Название}/S{С}E{Е}' };

test('разбор формы путей', () => {
  expect(parsePathsForm(f({ ...ok, downloads: ' /storage/downloads/ ' }))).toEqual({ ...ok });
  expect(parsePathsForm(f({ ...ok, qbitDownloads: '' }))).toEqual({ ...ok, qbitDownloads: '/storage/downloads' });
  expect(parsePathsForm(f({ ...ok, template: '' }))).toMatchObject({ template: '{Название} ({Год})/Season {С}/{Название} S{С}E{Е} [{Студия} {Качество}]' });
  expect(parsePathsForm(f({ ...ok, media: 'media' }))).toEqual({ error: 'Медиатека: нужен абсолютный путь' });
  expect(parsePathsForm(f({ ...ok, template: '{Название}' }))).toEqual({ error: 'В шаблоне нужны {С} и {Е}' });
});
