import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { movieCard } from '@/lib/movie-card';
import { DEFAULT_MOVIE_PROFILE } from '@/lib/movie-profile';
import { downloads, episodeFiles, subscriptions, titles, wantedState } from '@/lib/db/schema';

const GB = 1024 ** 3;
const TODAY = '2026-10-01';

function setup(dates = { theatrical: '2026-08-14', digital: '2026-09-20', physical: null as string | null }) {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 1, tmdbType: 'movie', kind: 'movie', nameRu: 'Фильм', nameOriginal: 'Film', originalLanguage: 'en', year: 2026, status: 'released', runtime: 120, releaseDates: dates, createdAt: 1, refreshedAt: 1 }).returning().get();
  return { db, t };
}
const steps = (c: ReturnType<typeof movieCard>) => c.steps.map((s) => [s.title, s.state, s.sub]);

test('без подписки: кинотеатры прошли, цифровой — дата; дубляж и файл — нет', () => {
  const { db, t } = setup();
  expect(steps(movieCard(db, t, TODAY))).toEqual([
    ['Кинотеатры', 'done', '14 авг'],
    ['Цифровой релиз', 'done', '20 сент'],
    ['Дубляж', 'none', '—'],
    ['В медиатеке', 'none', 'ещё нет'],
  ]);
  expect(movieCard(db, t, TODAY).status).toBe('');
});

test('ждём дубляж — прогноз до даты; цифрового ещё нет — «ожидается»', () => {
  const { db, t } = setup({ theatrical: '2026-09-01', digital: '2026-10-20', physical: null });
  db.insert(subscriptions).values({ titleId: t.id, profile: DEFAULT_MOVIE_PROFILE, subscribedAt: 1, updatedAt: 1 }).run();
  db.insert(wantedState).values({ titleId: t.id, season: 0, number: 0, state: 'waiting', reason: 'Ждём цифровой релиз', checkedAt: 1 }).run();
  let c = movieCard(db, t, TODAY);
  expect(c.steps[1]).toMatchObject({ state: 'wait', sub: 'ожидается 20 окт' });
  expect(c.status).toBe('Ждём цифровой релиз');
  db.update(wantedState).set({ reason: 'Ждём дубляж до 12 окт', until: '2026-10-12' }).run();
  c = movieCard(db, t, TODAY);
  expect(c.steps[2]).toMatchObject({ state: 'forecast', sub: 'ждём до 12 окт' });
  expect(c.status).toBe('Ждём дубляж до 12 окт');
});

test('качается; скачан в многоголосом — ждём замену; скачан с дубляжом', () => {
  const { db, t } = setup();
  db.insert(subscriptions).values({ titleId: t.id, profile: DEFAULT_MOVIE_PROFILE, subscribedAt: 1, updatedAt: 1 }).run();
  const d = db.insert(downloads).values({ hash: 'a'.repeat(40), titleId: t.id, season: 0, kind: 'movie', episodes: [{ season: 0, number: 0 }], state: 'downloading', progress: 0.42, name: 'x', size: 1, addedAt: 1, dubPosition: 1, studioLabel: 'Многоголосый' }).returning().get();
  let c = movieCard(db, t, TODAY);
  expect(c.steps[3]).toMatchObject({ state: 'wait', sub: 'качается · 42 %' });
  expect(c.status).toBe('Качается · 42 %');
  db.update(downloads).set({ state: 'imported' }).run();
  db.insert(episodeFiles).values({ titleId: t.id, season: 0, number: 0, path: 'x.mkv', size: 24 * GB, method: 'hardlink', importedAt: 1, dubPosition: 1, resolution: 2160, hdr: true, processed: true, studioLabel: 'Многоголосый', downloadId: d.id }).run();
  c = movieCard(db, t, TODAY);
  expect(c.steps[2]).toMatchObject({ state: 'wait', sub: 'заменим, когда выйдет' });
  expect(c.steps[3]).toMatchObject({ state: 'done', sub: 'Многоголосый · 2160p · 24 ГБ' });
  expect(c.file).toEqual({ dub: 'Многоголосый', quality: '2160p', hdr: true, size: 24 * GB, processed: true });
  expect(c.status).toBe('Многоголосый · 2160p · 24 ГБ');
  db.update(episodeFiles).set({ dubPosition: 0, studioLabel: 'Дубляж' }).run();
  expect(movieCard(db, t, TODAY).steps[2]).toMatchObject({ state: 'done', sub: 'есть' });
});
