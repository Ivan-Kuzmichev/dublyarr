import { expect, test } from 'vitest';
import { groupFiles } from '@/lib/media-scan/group';

const f = (rel: string, size = 1e9) => ({ rel, size });

test('сериал в своей структуре: Season NN, номер из имени файла', () => {
  const { items } = groupFiles([f('BEEF/Season 01/BEEF - S01E01 - WEB-DL 2160p TVShows.mkv'), f('BEEF/Season 01/BEEF - S01E02 - WEB-DL 2160p TVShows.mkv')], 'media');
  expect(items).toEqual([expect.objectContaining({ key: 'BEEF', kind: 'series', names: ['BEEF'] })]);
  expect(items[0].episodes.map((e) => [e.season, e.number])).toEqual([[1, 1], [1, 2]]);
});

test('раздача как скачалась: имя из заголовка, сопутствующие .srt — к своей серии, .nfo/.jpg — не видео', () => {
  const { items } = groupFiles(
    [
      f('Task.S01.WEB-DLRip.LF/Task.S01E01.WEB-DLRip.RGzsRutracker.avi'),
      f('Task.S01.WEB-DLRip.LF/Task.S01E01.WEB-DLRip.RGzsRutracker.forced.rus.srt', 900),
      f('Task.S01.WEB-DLRip.LF/Task.S01E02.WEB-DLRip.RGzsRutracker.avi'),
      f('Black.Bird.S01.1080p.ATVP.WEB-DL.DDP5.1.H.264-EniaHD/Black.Bird.S01E01.Pilot.1080p.ATVP.WEB-DL.DDP5.1.H.264-EniaHD.mkv'),
      f('Black.Bird.S01.1080p.ATVP.WEB-DL.DDP5.1.H.264-EniaHD/Черная птица-poster.archos.jpg', 3e4),
    ],
    'media',
  );
  const task = items.find((i) => i.key === 'Task.S01.WEB-DLRip.LF')!;
  expect(task.names[0]).toBe('Task');
  expect(task.episodes[0]).toMatchObject({ season: 1, number: 1, sidecars: ['Task.S01.WEB-DLRip.LF/Task.S01E01.WEB-DLRip.RGzsRutracker.forced.rus.srt'] });
  expect(items.find((i) => i.key.startsWith('Black.Bird'))!.names[0]).toBe('Black Bird');
});

test('фильмы файлом в корне и папкой «Название (Год)»', () => {
  const { items } = groupFiles([f('Happy.Gilmore.1996.BDREMUX.mkv', 1.7e10), f('Обсессия.2025.UHD.Blu-Ray.Remux.2160p.[by arxivariys].mkv'), f('어쩔수가없다 (2025)/어쩔수가없다 (2025) - WEB-DL 2160p DEEP.mkv')], 'media');
  expect(items.map((i) => [i.key, i.kind, i.names[0], i.year])).toEqual([
    ['Happy.Gilmore.1996.BDREMUX.mkv', 'movie', 'Happy Gilmore', 1996],
    ['Обсессия.2025.UHD.Blu-Ray.Remux.2160p.[by arxivariys].mkv', 'movie', 'Обсессия', 2025],
    ['어쩔수가없다 (2025)', 'movie', '어쩔수가없다', 2025],
  ]);
});

test('название без латиницы и несколько сезонов', () => {
  const { items } = groupFiles([f('참교육/Season 01/참교육 - S01E01 - WEB-DL 1080p RuDub.mkv'), f('Family Guy/Season 23/Family Guy - S23E14 - WEB-DL 1080p OMSKBIRD.mkv'), f('Family Guy/Season 24/Family Guy - S24E01 - WEB-DL 1080p OMSKBIRD.mkv')], 'media');
  expect(items.find((i) => i.key === '참교육')!.names[0]).toBe('참교육');
  expect(items.find((i) => i.key === 'Family Guy')!.episodes.map((e) => `${e.season}x${e.number}`)).toEqual(['23x14', '24x1']);
});

test('дубль серии — больший файл берётся, меньший — в «unknown»; видео без номера — тоже', () => {
  const { items } = groupFiles([f('Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.mkv', 4e9), f('Silo/Season 03/Silo.S03E01.720p.mkv', 1e9), f('Silo/extras/behind the scenes.mkv', 3e8)], 'media');
  const silo = items[0];
  expect(silo.episodes).toHaveLength(1);
  expect(silo.episodes[0].rel).toContain('1080p');
  expect(silo.unknown.map((u) => u.why)).toEqual(['Дубль серии S03E01', 'Нет номера серии']);
});

test('папка без видео — пропуск с причиной', () => {
  expect(groupFiles([f('Docs/readme.nfo', 10)], 'media').skipped).toEqual([{ key: 'Docs', why: 'Нет видео' }]);
});
