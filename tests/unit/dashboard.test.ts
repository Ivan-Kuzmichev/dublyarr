import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { episodeStatuses, todayData, calendarWeek, mondayOf, seriesDubColumns, speedBlock, delayBasis } from '@/lib/dashboard';
import { setSetting } from '@/lib/settings';
import { downloads, episodeFiles, episodes, notices, oldCopies, seasons, studioSightings, studios, subscriptions, titles, wantedState } from '@/lib/db/schema';
import type { Profile } from '@/lib/profile-core';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');
const HOUR = 3_600_000;
const today = '2026-09-30';
const NOW = Date.parse('2026-09-30T12:00:00');
const profile: Profile = {
  dubs: [{ kind: 'any', waitDays: 0 }],
  quality: { target: 1080, allowLower: true, preferHdr: false, maxSizeGb: null },
  scope: { mode: 'all' },
  wholeSeasonAfterFinale: false,
  replaceWithHigher: true,
  autoNextSeason: true,
};

function setup() {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 7, kind: 'series', nameRu: 'Дэдлок', nameOriginal: 'Deadloch', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  db.insert(seasons).values({ titleId: t.id, number: 1, name: 'Сезон 1', episodeCount: 6 }).run();
  const dates = ['2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30', '2026-10-02', null];
  dates.forEach((d, i) => db.insert(episodes).values({ titleId: t.id, season: 1, number: i + 1, name: `Серия ${i + 1}`, airDate: d }).run());
  db.insert(subscriptions).values({ titleId: t.id, profile, subscribedAt: 0, updatedAt: 0 }).run();
  db.insert(episodeFiles).values({ titleId: t.id, season: 1, number: 1, path: 'D/S01E01.mkv', size: 2 * 1024 ** 3, studioLabel: 'HDrezka Studio', resolution: 1080, method: 'hardlink', importedAt: NOW - HOUR }).run();
  db.insert(downloads).values({ hash: 'h', titleId: t.id, season: 1, kind: 'episode', episodes: [{ season: 1, number: 2 }], state: 'downloading', progress: 0.64, name: 'x', size: 1, addedAt: NOW - HOUR, dlSpeed: 1, eta: 60 }).run();
  db.insert(wantedState).values({ titleId: t.id, season: 1, number: 3, state: 'waiting', reason: 'Рано: ждём HDrezka Studio до 3 окт', until: '2026-10-03', checkedAt: NOW }).run();
  return { db, t };
}

test('статусы серий', () => {
  const { db, t } = setup();
  const s = episodeStatuses(db, t.id, today);
  expect(s.get('1:1')).toEqual({ state: 'downloaded', text: 'Скачана', detail: 'HDrezka Studio · 1080p · 2 ГБ' });
  expect(s.get('1:2')).toEqual({ state: 'downloading', text: 'Качается · 64 %' });
  expect(s.get('1:3')).toEqual({ state: 'waiting', text: 'Ждём озвучку', detail: 'с 3 окт' });
  expect(s.get('1:4')).toEqual({ state: 'missing', text: 'Ищем' });
  expect(s.get('1:5')).toEqual({ state: 'upcoming', text: 'Эфир через 2 дн' });
  expect(s.get('1:6')).toEqual({ state: 'upcoming', text: 'Дата не объявлена' });
});

test('без подписки статусов «ищем» нет', () => {
  const { db, t } = setup();
  db.delete(subscriptions).run();
  expect(episodeStatuses(db, t.id, today).get('1:4')).toBeUndefined();
});

test('«Сегодня»', () => {
  const { db } = setup();
  const d = todayData(db, today, NOW);
  expect(d.fresh).toEqual([
    expect.objectContaining({ tmdbId: 7, title: 'Дэдлок', code: 'S01E02', state: 'Качается · 64 %', loading: true }),
    expect.objectContaining({ code: 'S01E01', state: 'HDrezka Studio · скачано 1 ч назад', loading: false, quality: '1080p' }),
  ]);
  expect(d.waiting).toEqual([expect.objectContaining({ code: 'S01E03', aired: '23 сент', until: '3 окт', reason: 'Рано: ждём HDrezka Studio до 3 окт' })]);
  expect(d.downloads).toHaveLength(1);
  expect(d.week.map((w) => [w.day, w.code, w.kind])).toEqual([
    ['ср 30', 'S01E04', 'aired'],
    ['пт 2', 'S01E05', 'upcoming'],
  ]);
});

test('календарь недели', () => {
  const { db } = setup();
  expect(mondayOf('2026-09-30')).toBe('2026-09-28');
  expect(mondayOf('2026-09-28')).toBe('2026-09-28');
  expect(mondayOf('2026-10-04')).toBe('2026-09-28');
  const w = calendarWeek(db, '2026-09-28', today);
  expect(w.days.map((d) => d.label)).toEqual(['пн 28', 'вт 29', 'ср 30', 'чт 1', 'пт 2', 'сб 3', 'вс 4']);
  expect(w.days[2]).toMatchObject({ today: true, events: [expect.objectContaining({ code: 'S01E04', kind: 'aired', sub: 'оригинал' })] });
  expect(w.days[4].events[0]).toMatchObject({ kind: 'upcoming' });
  const prev = calendarWeek(db, '2026-09-07', today);
  expect(prev.days[2].events[0]).toMatchObject({ code: 'S01E01', kind: 'downloaded', sub: 'HDrezka Studio · 1080p' });
});

test('«Требует внимания»: нужен ответ и ошибки загрузок', () => {
  const { db, t } = setup();
  db.insert(wantedState).values({ titleId: t.id, season: 1, number: 4, state: 'ask', reason: 'Не уверен, что это тот сериал', until: null, checkedAt: NOW }).run();
  db.insert(downloads).values({ hash: 'e', titleId: t.id, season: 1, kind: 'pack', episodes: [{ season: 1, number: 5 }], state: 'error', lastError: 'В раздаче нет файла S01E05', progress: 0, name: 'p', size: 1, addedAt: NOW }).run();
  expect(todayData(db, today, NOW).attention).toEqual([
    { tmdbId: 7, title: 'Дэдлок', code: 'S01E04', text: 'Не уверен, что это тот сериал', href: '/search/7?s=1&e=4' },
    { tmdbId: 7, title: 'Дэдлок', code: 'S01E05', text: 'В раздаче нет файла S01E05', href: '/activity' },
  ]);
});

function withForecast() {
  const s = setup();
  const hd = s.db.insert(studios).values({ name: 'HDrezka', kind: 'both', source: 'manual', createdAt: 1 }).returning().get();
  s.db.update(subscriptions).set({ profile: { ...profile, dubs: [{ kind: 'studio', studioId: hd.id, waitDays: 0 }, { kind: 'any', waitDays: 10 }] } }).run();
  const seen = (n: number, iso: string) => s.db.insert(studioSightings).values({ titleId: s.t.id, studioId: hd.id, season: 1, number: n, seenAt: Date.parse(`${iso}T12:00:00Z`), basis: 'seen', fromPack: false }).run();
  seen(1, '2026-09-11'); // +2,5
  seen(2, '2026-09-18'); // +2,5
  return { ...s, hd };
}

test('«Ждём озвучку» с прогнозом', () => {
  const { db } = withForecast();
  expect(todayData(db, today, NOW).waiting[0]).toMatchObject({
    code: 'S01E03',
    etaText: '≈ сегодня',
    progress: 1,
    delayText: 'HDrezka обычно +2,5 дня',
    fallbackNote: 'Если HDrezka не выйдет до субботы — возьму любую, потом заменю.',
  });
});

test('календарь: прогноз озвучки — отдельное событие', () => {
  const { db } = withForecast();
  const w = calendarWeek(db, '2026-09-21', today);
  expect(w.days[5].events).toEqual([expect.objectContaining({ code: 'S01E03', kind: 'forecast', sub: 'HDrezka ≈ +2,5 д' })]);
});

test('карточка: колонки студий, скорость озвучки, основания', () => {
  const { db, t, hd } = withForecast();
  const c = seriesDubColumns(db, t.id, 1, today);
  expect(c.columns).toEqual(['HDrezka', 'Любая']);
  expect(c.cells.get(1)).toEqual([{ kind: 'done', text: '+2д' }, { kind: 'done', text: '+2д' }]);
  expect(c.cells.get(3)).toEqual([{ kind: 'expected', text: '26 сент' }, { kind: 'none', text: '—' }]);
  expect(c.cells.get(5)).toEqual([{ kind: 'none', text: '—' }, { kind: 'none', text: '—' }]);
  expect(speedBlock(db, t.id)).toEqual([{ name: 'HDrezka', text: '+2,5 дня', width: '100%' }]);
  expect(delayBasis(db, t.id)).toEqual({ [hd.id]: 'по 2 сериям' });
});

test('«Требует внимания»: старые копии ждут подтверждения правила', () => {
  const { db, t } = setup();
  db.insert(oldCopies).values({ titleId: t.id, season: 1, number: 1, path: '.dublyarr-old/a.mkv', size: 3 * 1024 ** 3, reason: 'X → Y', createdAt: 1 }).run();
  db.insert(oldCopies).values({ titleId: t.id, season: 1, number: 2, path: '.dublyarr-old/b.mkv', size: 1024 ** 3, reason: 'X → Y', createdAt: 1 }).run();
  expect(todayData(db, today, NOW).attention).toContainEqual({ tmdbId: 0, title: 'Старые копии после улучшения', code: '', text: '2 копии · 4 ГБ — подтвердите удаление', href: '/old-copies' });
  setSetting(db, 'retention.oldCopy.confirmed', true);
  expect(todayData(db, today, NOW).attention.some((a) => a.href === '/old-copies')).toBe(false);
});

test('«Сегодня»: новости — заметки за 3 дня', () => {
  const { db, t } = setup();
  db.insert(notices).values({ titleId: t.id, kind: 'season-subscribed', text: 'Подписался на 2-й сезон', createdAt: NOW - HOUR }).run();
  expect(todayData(db, today, NOW).news).toEqual([{ tmdbId: 7, title: 'Дэдлок', text: 'Подписался на 2-й сезон', createdAt: NOW - HOUR }]);
});
