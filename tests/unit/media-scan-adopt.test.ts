import { expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { testDb } from './helpers';
import { adoptItem, type AdoptDeps } from '@/lib/media-scan/adopt';
import { episodeFiles, seasons, titles, episodes, subscriptions } from '@/lib/db/schema';
import type { Runner } from '@/lib/media/runner';
import { seedStudios } from '@/lib/studios';

const noTools: Runner = { available: async () => ({ ffprobe: false, mkvmerge: false }) } as unknown as Runner;
function setup() {
  const db = testDb();
  seedStudios(db);
  const media = mkdtempSync(path.join(tmpdir(), 'dy-adopt-'));
  const put = (rel: string, body = 'video') => (mkdirSync(path.dirname(path.join(media, rel)), { recursive: true }), writeFileSync(path.join(media, rel), body), path.join(media, rel));
  const t = db.insert(titles).values({ tmdbId: 125988, tmdbType: 'tv', kind: 'series', nameRu: 'Укрытие', nameOriginal: 'Silo', year: 2023, originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: Date.now() }).returning().get();
  db.insert(seasons).values({ titleId: t.id, number: 3, name: 'S3', episodeCount: 10 }).run();
  db.insert(episodes).values([1, 2].map((n) => ({ titleId: t.id, season: 3, number: n, name: `E${n}`, airDate: '2026-07-01' }))).run();
  const deps = (o: Partial<AdoptDeps> = {}): AdoptDeps => ({ tmdb: null, runner: noTools, paths: { downloads: media, media }, seeding: new Set(), now: 5, userCanSubscribe: true, ...o });
  return { db, media, put, t, deps };
}
const choice = (o = {}) => ({ key: 'Silo', root: 'media' as const, tmdbId: 125988, type: 'tv' as const, filesOnly: true, process: false, episodes: [{ rel: 'Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.mkv', season: 3, number: 1, sidecars: [] }], ...o });

test('не раздаётся — перемещение по шаблону, запись в episode_files, «только файлы», старая папка ушла', async () => {
  const { db, media, put, deps } = setup();
  put('Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.mkv');
  put('Silo/@eaDir/x.jpg');
  const r = await adoptItem(db, deps(), choice());
  expect(r).toMatchObject({ added: 1, skipped: [], left: 0 });
  const row = db.select().from(episodeFiles).get()!;
  expect(row).toMatchObject({ season: 3, number: 1, method: 'move', downloadId: null });
  expect(existsSync(path.join(media, row.path))).toBe(true);
  expect(row.path).toBe('Укрытие (2023)/Season 03/Укрытие S03E01 [LostFilm 1080p].mkv');
  expect(existsSync(path.join(media, 'Silo'))).toBe(false);
  expect(db.select().from(subscriptions).get()).toMatchObject({ filesOnly: true });
});

test('раздаётся — жёсткая ссылка (inode тот же), оригинал на месте; .srt — рядом с новым именем', async () => {
  const { db, media, put, deps } = setup();
  const src = put('Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.mkv');
  put('Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.forced.rus.srt', 'sub');
  const r = await adoptItem(db, deps({ seeding: new Set([src]) }), choice({ episodes: [{ ...choice().episodes[0], sidecars: ['Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.forced.rus.srt'] }] }));
  const row = db.select().from(episodeFiles).get()!;
  expect(row.method).toBe('hardlink');
  expect(statSync(path.join(media, row.path)).ino).toBe(statSync(src).ino);
  expect(existsSync(src)).toBe(true);
  expect(readFileSync(path.join(media, 'Укрытие (2023)/Season 03/Укрытие S03E01 [LostFilm 1080p].forced.rus.srt'), 'utf8')).toBe('sub');
  expect(r.left).toBe(2); // видео и .srt остались для раздачи
});

test('по целевому пути уже лежит файл — «Уже есть», ничего не перезаписано', async () => {
  const { db, media, put, deps } = setup();
  put('Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.mkv', 'new');
  put('Укрытие (2023)/Season 03/Укрытие S03E01 [LostFilm 1080p].mkv', 'mine');
  const r = await adoptItem(db, deps(), choice());
  expect(r.skipped).toEqual([{ rel: 'Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.mkv', why: 'Уже есть: Укрытие (2023)/Season 03/Укрытие S03E01 [LostFilm 1080p].mkv' }]);
  expect(readFileSync(path.join(media, 'Укрытие (2023)/Season 03/Укрытие S03E01 [LostFilm 1080p].mkv'), 'utf8')).toBe('mine');
  expect(db.select().from(episodeFiles).all()).toEqual([]);
});

test('путь вне медиатеки — отказ позиции', async () => {
  const { db, deps } = setup();
  const r = await adoptItem(db, deps(), choice({ episodes: [{ rel: '../etc/passwd', season: 3, number: 1, sidecars: [] }] }));
  expect(r.error).toBe('Путь вне медиатеки');
});

test('qBittorrent недоступен (seeding = null) — жёсткие ссылки, позиция не падает', async () => {
  const { db, put, deps } = setup();
  const src = put('Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.mkv');
  await adoptItem(db, { ...deps(), seeding: null as unknown as Set<string> }, choice());
  expect(db.select().from(episodeFiles).get()!.method).toBe('hardlink');
  expect(existsSync(src)).toBe(true);
});

test('с подпиской — обычная подписка (filesOnly false)', async () => {
  const { db, put, deps } = setup();
  put('Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.mkv');
  await adoptItem(db, deps(), choice({ filesOnly: false }));
  expect(db.select().from(subscriptions).get()).toMatchObject({ filesOnly: false });
});

const remuxRunner = (): Runner => ({
  available: async () => ({ ffprobe: true, mkvmerge: true }),
  probe: async () => ({
    streams: [
      { index: 0, codec_name: 'h264', codec_type: 'video', width: 1920, height: 1080, disposition: { default: 1 }, tags: {} },
      { index: 1, codec_name: 'ac3', codec_type: 'audio', channels: 6, disposition: { default: 1 }, tags: { language: 'rus', title: 'LostFilm' } },
      { index: 2, codec_name: 'subrip', codec_type: 'subtitle', disposition: { default: 0 }, tags: { language: 'ger' } },
    ],
    format: { format_name: 'matroska,webm', duration: '2700' },
  }),
  identify: async () => null,
  async mkvmerge(args) {
    writeFileSync(args[1], 'пересобрано');
    return { code: 0, output: '' };
  },
});

test('пересборка: результат проверен — оригинал удаляется, если не раздаётся; раздаётся — остаётся', async () => {
  const { db, media, put, deps } = setup();
  const src = put('Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.mkv');
  const r = await adoptItem(db, deps({ runner: remuxRunner() }), choice({ process: true }));
  expect(r.added).toBe(1);
  const row = db.select().from(episodeFiles).get()!;
  expect(row).toMatchObject({ processed: true, method: 'copy' });
  expect(readFileSync(path.join(media, row.path), 'utf8')).toBe('пересобрано');
  expect(existsSync(src)).toBe(false);

  const b = setup();
  const src2 = b.put('Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.mkv');
  await adoptItem(b.db, b.deps({ runner: remuxRunner(), seeding: new Set([src2]) }), choice({ process: true }));
  expect(existsSync(src2)).toBe(true);
});
