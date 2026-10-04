import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseProbe } from '@/lib/media/probe';
import { classifyAudio, DEFAULT_PROCESSING, describePlan, findExternal, parseProcessingForm, planTracks, type ProcessingSettings } from '@/lib/media/tracks';

const fx = (n: string) => parseProbe(JSON.parse(readFileSync(`tests/fixtures/ffprobe/${n}.json`, 'utf8')));
const studios = [
  { id: 1, name: 'HDrezka', aliases: ['HDrezka Studio', 'Rezka'] },
  { id: 2, name: 'LostFilm', aliases: ['LostFilm.TV'] },
  { id: 3, name: 'TVShows', aliases: [] },
];
const multi = fx('multi');
const plan = (o: Partial<ProcessingSettings> = {}, wanted = [1], backups: number[] = [], extra: Partial<Parameters<typeof planTracks>[1]> = {}) =>
  planTracks(multi, { wanted, backups, originalLang: 'en', studios, settings: { ...DEFAULT_PROCESSING, ...o }, external: [], ...extra });

describe('опознание озвучки', () => {
  test('студия по названию и варианту написания, оригинал, другая', () => {
    const a = multi.streams.filter((s) => s.type === 'audio');
    expect(a.map((s) => classifyAudio(s, studios, 'en'))).toEqual([{ kind: 'original' }, { kind: 'studio', studioId: 1 }, { kind: 'studio', studioId: 2 }]);
    expect(classifyAudio({ ...a[1], title: 'Rezkaa' }, studios, 'en')).toEqual({ kind: 'other' }); // только целыми словами
    expect(classifyAudio({ ...a[1], title: 'Оригинальная дорожка', language: 'rus' }, studios, 'ja')).toEqual({ kind: 'original' });
    expect(classifyAudio(fx('mp4').streams[1], studios, 'en')).toEqual({ kind: 'studio', studioId: 2 }); // handler_name LostFilm.TV
  });
});

describe('выбор дорожек', () => {
  test('озвучка из подписки + оригинал; по умолчанию она и форсированные', () => {
    const p = plan();
    expect(p).toMatchObject({ changed: true, untouchedAudio: false, audio: [2, 1], subs: [4, 5, 6], defaults: { audio: 2, sub: 4 } });
    expect(p.order).toEqual([0, 2, 1, 4, 5, 6]);
  });
  test('только озвучка; всё; запасные', () => {
    expect(plan({ audio: 'dub' }).audio).toEqual([2]);
    expect(plan({ audio: 'all' }).audio).toEqual([2, 1, 3]);
    expect(plan({ keepBackups: true }, [1], [2]).audio).toEqual([2, 1, 3]);
  });
  test('нужная озвучка не опознана — аудио не трогаем', () => {
    const p = plan({}, [3]);
    expect(p).toMatchObject({ untouchedAudio: true, audio: [1, 2, 3] });
    expect(p.defaults.audio).toBe(1); // флаг «по умолчанию» — как в источнике (mp4 → mkv иначе даст всем дорожкам)
  });
  test('субтитры: языки, полные, без субтитров по умолчанию', () => {
    expect(plan({ keepSubs: ['rus'] }).subs).toEqual([4, 5]);
    expect(plan({ defaultSubs: 'full' }).defaults.sub).toBe(5);
    expect(plan({ defaultSubs: 'none' }).defaults.sub).toBeNull();
  });
  test('менять нечего — без пересборки; mp4 — всегда пересборка', () => {
    const same = planTracks(fx('dv'), { wanted: [1], backups: [], originalLang: 'en', studios, settings: DEFAULT_PROCESSING, external: [] });
    expect(same.changed).toBe(false); // нужная не опознана, субтитров нет, mkv
    const mp4 = planTracks(fx('mp4'), { wanted: [2], backups: [], originalLang: 'en', studios, settings: DEFAULT_PROCESSING, external: [] });
    expect(mp4.changed).toBe(true);
  });
  test('описание «было → стало»', () => {
    const d = describePlan(multi, plan(), (id) => studios.find((s) => s.id === id)?.name);
    expect(d.before.map((t) => t.name)).toEqual(['HEVC 2160p HDR', 'Original 5.1', 'HDrezka Studio 5.1', 'MVO LostFilm 2.0', 'Forced', 'Полные', 'English SDH']);
    expect(d.after).toEqual([
      { kind: 'видео', name: 'HEVC 2160p HDR' },
      { kind: 'аудио 1', name: 'HDrezka Studio 5.1', flag: 'по умолч.' },
      { kind: 'аудио 2', name: 'Original 5.1' },
      { kind: 'субт.', name: 'Forced', flag: 'по умолч.' },
      { kind: 'субт.', name: 'Полные' },
      { kind: 'субт.', name: 'English SDH' },
    ]);
  });
});

describe('внешние дорожки', () => {
  const files = [
    'Show S01/Show.S01E02.mkv',
    'Show S01/Show.S01E03.mkv',
    'Show S01/Rus Sound/LostFilm/Show.S01E02.mka',
    'Show S01/Rus Sound/LostFilm/Show.S01E03.mka',
    'Show S01/Rus Subs/Show.S01E03.forced.srt',
    'Show S01/Eng Subs/Show.S01E03.srt',
    'Show S01/sample.mka',
  ];
  test('только своя серия; язык и студия по папкам', () => {
    expect(findExternal(files, 'Show S01/Show.S01E03.mkv', 1, 3, false)).toEqual([
      { path: 'Show S01/Rus Sound/LostFilm/Show.S01E03.mka', type: 'audio', language: 'rus', title: 'LostFilm' },
      { path: 'Show S01/Rus Subs/Show.S01E03.forced.srt', type: 'subtitle', language: 'rus', title: 'forced' },
      { path: 'Show S01/Eng Subs/Show.S01E03.srt', type: 'subtitle', language: 'eng', title: null },
    ]);
  });
  test('один видеофайл — все внешние', () => {
    expect(findExternal(['M/movie.mkv', 'M/rus.ac3', 'M/sub.srt'], 'M/movie.mkv', 1, 1, true).map((e) => e.path)).toEqual(['M/rus.ac3', 'M/sub.srt']);
  });
  test('внешняя дорожка — пересборка и озвучка по умолчанию, если внутри её нет', () => {
    const ext = findExternal(files, 'Show S01/Show.S01E03.mkv', 1, 3, false);
    const p = planTracks(multi, { wanted: [3], backups: [], originalLang: 'en', studios: [...studios, { id: 3, name: 'LostFilmX', aliases: [] }], settings: DEFAULT_PROCESSING, external: ext });
    expect(p.changed).toBe(true);
    expect(p.external).toHaveLength(3);
  });
});

test('разбор формы обработки', () => {
  const f = new FormData();
  f.set('audio', 'dub');
  f.set('external', 'on');
  f.set('defaultSubs', 'full');
  f.set('keepSubs', 'rus, eng ,jpn');
  expect(parseProcessingForm(f)).toEqual({ audio: 'dub', keepBackups: false, external: true, defaultSubs: 'full', keepSubs: ['rus', 'eng', 'jpn'] });
  f.set('audio', 'x');
  expect(parseProcessingForm(f)).toEqual({ error: 'Неизвестный вариант звуковых дорожек' });
});
