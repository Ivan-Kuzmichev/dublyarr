import { expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
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

test('фильм, найденный в корне медиатеки, — в папку фильмов (как его ищут все остальные); папки фильмов нет — отказ', async () => {
  const { db, media, put, deps } = setup();
  const movies = mkdtempSync(path.join(tmpdir(), 'dy-movies-'));
  db.insert(titles).values({ tmdbId: 9614, tmdbType: 'movie', kind: 'movie', nameRu: 'Счастливчик Гилмор', nameOriginal: 'Happy Gilmore', year: 1996, originalLanguage: 'en', status: 'released', createdAt: 1, refreshedAt: Date.now() }).run();
  put('Happy.Gilmore.1996.BDREMUX.mkv');
  const movie = { key: 'Happy.Gilmore.1996.BDREMUX.mkv', root: 'media' as const, tmdbId: 9614, type: 'movie' as const, filesOnly: true, process: false, episodes: [{ rel: 'Happy.Gilmore.1996.BDREMUX.mkv', season: 0, number: 0, sidecars: [] }] };
  expect((await adoptItem(db, deps(), movie)).error).toBe('Не задана папка фильмов');
  const r = await adoptItem(db, deps({ paths: { downloads: media, media, movies } }), movie);
  expect(r.added).toBe(1);
  const row = db.select().from(episodeFiles).get()!;
  expect(existsSync(path.join(movies, row.path))).toBe(true);
  expect(existsSync(path.join(media, 'Happy.Gilmore.1996.BDREMUX.mkv'))).toBe(false);
});

test('отказ «нет папки фильмов» — подписка не создаётся', async () => {
  const { db, put, deps } = setup();
  db.insert(titles).values({ tmdbId: 9614, tmdbType: 'movie', kind: 'movie', nameRu: 'Счастливчик Гилмор', nameOriginal: 'Happy Gilmore', year: 1996, originalLanguage: 'en', status: 'released', createdAt: 1, refreshedAt: Date.now() }).run();
  put('Happy.Gilmore.1996.BDREMUX.mkv');
  await adoptItem(db, deps(), { key: 'Happy.Gilmore.1996.BDREMUX.mkv', root: 'media', tmdbId: 9614, type: 'movie', filesOnly: true, process: false, episodes: [{ rel: 'Happy.Gilmore.1996.BDREMUX.mkv', season: 0, number: 0, sidecars: [] }] });
  expect(db.select().from(subscriptions).all()).toEqual([]);
});

test('у серии уже есть файл в Dublyarr — «Уже есть в Dublyarr», ничего не перенесено (повтор, второй экземпляр)', async () => {
  const { db, put, deps, t } = setup();
  const src = put('Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.mkv');
  db.insert(episodeFiles).values({ titleId: t.id, season: 3, number: 1, path: 'Укрытие (2023)/Season 03/Укрытие S03E01 [LostFilm 2160p].mkv', size: 1, method: 'hardlink', importedAt: 1 }).run();
  const r = await adoptItem(db, deps(), choice());
  expect(r.skipped).toEqual([{ rel: 'Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.mkv', why: 'Уже есть в Dublyarr: Укрытие (2023)/Season 03/Укрытие S03E01 [LostFilm 2160p].mkv' }]);
  expect(existsSync(src)).toBe(true);
});

test('файл уже лежит ровно по шаблону — записывается без переноса', async () => {
  const { db, media, put, deps } = setup();
  put('Укрытие (2023)/Season 03/Укрытие S03E01 [LostFilm 1080p].mkv');
  const r = await adoptItem(db, deps(), choice({ key: 'Укрытие (2023)', episodes: [{ rel: 'Укрытие (2023)/Season 03/Укрытие S03E01 [LostFilm 1080p].mkv', season: 3, number: 1, sidecars: [] }] }));
  expect(r).toMatchObject({ added: 1, skipped: [] });
  expect(existsSync(path.join(media, 'Укрытие (2023)/Season 03/Укрытие S03E01 [LostFilm 1080p].mkv'))).toBe(true);
});

test('исходника уже нет (повтор после сбоя) — пропуск с причиной, остальные серии идут', async () => {
  const { db, put, deps } = setup();
  put('Silo/Season 03/Silo - S03E02 - WEB-DL 1080p LostFilm.mkv');
  const r = await adoptItem(db, deps({ runner: remuxRunner() }), choice({ process: true, episodes: [choice().episodes[0], { rel: 'Silo/Season 03/Silo - S03E02 - WEB-DL 1080p LostFilm.mkv', season: 3, number: 2, sidecars: [] }] }));
  expect(r.error).toBeUndefined();
  expect(r.skipped).toEqual([{ rel: 'Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.mkv', why: 'Файла нет' }]);
  expect(r.added).toBe(1);
});

test('без пересборки ffprobe всё равно проверяет: не та серия (сэмпл 30 с при серии 45 мин) — пропуск; разрешение — из файла', async () => {
  const { db, put, deps, t } = setup();
  db.update(episodes).set({ runtime: 45 }).run();
  put('Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.mkv');
  const probeOnly = (sec: number): Runner => ({ ...remuxRunner(), available: async () => ({ ffprobe: true, mkvmerge: false }), probe: async () => ({ streams: [{ index: 0, codec_name: 'h264', codec_type: 'video', width: 3840, height: 2160, disposition: { default: 1 }, tags: {} }], format: { format_name: 'matroska,webm', duration: String(sec) } }) });
  const bad = await adoptItem(db, deps({ runner: probeOnly(30) }), choice());
  expect(bad.skipped[0].why).toMatch(/^Не та серия/);
  const ok = await adoptItem(db, deps({ runner: probeOnly(2700) }), choice());
  expect(ok.added).toBe(1);
  expect(db.select().from(episodeFiles).where(eq(episodeFiles.titleId, t.id)).get()).toMatchObject({ resolution: 2160, duration: 2700 });
});

test('сквозной номер (сезон 1, серия 12 при 10 сериях в первом) — в нужный сезон по TMDB; «осталось» — по папке позиции', async () => {
  const { db, media, put, deps, t } = setup();
  db.insert(seasons).values({ titleId: t.id, number: 1, name: 'S1', episodeCount: 10 }).run();
  db.update(seasons).set({ episodeCount: 5 }).where(eq(seasons.number, 3)).run();
  db.insert(seasons).values({ titleId: t.id, number: 2, name: 'S2', episodeCount: 0 }).run();
  put('Сериалы/Silo/Silo - 12.mkv');
  put('Сериалы/Other/keep.nfo');
  const r = await adoptItem(db, deps(), choice({ key: 'Сериалы/Silo', episodes: [{ rel: 'Сериалы/Silo/Silo - 12.mkv', season: 1, number: 12, sidecars: [] }] }));
  expect(r).toMatchObject({ added: 1, left: 0 });
  expect(db.select().from(episodeFiles).get()).toMatchObject({ season: 3, number: 2 });
  expect(existsSync(path.join(media, 'Сериалы/Other/keep.nfo'))).toBe(true);
});

test('«только файлы» — сериал по умолчанию «хранить все сезоны»: правило «сезоны» не удалит только что взятое', async () => {
  const { db, put, deps } = setup();
  put('Silo/Season 03/Silo - S03E01 - WEB-DL 1080p LostFilm.mkv');
  await adoptItem(db, deps(), choice());
  expect(db.select().from(subscriptions).get()).toMatchObject({ filesOnly: true, keepAll: true });
});
