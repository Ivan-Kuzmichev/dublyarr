import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseProbe } from '@/lib/media/probe';
import { DEFAULT_PROCESSING, planTracks } from '@/lib/media/tracks';
import { mkvmergeArgs } from '@/lib/media/mkvmerge';
import { wrongEpisode } from '@/lib/media/checks';

const multi = parseProbe(JSON.parse(readFileSync('tests/fixtures/ffprobe/multi.json', 'utf8')));
const studios = [{ id: 1, name: 'HDrezka', aliases: ['HDrezka Studio'] }];

test('аргументы: дорожки, флаги, порядок', () => {
  const plan = planTracks(multi, { wanted: [1], backups: [], originalLang: 'en', studios, settings: { ...DEFAULT_PROCESSING, keepSubs: ['rus'] }, external: [] });
  expect(mkvmergeArgs('/d/src.mkv', '/m/out.mkv', plan)).toEqual([
    '-o', '/m/out.mkv',
    '--audio-tracks', '2,1',
    '--subtitle-tracks', '4,5',
    '--default-track-flag', '2:1', '--default-track-flag', '1:0',
    '--default-track-flag', '4:1', '--default-track-flag', '5:0',
    '--track-order', '0:0,0:2,0:1,0:4,0:5',
    '/d/src.mkv',
  ]);
});

test('внешние дорожки — отдельными входами с языком и названием; без субтитров; аудио не трогаем', () => {
  const plan = planTracks(multi, {
    wanted: [9], backups: [], originalLang: 'en', studios, settings: { ...DEFAULT_PROCESSING, keepSubs: [] },
    external: [{ path: '/d/LostFilm/e.mka', type: 'audio', language: 'rus', title: 'LostFilm' }, { path: '/d/e.srt', type: 'subtitle', language: null, title: null }],
  });
  expect(mkvmergeArgs('/d/src.mkv', '/m/out.mkv', plan)).toEqual([
    '-o', '/m/out.mkv',
    '--audio-tracks', '1,2,3',
    '--no-subtitles',
    '--default-track-flag', '1:1', '--default-track-flag', '2:0', '--default-track-flag', '3:0',
    '--track-order', '0:0,0:1,0:2,0:3,1:0,2:0',
    '/d/src.mkv',
    '--language', '0:rus', '--track-name', '0:LostFilm', '--default-track-flag', '0:0', '/d/LostFilm/e.mka',
    '--default-track-flag', '0:0', '/d/e.srt',
  ]);
});

test('та ли серия по длительности', () => {
  expect(wrongEpisode(20 * 60, 55)).toBe('Не та серия: 20 мин вместо ~55 мин');
  expect(wrongEpisode(50 * 60, 55)).toBeNull();
  expect(wrongEpisode(45 * 60, null)).toBeNull();
  expect(wrongEpisode(125 * 60, null)).toBe('Похоже на фильм: 2 ч 5 мин');
  expect(wrongEpisode(null, 55)).toBeNull();
});

test('двойная серия и длинный финал — не «не та серия»', () => {
  expect(wrongEpisode(125 * 60, 55)).toBeNull(); // 2,3× — финал
  expect(wrongEpisode(150 * 60, 55)).toBe('Не та серия: 2 ч 30 мин вместо ~55 мин');
  expect(wrongEpisode(110 * 60, 55, 2)).toBeNull(); // файл на две серии
});

test('имя и язык дорожек явно (из mp4/avi mkvmerge их не берёт)', () => {
  const plan = { changed: true, audio: [1], subs: [], order: [0, 1], defaults: { audio: 1, sub: null }, external: [], untouchedAudio: false };
  expect(mkvmergeArgs('/d/a.mp4', '/m/o.mkv', plan, new Map([[1, { name: 'HDrezka Studio', language: 'rus' }]]))).toEqual([
    '-o', '/m/o.mkv', '--audio-tracks', '1', '--no-subtitles', '--default-track-flag', '1:1', '--track-order', '0:0,0:1', '--track-name', '1:HDrezka Studio', '--language', '1:rus', '/d/a.mp4',
  ]);
});
