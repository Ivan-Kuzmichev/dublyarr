import { expect, test } from 'vitest';
import { pickMovieFile, mediaRoot, DEFAULT_MOVIE_TEMPLATE } from '@/lib/movie-files';
import { renderTemplate } from '@/lib/library-path';
import { wrongMovie } from '@/lib/media/checks';

const GB = 1024 ** 3;
const f = (name: string, gb: number) => ({ name, size: gb * GB });
const list = (...xs: { name: string; size: number }[]) => xs.map((x, index) => ({ ...x, index }));

test('основной файл — самый большой видеофайл; сэмпл, трейлер и бонусы — нет; внешние дорожки — да', () => {
  const files = list(
    f('The.Matrix.1999/Sample/sample.mkv', 0.1),
    f('The.Matrix.1999/The.Matrix.1999.1080p.mkv', 12),
    f('The.Matrix.1999/The.Matrix.1999.trailer.mkv', 0.2),
    f('The.Matrix.1999/Extras/Making.of.mkv', 2),
    f('The.Matrix.1999/Featurettes/Bullet.Time.mkv', 1),
    f('The.Matrix.1999/The.Matrix.1999.1080p.alt.cut.mkv', 11),
    f('The.Matrix.1999/Rus Sound/The.Matrix.1999.Goblin.mka', 1),
    f('The.Matrix.1999/Subs/The.Matrix.1999.rus.srt', 0.001),
    f('The.Matrix.1999/Extras/commentary.srt', 0.001),
    f('The.Matrix.1999/poster.jpg', 0.001),
  );
  expect(pickMovieFile(files)).toEqual({ main: 1, external: [6, 7] });
});

test('одиночный файл; раздача-диск — отказ; нет видео — отказ', () => {
  expect(pickMovieFile(list(f('The.Matrix.1999.mkv', 10)))).toEqual({ main: 0, external: [] });
  expect(pickMovieFile(list(f('MATRIX/BDMV/STREAM/00001.m2ts', 30), f('MATRIX/BDMV/index.bdmv', 0.001)))).toEqual({ error: 'Диск, а не файл' });
  expect(pickMovieFile(list(f('MATRIX/VIDEO_TS/VTS_01_1.VOB', 1)))).toEqual({ error: 'Диск, а не файл' });
  expect(pickMovieFile(list(f('Matrix.iso', 40)))).toEqual({ error: 'Диск, а не файл' });
  expect(pickMovieFile(list(f('readme.txt', 0.001)))).toEqual({ error: 'В раздаче нет видеофайла' });
});

test('шаблон фильма и корень папки', () => {
  expect(renderTemplate(DEFAULT_MOVIE_TEMPLATE, { name: 'Матрица', original: 'The Matrix', year: 1999, season: 0, episode: 0, studio: 'Дубляж', quality: '1080p' }, '.mkv')).toBe('Матрица (1999)/Матрица (1999) [Дубляж 1080p].mkv');
  const paths = { downloads: '/d', media: '/m', movies: '/movies' };
  expect(mediaRoot(paths, 'movie')).toBe('/movies');
  expect(mediaRoot(paths, 'series')).toBe('/m');
  expect(mediaRoot({ downloads: '/d', media: '/m' }, 'movie')).toBeNull();
});

test('та ли это длительность фильма', () => {
  expect(wrongMovie(45 * 60, 136)).toBe('Не тот фильм: 45 мин вместо ~136 мин');
  expect(wrongMovie(130 * 60, 136)).toBeNull();
  expect(wrongMovie(190 * 60, 136)).toBeNull(); // режиссёрская версия
  expect(wrongMovie(25 * 60, null)).toBe('Похоже на серию: 25 мин');
  expect(wrongMovie(null, 136)).toBeNull();
});
