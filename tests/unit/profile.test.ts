import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { seedStudios, findStudioByAlias, deleteStudio } from '@/lib/studios';
import {
  validateProfile,
  parseProfileJson,
  builtinProfile,
  getDefaultProfile,
  saveDefaultProfile,
  describeProfile,
  type Profile,
} from '@/lib/profile';

const base: Profile = {
  dubs: [
    { kind: 'studio', studioId: 1, waitDays: 3 },
    { kind: 'any', waitDays: 5 },
  ],
  quality: { target: 2160, allowLower: true, preferHdr: true, maxSizeGb: null },
  scope: { mode: 'new' },
  wholeSeasonAfterFinale: false,
  replaceWithHigher: true,
  autoNextSeason: true,
};
const known = new Set([1, 2]);

test('правильный профиль; первая позиция без ожидания; лишние поля отброшены', () => {
  const r = validateProfile({ ...base, hacker: 1, dubs: [{ ...base.dubs[0], extra: true }, base.dubs[1]] }, known);
  expect(r).toEqual({
    ok: true,
    profile: {
      ...base,
      dubs: [
        { kind: 'studio', studioId: 1, waitDays: 0 },
        { kind: 'any', waitDays: 5 },
      ],
    },
  });
});

test.each([
  [{ ...base, dubs: [] }, 'Выберите хотя бы одну озвучку'],
  [
    {
      ...base,
      dubs: [
        { kind: 'studio', studioId: 1, waitDays: 0 },
        { kind: 'studio', studioId: 1, waitDays: 1 },
      ],
    },
    'Студия выбрана дважды',
  ],
  [{ ...base, dubs: [{ kind: 'studio', studioId: 99, waitDays: 0 }] }, 'Неизвестная студия'],
  [
    {
      ...base,
      dubs: [
        { kind: 'any', waitDays: 0 },
        { kind: 'studio', studioId: 1, waitDays: 1 },
      ],
    },
    '«Любая» — только одна и последней',
  ],
  [
    {
      ...base,
      dubs: [
        { kind: 'original', waitDays: 0 },
        { kind: 'original', waitDays: 1 },
      ],
    },
    '«Оригинал» выбран дважды',
  ],
  [
    {
      ...base,
      dubs: [
        { kind: 'studio', studioId: 1, waitDays: 0 },
        { kind: 'any', waitDays: -5 },
      ],
    },
    'Ожидание — от 0 до 60 дней',
  ],
  [{ ...base, quality: { ...base.quality, target: 480 } }, 'Качество — 720p, 1080p или 2160p'],
  [{ ...base, quality: { ...base.quality, maxSizeGb: 0.1 } }, 'Лимит — от 0,5 до 200 ГБ'],
  [{ ...base, scope: { mode: 'from', season: 0, episode: 1, until: 'onward' } }, 'Сезон и серия — с 1'],
  [{ ...base, scope: { mode: 'later' } }, 'Неверные данные профиля'],
  [{ ...base, replaceWithHigher: 'да' }, 'Неверные данные профиля'],
  ['строка', 'Неверные данные профиля'],
])('отказ: %#', (raw, error) => {
  expect(validateProfile(raw, known)).toEqual({ ok: false, error });
});

test('не-JSON', () => {
  expect(parseProfileJson('{oops', known)).toEqual({ ok: false, error: 'Неверные данные профиля' });
});

test('встроенные профили по типу; удалённая студия пропускается', () => {
  const db = testDb();
  seedStudios(db);
  const lf = findStudioByAlias(db, 'LostFilm')!.id;
  const hd = findStudioByAlias(db, 'HDrezka')!.id;
  expect(builtinProfile(db, 'series').dubs).toEqual([
    { kind: 'studio', studioId: lf, waitDays: 0 },
    { kind: 'studio', studioId: hd, waitDays: 2 },
    { kind: 'any', waitDays: 5 },
  ]);
  expect(builtinProfile(db, 'series')).toMatchObject({
    quality: { target: 2160, allowLower: true, preferHdr: true, maxSizeGb: null },
    scope: { mode: 'new' },
  });
  deleteStudio(db, lf);
  expect(builtinProfile(db, 'series').dubs).toEqual([
    { kind: 'studio', studioId: hd, waitDays: 0 },
    { kind: 'any', waitDays: 5 },
  ]);
  deleteStudio(db, hd);
  expect(builtinProfile(db, 'series').dubs).toEqual([{ kind: 'any', waitDays: 0 }]);
});

test('сохранённый профиль по умолчанию; неизвестные студии из него выпадают', () => {
  const db = testDb();
  seedStudios(db);
  const ad = findStudioByAlias(db, 'AniDUB')!.id;
  const p: Profile = { ...base, dubs: [{ kind: 'studio', studioId: ad, waitDays: 0 }] };
  saveDefaultProfile(db, 'anime', p);
  expect(getDefaultProfile(db, 'anime')).toEqual(p);
  expect(getDefaultProfile(db, 'series').dubs[0]).toMatchObject({ kind: 'studio' });
  saveDefaultProfile(db, 'series', { ...base, dubs: [{ kind: 'studio', studioId: 9999, waitDays: 0 }, { kind: 'any', waitDays: 3 }] });
  expect(getDefaultProfile(db, 'series').dubs).toEqual([{ kind: 'any', waitDays: 0 }]);
});

test('описание профиля', () => {
  const names: Record<number, string> = { 1: 'LostFilm', 2: 'HDrezka Studio' };
  const p: Profile = {
    ...base,
    dubs: [
      { kind: 'studio', studioId: 1, waitDays: 0 },
      { kind: 'studio', studioId: 2, waitDays: 2 },
      { kind: 'studio', studioId: 7, waitDays: 3 },
      { kind: 'any', waitDays: 5 },
    ],
  };
  expect(describeProfile(p, (id) => names[id])).toEqual({
    chain: 'LostFilm → HDrezka Studio (через 2 дн) → Студия удалена (через 3 дн) → Любая (через 5 дн)',
    quality: '2160p, иначе ниже · HDR',
    scope: 'Только новые серии',
  });
  expect(
    describeProfile(
      { ...p, quality: { target: 1080, allowLower: false, preferHdr: false, maxSizeGb: 4 }, scope: { mode: 'from', season: 2, episode: 5, until: 'season_end' } },
      (id) => names[id],
    ),
  ).toMatchObject({ quality: '1080p · до 4 ГБ', scope: 'С S02E05 до конца сезона' });
  expect(describeProfile({ ...p, dubs: [{ kind: 'original', waitDays: 0 }], scope: { mode: 'all' } }, () => undefined)).toMatchObject({
    chain: 'Оригинал с субтитрами',
    scope: 'Все сезоны',
  });
});

test('данные окна подписки: добавлять — по типу, подписи — для всех студий', async () => {
  const { subscribeDialogStudios } = await import('@/lib/profile');
  const db = testDb();
  seedStudios(db);
  const lf = findStudioByAlias(db, 'LostFilm')!;
  const d = subscribeDialogStudios(db, 'anime');
  expect(d.addable.some((s) => s.id === lf.id)).toBe(false);
  expect(d.names[lf.id]).toBe('LostFilm');
});

test('ожидания не убывают сверху вниз', () => {
  expect(
    validateProfile(
      {
        ...base,
        dubs: [
          { kind: 'studio', studioId: 1, waitDays: 0 },
          { kind: 'studio', studioId: 2, waitDays: 5 },
          { kind: 'any', waitDays: 2 },
        ],
      },
      known,
    ),
  ).toEqual({ ok: false, error: 'Ожидание не может быть меньше, чем у позиции выше' });
});
