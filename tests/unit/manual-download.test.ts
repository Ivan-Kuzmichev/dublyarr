import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { fakeQbit } from './fake-qbit';
import { bencode } from '@/lib/torrent-file';
import { downloadRelease } from '@/lib/manual-download';
import { episodes, releases, sources, titles } from '@/lib/db/schema';
import type { ParsedRelease } from '@/lib/parse/types';

process.env.DUBLYARR_SECRET_KEY ??= randomBytes(32).toString('base64');
const b = (s: string) => Buffer.from(s);
const torrent = (name: string, files: string[]) =>
  bencode(new Map<string, unknown>([['info', new Map<string, unknown>([['name', b(name)], ['piece length', 1], ['pieces', Buffer.alloc(20)], ['files', files.map((f) => new Map<string, unknown>([['length', 100], ['path', [b(f)]]]))]])]]));
const parsed = (o: Partial<ParsedRelease>): ParsedRelease => ({
  base: 'x', names: [], year: null, seasons: [1], episodes: null, totalInSeason: null, absolute: false, pack: true,
  resolution: 1080, source: 'webdl', hdr: false, dv: false, screener: false, dubs: [], original: false, subs: false, ...o,
});

function setup(kind: 'series' | 'movie' = 'series') {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 1, kind, tmdbType: kind === 'movie' ? 'movie' : 'tv', nameRu: 'A', nameOriginal: 'A', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  for (const n of [1, 2]) db.insert(episodes).values({ titleId: t.id, season: 1, number: n, name: `E${n}`, airDate: '2020-01-01' }).run();
  const s = db.insert(sources).values({ name: 'J', url: 'http://j', createdAt: 1 }).returning().get();
  const r = db.insert(releases).values({ titleId: t.id, sourceId: s.id, trackerName: 'X', title: 'A S01', size: 200, firstSeenAt: 1, lastSeenAt: 1, parsed: parsed({}), match: { score: 1, level: 'match', reasons: [] } }).returning().get();
  const fq = fakeQbit();
  const deps = { qbit: fq.qbit, paths: { qbitDownloads: '/downloads', downloads: '/d', media: '/m' }, fetchTorrent: async () => torrent('A S01', ['A.S01E01.mkv', 'A.S01E02.mkv']) };
  return { db, t, r, fq, deps };
}

test('серия из пака — в загрузках', async () => {
  const { db, t, r, deps } = setup();
  expect(await downloadRelease(db, deps, { title: t, releaseId: r.id, season: 1, episode: 2 })).toEqual({ ok: 'Добавлено в загрузки' });
});

test('нет qBittorrent — понятная ошибка', async () => {
  const { db, t, r, deps } = setup();
  expect(await downloadRelease(db, { ...deps, qbit: null }, { title: t, releaseId: r.id, season: 1, episode: 2 })).toEqual({ error: 'Подключите qBittorrent и папки в настройках' });
});

test('фильм без папки фильмов — понятная ошибка', async () => {
  const { db, t, r, deps } = setup('movie');
  expect(await downloadRelease(db, deps, { title: t, releaseId: r.id })).toEqual({ error: 'Задайте папку фильмов в «Загрузке и папках»' });
});
