import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { seedStudios, listStudios, findStudioByAlias, createStudio, updateStudio, deleteStudio, normalizeStudio, StudioError } from '@/lib/studios';
import { STUDIO_SEED } from '@/lib/studio-seed';
import { subscriptions, titles } from '@/lib/db/schema';

test('нормализация', () => {
  expect(normalizeStudio(' Кураж-Бамбей ')).toBe('куражбамбей');
  expect(normalizeStudio('LostFilm.TV')).toBe('lostfilmtv');
  expect(normalizeStudio('Жёлтый_Кот')).toBe('желтыйкот');
});

test('засев один раз; удалённая студия не возвращается', () => {
  const db = testDb();
  seedStudios(db);
  expect(listStudios(db)).toHaveLength(STUDIO_SEED.length);
  const lf = findStudioByAlias(db, 'lostfilm.tv')!;
  deleteStudio(db, lf.id);
  seedStudios(db);
  expect(findStudioByAlias(db, 'LostFilm')).toBeUndefined();
});

test('поиск по варианту и фильтр по типу', () => {
  const db = testDb();
  seedStudios(db);
  expect(findStudioByAlias(db, 'HDREZKA')?.name).toBe('HDrezka Studio');
  expect(findStudioByAlias(db, 'Анилибрия')?.name).toBe('AniLibria');
  const anime = listStudios(db, 'anime').map((s) => s.name);
  expect(anime).toContain('AniDUB');
  expect(anime).toContain('Дубляж'); // both
  expect(anime).not.toContain('LostFilm');
});

test('конфликты имён и вариантов', () => {
  const db = testDb();
  seedStudios(db);
  expect(() => createStudio(db, { name: 'Новая', aliases: ['HDrezka'], kind: 'series', trackers: [] })).toThrow('«HDrezka» уже есть у студии HDrezka Studio');
  expect(() => createStudio(db, { name: ' lostfilm ', aliases: [], kind: 'series', trackers: [] })).toThrow(StudioError);
  expect(() => createStudio(db, { name: '  ', aliases: [], kind: 'series', trackers: [] })).toThrow('Введите название студии');
  const s = createStudio(db, { name: 'Paravozik', aliases: [' Паровозик ', '', 'Паровозик'], kind: 'series', trackers: [' NNM-Club '] });
  expect(s).toMatchObject({ aliases: ['Паровозик'], trackers: ['nnm-club'], source: 'manual' });
  expect(updateStudio(db, s.id, { name: 'Paravozik Studio', aliases: ['Paravozik'], kind: 'both', trackers: [] }).name).toBe('Paravozik Studio');
});

test('используемую студию удалить нельзя', () => {
  const db = testDb();
  seedStudios(db);
  const lf = findStudioByAlias(db, 'LostFilm')!;
  const t = db
    .insert(titles)
    .values({ tmdbId: 1, kind: 'series', nameRu: 'A', nameOriginal: 'A', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 })
    .returning()
    .get();
  db.insert(subscriptions)
    .values({
      titleId: t.id,
      subscribedAt: 1,
      updatedAt: 1,
      profile: {
        dubs: [{ kind: 'studio', studioId: lf.id, waitDays: 0 }],
        quality: { target: 1080, allowLower: true, preferHdr: false, maxSizeGb: null },
        scope: { mode: 'all' },
        wholeSeasonAfterFinale: false,
        replaceWithHigher: true,
        autoNextSeason: true,
      },
    })
    .run();
  expect(() => deleteStudio(db, lf.id)).toThrow('Студия используется: подписок — 1');
});

test('написание из одних знаков препинания не принимается', () => {
  const db = testDb();
  expect(() => createStudio(db, { name: '.', aliases: [], kind: 'series', trackers: [] })).toThrow('Введите название студии');
  const s = createStudio(db, { name: 'Ok', aliases: ['-', ' . '], kind: 'series', trackers: [] });
  expect(s.aliases).toEqual([]);
  expect(findStudioByAlias(db, '---')).toBeUndefined();
});

test('засев и флаг — одной транзакцией: повторный засев после сбоя не падает', () => {
  const db = testDb();
  seedStudios(db);
  // имитация «упали после засева, но до флага»
  db.$client.prepare("DELETE FROM app_settings WHERE key = 'studios.seeded'").run();
  expect(() => seedStudios(db)).not.toThrow();
  expect(listStudios(db)).toHaveLength(STUDIO_SEED.length);
});
