import { expect, test } from 'vitest';
import { renderTemplate, toLocalPath, DEFAULT_TEMPLATE, PathError } from '@/lib/library-path';

const v = { name: 'Игра престолов', original: 'Game of Thrones', year: 2011, season: 1, episode: 3, studio: 'LostFilm', quality: '1080p' };

test('шаблон по умолчанию', () => {
  expect(renderTemplate(DEFAULT_TEMPLATE, v, '.mkv')).toBe('Игра престолов (2011)/Season 01/Игра престолов S01E03 [LostFilm 1080p].mkv');
  expect(renderTemplate(DEFAULT_TEMPLATE, { ...v, quality: '' }, '.mkv')).toBe('Игра престолов (2011)/Season 01/Игра престолов S01E03 [LostFilm].mkv');
  expect(renderTemplate(DEFAULT_TEMPLATE, { ...v, quality: '', studio: '' }, 'mkv')).toBe('Игра престолов (2011)/Season 01/Игра престолов S01E03.mkv');
  expect(renderTemplate(DEFAULT_TEMPLATE, { ...v, year: null }, '.mkv')).toBe('Игра престолов/Season 01/Игра престолов S01E03 [LostFilm 1080p].mkv');
});

test('запрещённые символы в значениях не создают каталогов', () => {
  const r = renderTemplate(DEFAULT_TEMPLATE, { ...v, name: 'Что/Где/Когда: 2024?' }, '.mkv');
  expect(r.split('/')).toHaveLength(3);
  expect(r.startsWith('Что-Где-Когда- 2024- (2011)/')).toBe(true);
  expect(renderTemplate('{Название}/../x', v, '.mkv')).toBe('Игра престолов/x.mkv');
  expect(() => renderTemplate('{Название}/../{Название}', { ...v, name: '..' }, '.mkv')).toThrow(PathError);
  expect(renderTemplate('/{Название}/x', v, '.mkv').startsWith('/')).toBe(false);
});

test('длинные части обрезаются', () => {
  const long = renderTemplate(DEFAULT_TEMPLATE, { ...v, name: 'Я'.repeat(300) }, '.mkv');
  for (const part of long.split('/')) expect(part.length).toBeLessThanOrEqual(124);
});

test('перевод путей qBittorrent → Dublyarr', () => {
  expect(toLocalPath('/downloads/dublyarr/x.mkv', '/downloads', '/storage/downloads')).toBe('/storage/downloads/dublyarr/x.mkv');
  expect(toLocalPath('/downloads/', '/downloads/', '/storage/downloads')).toBe('/storage/downloads');
  for (const bad of ['/downloads2/x', '/downloads/../etc/passwd', 'C:\\Downloads\\x', '/other/x']) expect(() => toLocalPath(bad, '/downloads', '/storage/downloads')).toThrow(PathError);
  expect(() => toLocalPath('/downloads2/x', '/downloads', '/s')).toThrow('Путь qBittorrent вне папки загрузок: /downloads2/x');
});
