import { expect, test } from 'vitest';
import { mkvTrackIds, remapPlan } from '@/lib/media/track-ids';
import { parseProbe } from '@/lib/media/probe';
import type { TrackPlan } from '@/lib/media/tracks';

const probe = (container: string, types: string[]) =>
  parseProbe({ streams: types.map((t, index) => ({ index, codec_type: t, codec_name: t === 'data' ? 'tmcd' : 'x', tags: {} })), format: { format_name: container, duration: '100' } });
const ident = (types: string[], o: { recognized?: boolean; supported?: boolean } = {}) => ({
  container: { recognized: o.recognized ?? true, supported: o.supported ?? true },
  tracks: types.map((type, id) => ({ id, type })),
});

test('mkv — номера как у ffprobe, mkvmerge не спрашиваем', () => {
  expect(mkvTrackIds(probe('matroska,webm', ['video', 'audio']), null)).toEqual(new Map([[0, 0], [1, 1]]));
});

test('mp4: служебная дорожка ffprobe (tmcd) не сдвигает номера mkvmerge', () => {
  const p = probe('mov,mp4,m4a,3gp,3g2,mj2', ['data', 'video', 'audio', 'audio']);
  expect(mkvTrackIds(p, ident(['video', 'audio', 'audio']))).toEqual(new Map([[1, 0], [2, 1], [3, 2]]));
});

test('ts: порядок типов у mkvmerge другой — сопоставление по порядку внутри типа', () => {
  const p = probe('mpegts', ['video', 'audio', 'audio', 'subtitle']);
  expect(mkvTrackIds(p, ident(['audio', 'audio', 'video', 'subtitles']))).toEqual(new Map([[0, 2], [1, 0], [2, 1], [3, 3]]));
});

test('не сходится число дорожек или контейнер не читается — null (кладём как есть)', () => {
  expect(mkvTrackIds(probe('avi', ['video', 'audio', 'audio']), ident(['video', 'audio']))).toBeNull();
  expect(mkvTrackIds(probe('asf', ['video', 'audio']), ident([], { recognized: false }))).toBeNull();
  expect(mkvTrackIds(probe('asf', ['video', 'audio']), ident(['video', 'audio'], { supported: false }))).toBeNull();
  expect(mkvTrackIds(probe('avi', ['video', 'audio']), null)).toBeNull();
});

test('план переводится в номера mkvmerge', () => {
  const plan: TrackPlan = { changed: true, audio: [2, 1], subs: [3], order: [0, 2, 1, 3], defaults: { audio: 2, sub: null }, external: [], untouchedAudio: false };
  const ids = new Map([[0, 2], [1, 0], [2, 1], [3, 3]]);
  expect(remapPlan(plan, ids)).toEqual({ ...plan, audio: [1, 0], subs: [3], order: [2, 1, 0, 3], defaults: { audio: 1, sub: null } });
});

test('имя и язык дорожек для mkvmerge: title или handler_name, кроме служебных «SoundHandler»', async () => {
  const { trackMeta } = await import('@/lib/media/track-ids');
  const p = parseProbe({ streams: [
    { index: 0, codec_type: 'video', tags: { handler_name: 'VideoHandler' } },
    { index: 1, codec_type: 'audio', tags: { handler_name: 'SoundHandler' } },
    { index: 2, codec_type: 'audio', tags: { handler_name: 'HDrezka Studio', language: 'rus' } },
  ], format: { format_name: 'mov,mp4', duration: '1' } });
  expect(trackMeta(p, new Map([[0, 0], [1, 1], [2, 2]]))).toEqual(new Map([[2, { name: 'HDrezka Studio', language: 'rus' }]]));
  expect(trackMeta({ ...p, container: 'matroska' }, new Map([[2, 2]]))).toEqual(new Map());
});
