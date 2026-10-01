import { expect, test } from 'vitest';
import { evaluateReleases, type Target } from '@/lib/evaluate';
import type { Profile } from '@/lib/profile-core';
import type { Release, Episode } from '@/lib/db/schema';
import type { ParsedRelease, ParsedDub } from '@/lib/parse/types';

const GB = 1024 ** 3;
const LF = 1, HD = 2, TVS = 3;
const names: Record<number, string> = { [LF]: 'LostFilm', [HD]: 'HDrezka Studio', [TVS]: 'TVShows' };
const profile: Profile = {
  dubs: [
    { kind: 'studio', studioId: LF, waitDays: 0 },
    { kind: 'studio', studioId: HD, waitDays: 2 },
    { kind: 'any', waitDays: 5 },
  ],
  quality: { target: 1080, allowLower: false, preferHdr: false, maxSizeGb: 4 },
  scope: { mode: 'all' },
  wholeSeasonAfterFinale: false,
  replaceWithHigher: true,
  autoNextSeason: true,
};
const episodes = [1, 2, 3].map((n) => ({ season: 1, number: n, airDate: `2026-09-${14 + 7 * (n - 1)}` })) as Episode[]; // E3 — 28 сент
const dub = (studioId: number | null, label = names[studioId ?? 0] ?? 'MVO', by: ParsedDub['by'] = 'title'): ParsedDub => ({ kind: 'mvo', studioId, label, by });

let nextId = 1;
function rel(o: Partial<ParsedRelease> & { size?: number; seeders?: number | null; level?: 'match' | 'doubt' | 'reject'; rule?: 'reject' }): Release {
  const parsed: ParsedRelease = {
    base: 'got', names: [], year: null, seasons: [1], episodes: { from: 3, to: 3 }, totalInSeason: null, absolute: false, pack: false,
    resolution: 1080, source: 'webdl', hdr: false, dv: false, screener: false, dubs: [dub(LF)], original: false, subs: false, ...o,
  };
  return {
    id: nextId++, parsed, size: o.size ?? 2 * GB, seeders: o.seeders === undefined ? 10 : o.seeders,
    match: { score: 1, level: o.level ?? 'match', reasons: [], rule: o.rule },
  } as unknown as Release;
}
const ctx = (today: string, p: Profile = profile) => ({ profile: p, episodes, studioName: (id: number) => names[id], today });
const e3: Target = { season: 1, episode: 3 };
const one = (r: Release, today = '2026-09-30', p?: Profile, target = e3) => evaluateReleases([r], ctx(today, p), target)[0];

test('LostFilm отдельной серией — лучший', () => {
  expect(one(rel({}))).toMatchObject({ ok: true, best: true, tone: 'best', reason: 'Лучший · 1-я по приоритету', position: 0 });
});

test('ожидание — от даты эфира, граница включительно', () => {
  const hd = rel({ dubs: [dub(HD)], pack: true, episodes: { from: 1, to: 3 } });
  expect(one(hd, '2026-09-30')).toMatchObject({ ok: true, tone: 'best', position: 1 });
  expect(one(hd, '2026-09-29')).toMatchObject({ ok: false, tone: 'wait', reason: 'Рано: ждём LostFilm до 30 сент' });
  const tvs = rel({ dubs: [dub(TVS)] });
  expect(one(tvs, '2026-09-30')).toMatchObject({ tone: 'wait', reason: 'Рано: ждём LostFilm до 3 окт' });
  expect(one(tvs, '2026-10-03')).toMatchObject({ ok: true, position: 2 });
});

test('отказы', () => {
  expect(one(rel({ screener: true }))).toMatchObject({ tone: 'reject', reason: 'Экранка' });
  expect(one(rel({ resolution: 720 }))).toMatchObject({ tone: 'reject', reason: 'Ниже 1080p' });
  expect(one(rel({ size: 5 * GB }))).toMatchObject({ tone: 'reject', reason: 'Больше 4 ГБ' });
  expect(one(rel({ seeders: 0 }))).toMatchObject({ tone: 'reject', reason: 'Нет сидов' });
  expect(one(rel({ seeders: null })).ok).toBe(true);
  expect(one(rel({ seasons: [2] }))).toMatchObject({ tone: 'reject', reason: 'Не та серия' });
  expect(one(rel({ episodes: { from: 1, to: 2 }, pack: true }))).toMatchObject({ reason: 'Не та серия' });
  expect(one(rel({ level: 'reject' }))).toMatchObject({ tone: 'reject', reason: 'Не тот сериал' });
  expect(one(rel({ level: 'reject', rule: 'reject' }))).toMatchObject({ reason: 'В чёрном списке' });
  expect(one(rel({ level: 'doubt' }))).toMatchObject({ tone: 'ask', reason: 'Сомнительное совпадение' });
});

test('озвучка: не в профиле и неизвестная студия', () => {
  const noAny: Profile = { ...profile, dubs: profile.dubs.slice(0, 2) };
  expect(one(rel({ dubs: [dub(TVS)] }), '2026-10-30', noAny)).toMatchObject({ tone: 'reject', reason: 'Не в профиле озвучки' });
  expect(one(rel({ dubs: [dub(null, 'Paravozik', 'none')] }), '2026-10-30', noAny)).toMatchObject({ tone: 'ask', reason: 'Неизвестная студия' });
  expect(one(rel({ dubs: [dub(null, 'MVO', 'none')] }), '2026-10-30', noAny)).toMatchObject({ reason: 'Не в профиле озвучки' });
  // «Любая» принимает и неизвестную студию
  expect(one(rel({ dubs: [dub(null, 'Paravozik', 'none')] }), '2026-10-30')).toMatchObject({ ok: true, position: 2 });
  const orig: Profile = { ...profile, dubs: [{ kind: 'original', waitDays: 0 }] };
  expect(one(rel({ dubs: [], original: true, subs: true }), '2026-09-30', orig)).toMatchObject({ ok: true, position: 0 });
});

test('качество ниже допустимо при «брать ниже», но не ниже 720p', () => {
  const lower: Profile = { ...profile, quality: { ...profile.quality, target: 2160, allowLower: true, maxSizeGb: null } };
  expect(one(rel({ resolution: 720 }), '2026-09-30', lower).ok).toBe(true);
  expect(one(rel({ resolution: 480 }), '2026-09-30', lower)).toMatchObject({ reason: 'Ниже 720p' });
});

test('выбор лучшего: позиция, серия лучше пака, разрешение, HDR, сиды', () => {
  const pack = rel({ pack: true, episodes: { from: 1, to: 3 }, seeders: 500 });
  const single = rel({ seeders: 5 });
  const hdOnly = rel({ dubs: [dub(HD)], seeders: 900 });
  const v = evaluateReleases([pack, hdOnly, single], ctx('2026-10-10'), e3);
  expect(v.find((x) => x.best)!.releaseId).toBe(single.id);
  expect(v.find((x) => x.releaseId === pack.id)).toMatchObject({ tone: 'ok', reason: 'Подходит · 1-я по приоритету' });
  expect(v.find((x) => x.releaseId === hdOnly.id)).toMatchObject({ tone: 'ok', reason: 'Подходит · 2-я по приоритету' });

  const hdr: Profile = { ...profile, quality: { ...profile.quality, preferHdr: true } };
  const plain = rel({ seeders: 100 });
  const withHdr = rel({ hdr: true, seeders: 1 });
  expect(evaluateReleases([plain, withHdr], ctx('2026-10-10', hdr), e3).find((x) => x.best)!.releaseId).toBe(withHdr.id);
  const many = rel({ seeders: 300 });
  expect(evaluateReleases([plain, many], ctx('2026-10-10'), e3).find((x) => x.best)!.releaseId).toBe(many.id);
});

test('цель — сезон: подходят паки и серии этого сезона', () => {
  const pack = rel({ pack: true, episodes: null, size: 10 * GB });
  expect(one(pack, '2026-10-10', { ...profile, quality: { ...profile.quality, maxSizeGb: null } }, { season: 1 }).ok).toBe(true);
  expect(one(rel({ seasons: [2] }), '2026-10-10', profile, { season: 1 }).reason).toBe('Не та серия');
});
