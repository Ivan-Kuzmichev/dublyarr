import { expect, test } from 'vitest';
import { toolAvailable } from '@/lib/media/runner';

test('ffprobe/mkvmerge «нет» — только если программы нет в системе; не успела ответить (NAS занят) — есть', () => {
  expect(toolAvailable({ code: 0, missing: false })).toBe(true);
  expect(toolAvailable({ code: -1, missing: false })).toBe(true); // таймаут 2.8.0: ffprobe -version > 10 с на старте
  expect(toolAvailable({ code: -1, missing: true })).toBe(false); // spawn ENOENT
});
