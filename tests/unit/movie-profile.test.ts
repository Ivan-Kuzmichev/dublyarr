import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { testDb } from './helpers';
import { fakeTmdb } from './fake-tmdb';
import { syncTitle } from '@/lib/catalog';
import { syncMovie } from '@/lib/movies';
import { seedStudios } from '@/lib/studios';
import { builtinProfile, getMovieDefault } from '@/lib/profile';
import { setSetting } from '@/lib/settings';
import { subscribe, SubscriptionError } from '@/lib/subscriptions';
import { DEFAULT_MOVIE_PROFILE, describeMovieProfile, isMovieProfile, validateMovieProfile, type MovieProfile } from '@/lib/movie-profile';
import type { TmdbMovieDetails, TmdbSeason, TmdbTvDetails } from '@/lib/tmdb/types';

const fx = <T>(n: string) => JSON.parse(readFileSync(`tests/fixtures/tmdb/${n}.json`, 'utf8')) as T;
const ok = (p: unknown) => validateMovieProfile(p);

describe('профиль фильма', () => {
  test('по умолчанию', () => {
    expect(DEFAULT_MOVIE_PROFILE).toEqual({
      type: 'movie',
      dubs: [
        { kind: 'dub', on: true },
        { kind: 'mvo', on: true },
        { kind: 'original', on: true },
      ],
      waitDubDays: 14,
      quality: { target: 1080, allowLower: true, preferHdr: false, maxSizeGb: 30 },
      noCam: true,
      digitalOnly: true,
      remux: false,
      replaceWithDub: true,
    });
    expect(isMovieProfile(DEFAULT_MOVIE_PROFILE)).toBe(true);
  });
  test('проверка', () => {
    expect(ok(DEFAULT_MOVIE_PROFILE)).toEqual({ ok: true, profile: DEFAULT_MOVIE_PROFILE });
    const off = { ...DEFAULT_MOVIE_PROFILE, dubs: DEFAULT_MOVIE_PROFILE.dubs.map((d) => ({ ...d, on: false })) };
    expect(ok(off)).toEqual({ ok: false, error: 'Включите хотя бы один перевод' });
    expect(ok({ ...DEFAULT_MOVIE_PROFILE, waitDubDays: 91 })).toMatchObject({ ok: false, error: 'Ожидание дубляжа — от 0 до 90 дней' });
    expect(ok({ ...DEFAULT_MOVIE_PROFILE, quality: { ...DEFAULT_MOVIE_PROFILE.quality, maxSizeGb: 500 } })).toMatchObject({ ok: false, error: 'Лимит размера — от 1 до 200 ГБ' });
    expect(ok({ ...DEFAULT_MOVIE_PROFILE, dubs: [{ kind: 'dub', on: true }, { kind: 'dub', on: true }, { kind: 'mvo', on: true }] })).toMatchObject({ ok: false });
    expect(ok({ ...DEFAULT_MOVIE_PROFILE, dubs: [{ kind: 'vo', on: true }, { kind: 'dub', on: true }, { kind: 'mvo', on: true }] })).toMatchObject({ ok: false });
    // порядок можно менять; лишние поля отбрасываются
    const custom = { ...DEFAULT_MOVIE_PROFILE, dubs: [{ kind: 'mvo', on: true }, { kind: 'dub', on: true }, { kind: 'original', on: false }], extra: 1 };
    expect(ok(custom)).toEqual({ ok: true, profile: { ...DEFAULT_MOVIE_PROFILE, dubs: custom.dubs } });
  });
  test('описание для панели подписки', () => {
    expect(describeMovieProfile(DEFAULT_MOVIE_PROFILE)).toEqual([
      'Дубляж → Многоголосый → Оригинал + субтитры',
      'Многоголосый — через 14 дн после цифрового релиза',
      '1080p, иначе ниже · до 30 ГБ',
      'Без экранок · только цифровой релиз',
      'Заменить на дубляж, когда выйдет',
    ]);
  });
  test('по умолчанию из настроек; испорченные — встроенные', () => {
    const db = testDb();
    expect(getMovieDefault(db)).toEqual(DEFAULT_MOVIE_PROFILE);
    const saved: MovieProfile = { ...DEFAULT_MOVIE_PROFILE, waitDubDays: 7, remux: true };
    setSetting(db, 'profile.movie', saved);
    expect(getMovieDefault(db)).toEqual(saved);
    setSetting(db, 'profile.movie', { type: 'movie', dubs: [] });
    expect(getMovieDefault(db)).toEqual(DEFAULT_MOVIE_PROFILE);
  });
  test('подписка: фильм — только профиль фильма, сериал — только сериальный', async () => {
    const db = testDb();
    seedStudios(db);
    const tmdb = fakeTmdb({ details: { 1399: fx<TmdbTvDetails>('tv-1399') }, seasons: { '1399:1': fx<TmdbSeason>('tv-1399-season-1') }, movies: { 603: fx<TmdbMovieDetails>('movie-603') } }).tmdb;
    const got = await syncTitle(db, tmdb, 1399);
    const matrix = await syncMovie(db, tmdb, 603);
    expect(() => subscribe(db, matrix.id, builtinProfile(db, 'series'))).toThrow(SubscriptionError);
    expect(() => subscribe(db, got.id, DEFAULT_MOVIE_PROFILE)).toThrow(SubscriptionError);
    expect(subscribe(db, matrix.id, DEFAULT_MOVIE_PROFILE).profile).toEqual(DEFAULT_MOVIE_PROFILE);
  });
});
