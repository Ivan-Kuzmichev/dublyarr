import { expect, test } from 'vitest';
import { episodeFromFilename, filesForEpisodes, isVideo } from '@/lib/episode-file';

test.each([
  ['Game.of.Thrones.S01E03.1080p.WEB-DL.LostFilm.mkv', 1, 3],
  ['The.Bear.S05E08.1080p.rus.LostFilm.TV.mkv', 5, 8],
  ['Severance/Severance.S02E07.2160p.ATVP.WEB-DL.mkv', 2, 7],
  ['Severance.S02E07.mkv', 1, null],
  ['1x03 - Lord Snow.avi', 1, 3],
  ['03. Лорд Сноу.mkv', 1, 3],
  ['Серия 03.mkv', 1, 3],
  ['03 серия.mp4', 1, 3],
  ['[AniLibria] Sousou no Frieren - 03 [1080p].mkv', 1, 3],
  ['Frieren 2nd Season - 07 (1080p HEVC).mkv', 2, 7],
  ['Show.2024.E05.1080p.x265.mkv', 1, 5],
  ['Show 2024 1080p.mkv', 1, null],
  ['sample.mkv', 1, null],
  ['Show S01 - 12 [WEB-DL 720p].mkv', 1, 12],
  ['Season 1/Episode 04.mkv', 1, 4],
  ['03.mkv', 1, 3],
  ['Show - 2023 - 03 [1080p].mkv', 1, 3],
  ['Show - 2023.mkv', 1, null],
  ['Show/03.mkv', 1, 3],
])('%s', (name, season, n) => expect(episodeFromFilename(name, season)).toBe(n));

test('видео', () => {
  expect(isVideo('a/b.MKV')).toBe(true);
  expect(isVideo('a.srt')).toBe(false);
  expect(isVideo('a.mka')).toBe(false);
});

test('файлы нужных серий в паке', () => {
  const files = [
    ...Array.from({ length: 10 }, (_, i) => ({ index: i, name: `GoT S01/Game.of.Thrones.S01E${String(i + 1).padStart(2, '0')}.1080p.mkv`, size: 2e9 })),
    { index: 10, name: 'GoT S01/Game.of.Thrones.S01E03.srt', size: 1e4 },
    { index: 11, name: 'GoT S01/sample.mkv', size: 1e7 },
  ];
  expect(filesForEpisodes(files, 1, [3, 5, 11])).toEqual(
    new Map([
      [3, [2]],
      [5, [4]],
    ]),
  );
  expect(filesForEpisodes([{ index: 0, name: 'some.release.name.mkv', size: 2e9 }], 1, [7])).toEqual(new Map([[7, [0]]]));
  expect(filesForEpisodes([{ index: 0, name: 'a.mkv', size: 1 }, { index: 1, name: 'b.mkv', size: 1 }], 1, [7])).toEqual(new Map());
});
