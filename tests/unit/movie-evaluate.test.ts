import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseRelease } from '@/lib/parse/dubs';
import { decideMovie, evaluateMovie, matchMovie, movieKinds, movieSource } from '@/lib/movie-evaluate';
import { DEFAULT_MOVIE_PROFILE, type MovieProfile } from '@/lib/movie-profile';
import type { Release } from '@/lib/db/schema';

const GB = 1024 ** 3;
const T = { nameRu: 'Матрица', nameOriginal: 'The Matrix', altNames: ['Matrix'], year: 1999 };
const parse = (title: string, tracker = 'rutracker') => parseRelease(title, {}, { id: tracker, name: tracker }, []);

describe('реальные заголовки фильмов', () => {
  const rows = readFileSync('tests/fixtures/releases/movies.tsv', 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('\t'));
  test.each(rows)('%s', (title, tracker, _size, kinds, source, resolution) => {
    const p = parse(title, tracker);
    expect(movieKinds(p).join(',') || '-').toBe(kinds);
    expect(movieSource(title, p)).toBe(source);
    expect(String(p.resolution ?? '-')).toBe(resolution);
  });
});

describe('тот ли фильм', () => {
  test('название и год; сериал — не фильм; размер', () => {
    expect(matchMovie(parse('The Matrix [1999, BDRip 1080p] Dub'), 10 * GB, T).level).toBe('match');
    expect(matchMovie(parse('Матрица / The Matrix (2000) BDRip 1080p'), 10 * GB, T).level).toBe('match');
    expect(matchMovie(parse('The Matrix 1999 DUB WEBDL 1080p - RUSSIAN', 'kinozal'), 10 * GB, T).level).toBe('match'); // год в заголовке Kinozal без скобок
    expect(matchMovie(parse('The Matrix [2021, BDRip 1080p] Dub'), 10 * GB, T)).toMatchObject({ level: 'doubt', reasons: ['Год не совпадает'] });
    expect(matchMovie(parse('The Matrix S01E01 [1999] Dub'), 1 * GB, T)).toMatchObject({ level: 'reject', reasons: ['Это сериал'] });
    expect(matchMovie(parse('Матрица 1999 Dub'), 0.3 * GB, T).reasons).toContain('Размер неправдоподобен');
    expect(matchMovie(parse('Супермен 2025 Dub'), 10 * GB, T).level).toBe('reject');
    expect(matchMovie(parse('Супермен 2025 Dub'), 10 * GB, T, 'match').level).toBe('match');
  });
});

let id = 0;
function rel(title: string, o: { size?: number; seeders?: number; tracker?: string; level?: 'match' | 'doubt' | 'reject' } = {}): Release {
  const p = parse(title, o.tracker);
  return {
    id: ++id,
    title,
    trackerName: o.tracker ?? 'rutracker',
    size: (o.size ?? 10) * GB,
    seeders: o.seeders ?? 50,
    parsed: p,
    match: { score: 1, level: o.level ?? 'match', reasons: [] },
  } as unknown as Release;
}
const P = (o: Partial<MovieProfile> = {}): MovieProfile => ({ ...DEFAULT_MOVIE_PROFILE, ...o });
const ctx = (o: { profile?: MovieProfile; digital?: string | null; today?: string } = {}) => ({ profile: o.profile ?? P(), digital: o.digital === undefined ? '2026-09-20' : o.digital, today: o.today ?? '2026-10-01' });
const reasons = (rs: Release[], c = ctx()) => evaluateMovie(rs, c).map((v) => v.reason);

describe('вердикты', () => {
  test('отказы с причиной', () => {
    expect(
      reasons([
        rel('Superman 2025 MVO CAMRip - RUSSIAN', { tracker: 'kinozal' }),
        rel('The Matrix [1999, HDTV 1080i] Dub + Original Eng'),
        rel('The Matrix [1999, UHD BR-DISK 2160p] Dub', { size: 64 }),
        rel('The Matrix [1999, BDRip 1080p] Dub', { size: 31 }),
        rel('The Matrix [1999, WEB-DL 2160p] Dub', { size: 18 }),
        rel('The Matrix [1999, BDRip 1080p] AVO (Goblin)'),
        rel('The Matrix [1999, BDRip 1080p] Dub', { level: 'reject' }),
      ]),
    ).toEqual(['Экранка', 'Не цифровой релиз', 'Диск, а не файл', 'Больше 30 ГБ', 'Выше 1080p', 'Нет нужного перевода', 'Не тот фильм']);
  });
  test('экранки и не цифровые разрешены, если правила выключены', () => {
    const v = evaluateMovie([rel('Superman [2025, TS 1080p] Dub'), rel('The Matrix [1999, HDTV 1080i] Dub')], ctx({ profile: P({ noCam: false, digitalOnly: false }), digital: '2026-09-01' }));
    expect(v.map((x) => x.ok)).toEqual([true, true]);
  });
  test('позиция перевода: дубляж > многоголосый > оригинал; выключенная пропускается; DVO — многоголосый', () => {
    const rs = [rel('The Matrix [1999, BDRip 1080p] MVO (Jaskier)'), rel('The Matrix [1999, BDRip 1080p] Dub'), rel('The Matrix [1999, BDRip 1080p] DVO (Kubik)'), rel('The Matrix [1999, BDRip 1080p] Original Eng + Sub Rus')];
    expect(evaluateMovie(rs, ctx()).map((v) => v.position)).toEqual([1, 0, 1, 2]);
    const noMvo = P({ dubs: [{ kind: 'dub', on: true }, { kind: 'mvo', on: false }, { kind: 'original', on: true }] });
    expect(evaluateMovie(rs, ctx({ profile: noMvo })).map((v) => v.reason)).toEqual(['Нет нужного перевода', expect.stringContaining('Лучший'), 'Нет нужного перевода', expect.stringContaining('Рано')]);
  });
  test('лучшая: перевод выше → качество ближе к цели → Remux при «улучшить до BDRemux» → сиды', () => {
    const rs = [
      rel('The Matrix [1999, WEB-DL 720p] Dub', { seeders: 500 }),
      rel('The Matrix [1999, WEB-DL 1080p] Dub', { seeders: 5 }),
      rel('The Matrix [1999, BDRemux 1080p] Dub', { seeders: 1, size: 25 }),
    ];
    expect(evaluateMovie(rs, ctx()).find((v) => v.best)?.releaseId).toBe(rs[1].id);
    expect(evaluateMovie(rs, ctx({ profile: P({ remux: true }) })).find((v) => v.best)?.releaseId).toBe(rs[2].id);
  });
});

describe('ожидание дубляжа', () => {
  const mvo = () => [rel('The Matrix [1999, WEB-DL 1080p] MVO (Jaskier)')];
  test('многоголосый до окна — ждём дубляж до даты; после окна — качаем', () => {
    const early = evaluateMovie(mvo(), ctx({ digital: '2026-09-26' }));
    expect(early[0]).toMatchObject({ ok: false, tone: 'wait', until: '2026-10-10' });
    expect(decideMovie(early, P(), '2026-09-26')).toEqual({ action: 'wait', state: 'dub', until: '2026-10-10' });
    const late = evaluateMovie(mvo(), ctx({ digital: '2026-09-15' }));
    expect(decideMovie(late, P(), '2026-09-15')).toEqual({ action: 'start', releaseId: late[0].releaseId });
  });
  test('дубляж — сразу', () => {
    const v = evaluateMovie([rel('The Matrix [1999, WEB-DL 1080p] Dub')], ctx({ digital: '2026-09-30' }));
    expect(decideMovie(v, P(), '2026-09-30').action).toBe('start');
  });
  test('цифрового релиза нет — ждём его; многоголосый не берём', () => {
    const v = evaluateMovie(mvo(), ctx({ digital: null }));
    expect(v[0].tone).toBe('wait');
    expect(decideMovie(v, P(), null)).toEqual({ action: 'wait', state: 'digital' });
    expect(decideMovie([], P(), null)).toEqual({ action: 'wait', state: 'digital' });
    expect(decideMovie([], P({ digitalOnly: false }), null)).toEqual({ action: 'none' });
  });
  test('ничего нет — none; сомнительная — ask', () => {
    expect(decideMovie([], P(), '2026-09-01')).toEqual({ action: 'none' });
    const v = evaluateMovie([rel('The Matrix [1999, WEB-DL 1080p] Dub', { level: 'doubt' })], ctx());
    expect(decideMovie(v, P(), '2026-09-20')).toEqual({ action: 'ask', releaseId: v[0].releaseId, reason: 'Сомнительное совпадение' });
  });
});
