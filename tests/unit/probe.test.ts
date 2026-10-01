import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { hdrOf, parseProbe, resolutionOf } from '@/lib/media/probe';

const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/ffprobe/${n}.json`, 'utf8'));

test('многоязычный mkv', () => {
  const p = parseProbe(fx('multi'));
  expect(p.container).toBe('matroska');
  expect(p.duration).toBeCloseTo(3300.5);
  expect(p.streams.map((s) => [s.index, s.type, s.language, s.title, s.isDefault, s.forced])).toEqual([
    [0, 'video', null, null, true, false],
    [1, 'audio', 'eng', 'Original', true, false],
    [2, 'audio', 'rus', 'HDrezka Studio', false, false],
    [3, 'audio', 'rus', 'MVO LostFilm', false, false],
    [4, 'subtitle', 'rus', 'Forced', false, true],
    [5, 'subtitle', 'rus', 'Полные', false, false],
    [6, 'subtitle', 'eng', 'English SDH', false, false],
    [7, 'other', null, null, false, false],
  ]);
  expect(p.streams[1].channels).toBe(6);
  expect(resolutionOf(p)).toBe(2160); // широкий кадр 3840×1608
  expect(hdrOf(p)).toBe(true);
});

test('mp4: язык «und» — нет языка, название из handler_name', () => {
  const p = parseProbe(fx('mp4'));
  expect(p.container).toBe('mp4');
  expect(p.streams[0].language).toBeNull();
  expect(p.streams[1].title).toBe('LostFilm.TV');
  expect(resolutionOf(p)).toBe(1080);
  expect(hdrOf(p)).toBe(false);
});

test('Dolby Vision и нет длительности', () => {
  const p = parseProbe(fx('dv'));
  expect(p.streams[0].dv).toBe(true);
  expect(hdrOf(p)).toBe(true);
  expect(p.duration).toBeNull();
});
