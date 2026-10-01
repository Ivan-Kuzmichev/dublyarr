import { describe, expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers';
import { fakeTmdb } from './fake-tmdb';
import { fakeQbit } from './fake-qbit';
import { syncMovie } from '@/lib/movies';
import { seedStudios } from '@/lib/studios';
import { addSource } from '@/lib/sources';
import { subscribe } from '@/lib/subscriptions';
import { searchSubscription, dueTitles } from '@/lib/autosearch';
import { movieUpgrade } from '@/lib/movie-search';
import { DEFAULT_MOVIE_PROFILE, type MovieProfile } from '@/lib/movie-profile';
import { DEFAULT_SCHEDULE } from '@/lib/schedule';
import { setSetting } from '@/lib/settings';
import { todayData } from '@/lib/dashboard';
import { bencode } from '@/lib/torrent-file';
import { downloads, episodeFiles, titles, wantedState, type EpisodeFile, type Release } from '@/lib/db/schema';
import type { MovieVerdict } from '@/lib/movie-evaluate';
import type { TmdbMovieDetails } from '@/lib/tmdb/types';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const GB = 1024 ** 3;
const fx = <T>(n: string) => JSON.parse(readFileSync(`tests/fixtures/tmdb/${n}.json`, 'utf8')) as T;
const b = (s: string) => Buffer.from(s);
const single = (name: string) => bencode(new Map<string, unknown>([['info', new Map<string, unknown>([['name', b(name)], ['length', 100], ['piece length', 1], ['pieces', Buffer.alloc(20)]])]]));

type Item = { title: string; size?: number; seeders?: number; hash: string };
const torznab = (items: Item[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>${items
    .map(
      (i) =>
        `<item><title>${i.title}</title><guid>https://rutracker.org/forum/viewtopic.php?t=${i.hash}</guid><jackettindexer id="rutracker">RuTracker.org</jackettindexer><comments>https://rutracker.org/forum/viewtopic.php?t=${i.hash}</comments><size>${(i.size ?? 10) * GB}</size><link>http://j/dl/${i.hash}</link><category>2000</category><torznab:attr name="seeders" value="${i.seeders ?? 50}" /><torznab:attr name="infohash" value="${i.hash.padEnd(40, '0')}" /></item>`,
    )
    .join('')}</channel></rss>`;

const MVO = { title: 'The Matrix [1999, WEB-DL 1080p] MVO (Jaskier) + Original Eng', hash: 'A1' };
const DUB = { title: 'The Matrix [1999, WEB-DL 1080p] Dub + Original Eng', hash: 'B2' };
const REMUX = { title: 'The Matrix [1999, BDRemux 1080p] Dub + Original Eng', hash: 'C3', size: 25 };

async function setup(o: { today?: string; items?: Item[]; profile?: Partial<MovieProfile>; movies?: string | null; digital?: string | null } = {}) {
  const db = testDb();
  seedStudios(db);
  const movie = fx<TmdbMovieDetails>('movie-603');
  movie.release_dates = { results: [] }; // дат цифрового релиза в TMDB нет — только по раздачам
  const t = await syncMovie(db, fakeTmdb({ details: {}, seasons: {}, movies: { 603: movie } }).tmdb, 603, 1);
  if (o.digital !== undefined) db.update(titles).set({ digitalSeenAt: o.digital }).where(eq(titles.id, t.id)).run();
  addSource(db, { name: 'J', url: 'http://j/api', apiKey: 'k' });
  const fq = fakeQbit();
  const state = { items: o.items ?? [MVO], queries: [] as string[] };
  const fetchImpl = (async (url: string | URL) => {
    state.queries.push(String(url));
    return new Response(torznab(state.items));
  }) as typeof fetch;
  const paths = { qbitDownloads: '/downloads', downloads: '/tmp/x', media: '/tmp/y', ...(o.movies === null ? {} : { movies: o.movies ?? '/tmp/m' }) };
  const deps = { qbit: fq.qbit, fetchTorrent: async (r: Release) => single(`${r.title.slice(0, 20)} #${r.id}.mkv`), paths, searchOpts: { fetchImpl }, today: o.today ?? '2026-10-01', now: Date.parse(`${o.today ?? '2026-10-01'}T12:00:00Z`) };
  subscribe(db, t.id, { ...DEFAULT_MOVIE_PROFILE, ...o.profile }, 1);
  const wanted = () => db.select().from(wantedState).where(eq(wantedState.titleId, t.id)).get();
  return { db, t, fq, deps, state, wanted };
}

describe('автопоиск фильма', () => {
  test('запросы с годом и категории фильмов; первая цифровая раздача — дата цифрового релиза', async () => {
    const s = await setup();
    await searchSubscription(s.db, s.t.id, s.deps);
    expect(s.state.queries.some((q) => q.includes('q=%D0%9C%D0%B0%D1%82%D1%80%D0%B8%D1%86%D0%B0+1999') || q.includes('q=%D0%9C%D0%B0%D1%82%D1%80%D0%B8%D1%86%D0%B0%201999'))).toBe(true);
    expect(s.state.queries.every((q) => q.includes('cat=2000'))).toBe(true);
    expect(s.db.select().from(titles).where(eq(titles.id, s.t.id)).get()!.digitalSeenAt).toBe('2026-10-01');
  });
  test('многоголосый до окна — не качается, статус «ждём дубляж до …»', async () => {
    const s = await setup();
    expect(await searchSubscription(s.db, s.t.id, s.deps)).toMatchObject({ started: 0, waiting: 1 });
    expect(s.wanted()).toMatchObject({ season: 0, number: 0, state: 'waiting', until: '2026-10-15', reason: 'Ждём дубляж до 15 окт' });
    expect(s.db.select().from(downloads).all()).toEqual([]);
  });
  test('окно прошло — качается многоголосый; появился дубляж — сразу дубляж', async () => {
    const late = await setup({ digital: '2026-09-01' });
    expect((await searchSubscription(late.db, late.t.id, late.deps)).started).toBe(1);
    expect(late.db.select().from(downloads).get()).toMatchObject({ kind: 'movie', episodes: [{ season: 0, number: 0 }], studioLabel: 'Многоголосый', dubPosition: 1 });
    expect(late.wanted()).toBeUndefined();
    const dub = await setup({ items: [MVO, DUB] });
    expect((await searchSubscription(dub.db, dub.t.id, dub.deps)).started).toBe(1);
    expect(dub.db.select().from(downloads).get()).toMatchObject({ studioLabel: 'Дубляж', dubPosition: 0 });
    expect((await searchSubscription(dub.db, dub.t.id, dub.deps)).started).toBe(0); // уже качается
  });
  test('цифровой был, раздач нет — «Нет раздач»; цифрового не было — «Ждём цифровой релиз»', async () => {
    const none = await setup({ items: [], digital: '2026-09-01' });
    await searchSubscription(none.db, none.t.id, none.deps);
    expect(none.wanted()).toMatchObject({ state: 'missing', reason: 'Нет раздач' });
    const early = await setup({ items: [] });
    await searchSubscription(early.db, early.t.id, early.deps);
    expect(early.wanted()).toMatchObject({ state: 'waiting', reason: 'Ждём цифровой релиз' });
    const tv = await setup({ items: [{ title: 'The Matrix [1999, HDTV 1080i] Dub', hash: 'D4' }] });
    await searchSubscription(tv.db, tv.t.id, tv.deps);
    expect(tv.wanted()).toMatchObject({ state: 'waiting', reason: 'Ждём цифровой релиз', until: null });
  });
  test('папка фильмов не задана — не качаем, пункт «Требует внимания»; сериалы не затронуты', async () => {
    const s = await setup({ items: [DUB], movies: null });
    expect((await searchSubscription(s.db, s.t.id, s.deps)).started).toBe(0);
    expect(s.wanted()).toMatchObject({ state: 'missing', reason: 'Не задана папка фильмов' });
    setSetting(s.db, 'paths', { downloads: '/tmp/x', media: '/tmp/y' });
    expect(todayData(s.db, '2026-10-01', Date.now()).attention).toContainEqual(expect.objectContaining({ title: 'Не задана папка фильмов', href: '/settings/download' }));
  });
  test('подписки на фильмы — в поиске по расписанию', async () => {
    const s = await setup();
    expect(dueTitles(s.db, new Date('2026-10-01T12:00:00'), DEFAULT_SCHEDULE)).toEqual([s.t.id]);
  });
});

describe('замена', () => {
  async function downloaded(o: Parameters<typeof setup>[0] & { pos?: number; importedDaysAgo?: number; source?: string } = {}) {
    const s = await setup({ digital: '2026-08-01', ...o });
    const now = Date.parse('2026-10-01T12:00:00Z');
    // скачанный файл из раздачи-источника
    const { releases } = await import('@/lib/db/schema');
    const rel = s.db
      .insert(releases)
      .values({ titleId: s.t.id, sourceId: 1, trackerName: 'RuTracker.org', title: o.source ?? MVO.title, size: 10 * GB, parsed: (await import('@/lib/parse/dubs')).parseRelease(o.source ?? MVO.title, {}, { id: 'rutracker', name: 'RuTracker.org' }, []), match: { score: 1, level: 'match', reasons: [] }, firstSeenAt: now, lastSeenAt: now })
      .returning()
      .get();
    const d = s.db.insert(downloads).values({ hash: 'f'.repeat(40), titleId: s.t.id, releaseId: rel.id, season: 0, kind: 'movie', episodes: [{ season: 0, number: 0 }], files: [], state: 'imported', progress: 1, size: 1, name: 'x', addedAt: 1 }).returning().get();
    s.db.insert(episodeFiles).values({ titleId: s.t.id, season: 0, number: 0, path: 'Матрица (1999)/Матрица (1999) [Многоголосый 1080p].mkv', size: 10 * GB, method: 'hardlink', importedAt: now - (o.importedDaysAgo ?? 2) * 86_400_000, dubPosition: o.pos ?? 1, resolution: 1080, downloadId: d.id }).run();
    return s;
  }
  test('скачан многоголосый, вышел дубляж — загрузка-улучшение с подписью', async () => {
    const s = await downloaded({ items: [MVO, DUB] });
    expect((await searchSubscription(s.db, s.t.id, s.deps)).started).toBe(1);
    expect(s.db.select().from(downloads).all().find((d) => d.state !== 'imported')).toMatchObject({ studioLabel: 'Дубляж', note: 'Улучшение: многоголосый → дубляж' });
  });
  test('без «заменить на дубляж» и через 181 день — дубляж не ищется', async () => {
    const off = await downloaded({ items: [DUB], profile: { replaceWithDub: false } });
    expect((await searchSubscription(off.db, off.t.id, off.deps)).started).toBe(0);
    expect(off.state.queries).toEqual([]);
    const old = await downloaded({ items: [DUB], importedDaysAgo: 181 });
    expect((await searchSubscription(old.db, old.t.id, old.deps)).started).toBe(0);
  });
  test('до BDRemux — только при «улучшить до BDRemux»', async () => {
    const dubWeb = 'The Matrix [1999, WEB-DL 1080p] Dub + Original Eng';
    const off = await downloaded({ items: [REMUX], pos: 0, source: dubWeb });
    expect((await searchSubscription(off.db, off.t.id, off.deps)).started).toBe(0);
    const on = await downloaded({ items: [REMUX], pos: 0, source: dubWeb, profile: { remux: true } });
    expect((await searchSubscription(on.db, on.t.id, on.deps)).started).toBe(1);
    expect(on.db.select().from(downloads).all().find((d) => d.state !== 'imported')!.note).toBe('Улучшение: WEB-DL → BDRemux');
  });
  test('movieUpgrade: чистая проверка', () => {
    const f = { dubPosition: 1, importedAt: Date.parse('2026-09-20') } as EpisodeFile;
    const v = (o: Partial<MovieVerdict>): MovieVerdict => ({ releaseId: 1, ok: true, best: true, reason: '', position: 0, tone: 'best', remux: false, ...o });
    expect(movieUpgrade(f, [v({})], DEFAULT_MOVIE_PROFILE, '2026-10-01', 'webdl')).toMatchObject({ note: 'Улучшение: многоголосый → дубляж' });
    expect(movieUpgrade(f, [v({ position: 1 })], DEFAULT_MOVIE_PROFILE, '2026-10-01', 'webdl')).toBeNull();
    expect(movieUpgrade({ ...f, dubPosition: 0 }, [v({ remux: true })], { ...DEFAULT_MOVIE_PROFILE, remux: true }, '2026-10-01', 'webdl')).toMatchObject({ note: 'Улучшение: WEB-DL → BDRemux' });
    expect(movieUpgrade({ ...f, dubPosition: 0 }, [v({ remux: true, position: 1 })], { ...DEFAULT_MOVIE_PROFILE, remux: true }, '2026-10-01', 'webdl')).toBeNull(); // перевод хуже — нет
  });
});

test('ручной поиск фильма: причины отказа и лучшая раздача', async () => {
  const { runManualMovieSearch } = await import('@/lib/manual-search');
  const s = await setup({ items: [MVO, DUB, { title: 'The Matrix [1999, HDTV 1080i] Dub', hash: 'D4' }] });
  const r = await runManualMovieSearch(s.db, 603, { ...s.deps.searchOpts, now: s.deps.now, today: '2026-10-01' });
  expect(r.profileSource).toBe('subscription');
  expect(r.rows.map((x) => x.verdict.reason)).toEqual(['Лучший · Дубляж', 'Рано: ждём дубляж до 15 окт', 'Не цифровой релиз']);
});

describe('исправления по ревью 3c', () => {
  test('удалённый правилом или вручную фильм не качается снова', async () => {
    const { retiredEpisodes } = await import('@/lib/db/schema');
    const s = await setup({ items: [DUB] });
    s.db.insert(retiredEpisodes).values({ titleId: s.t.id, season: 0, number: 0, at: 1 }).run();
    expect((await searchSubscription(s.db, s.t.id, s.deps)).started).toBe(0);
    expect(s.state.queries).toEqual([]);
  });
  test('многоголосый первым в профиле (или дубляж выключен) — качается сразу, без ожидания', async () => {
    const first = await setup({ profile: { dubs: [{ kind: 'mvo', on: true }, { kind: 'dub', on: true }, { kind: 'original', on: true }] } });
    expect((await searchSubscription(first.db, first.t.id, first.deps)).started).toBe(1);
    const off = await setup({ profile: { dubs: [{ kind: 'dub', on: false }, { kind: 'mvo', on: true }, { kind: 'original', on: true }] } });
    expect((await searchSubscription(off.db, off.t.id, off.deps)).started).toBe(1);
  });
  test('ответ в Telegram по фильму ведёт в ручной поиск фильма', async () => {
    const { notifyWanted } = await import('@/lib/notify-events');
    const { notifications, releases } = await import('@/lib/db/schema');
    const s = await setup();
    const { setSecretSetting } = await import('@/lib/settings');
    setSecretSetting(s.db, 'telegram', { token: 'x', baseUrl: 'http://nas:3000' });
    await searchSubscription(s.db, s.t.id, s.deps);
    const r = s.db.select().from(releases).get()!;
    notifyWanted(s.db, { titleId: s.t.id, season: 0, number: 0, state: 'ask', reason: 'Сомнительное совпадение', releaseId: r.id, until: null }, null);
    const n = s.db.select().from(notifications).all().find((x) => x.kind === 'ask')!;
    expect(JSON.stringify(n.buttons)).toContain('Не тот фильм');
    expect(JSON.stringify(n.buttons)).toContain('/search/603?type=movie');
    expect(n.text).toMatch(/^❓ Матрица: /);
  });
});
