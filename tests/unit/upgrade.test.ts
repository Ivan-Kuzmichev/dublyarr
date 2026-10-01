import { expect, test } from 'vitest';
import { betterVerdict, upgradeCandidates, upgradeNote } from '@/lib/upgrade';
import type { Episode, EpisodeFile, Release, Subscription } from '@/lib/db/schema';
import type { Verdict } from '@/lib/evaluate';
import type { Profile } from '@/lib/profile-core';
import type { ParsedRelease } from '@/lib/parse/types';

const profile = (o: Partial<Profile> = {}): Profile => ({
  dubs: [{ kind: 'studio', studioId: 1, waitDays: 0 }, { kind: 'studio', studioId: 2, waitDays: 2 }],
  quality: { target: 2160, allowLower: true, preferHdr: false, maxSizeGb: null },
  scope: { mode: 'all' },
  wholeSeasonAfterFinale: false,
  replaceWithHigher: true,
  autoNextSeason: true,
  ...o,
});
const sub = (p = profile()) => ({ profile: p }) as Subscription;
const file = (number: number, o: Partial<EpisodeFile> = {}) => ({ id: number, titleId: 1, season: 1, number, path: `x/${number}.mkv`, size: 1, downloadId: null, studioLabel: 'LostFilm', resolution: 2160, method: 'hardlink', importedAt: 1, dubPosition: 0, ...o }) as EpisodeFile;
const ep = (number: number, airDate: string | null) => ({ titleId: 1, season: 1, number, airDate }) as Episode;
const today = '2026-09-30';

test('кандидаты на замену', () => {
  const eps = [ep(1, '2026-09-20'), ep(2, '2026-09-20'), ep(3, '2026-08-01'), ep(4, '2026-09-20'), ep(5, '2026-09-20')];
  const files = [file(1, { dubPosition: 1 }), file(2, { resolution: 1080 }), file(3, { dubPosition: 1 }), file(4), file(5, { dubPosition: null })];
  expect(upgradeCandidates(sub(), files, eps, today).map((f) => f.number)).toEqual([1, 2]);
  expect(upgradeCandidates(sub(profile({ replaceWithHigher: false })), files, eps, today).map((f) => f.number)).toEqual([2]);
});

const parsed = (o: Partial<ParsedRelease>): ParsedRelease => ({ base: 'x', names: [], year: null, seasons: [1], episodes: { from: 1, to: 1 }, totalInSeason: null, absolute: false, pack: false, resolution: 1080, source: 'webdl', hdr: false, dv: false, screener: false, dubs: [], original: false, subs: false, ...o });
const rel = (id: number, res: ParsedRelease['resolution']) => [id, { id, title: `r${id}`, parsed: parsed({ resolution: res }) } as Release] as const;
const v = (releaseId: number, position: number | null, ok = true): Verdict => ({ releaseId, ok, best: false, reason: '', position, tone: ok ? 'ok' : 'reject' });

test('что лучше', () => {
  const byId = new Map([rel(10, 1080), rel(11, 2160), rel(12, 720)]);
  // озвучка выше
  expect(betterVerdict(file(1, { dubPosition: 1, resolution: 1080 }), [v(12, 0)], byId, 2160)?.releaseId).toBe(12);
  // та же озвучка, качество выше, не выше целевого
  expect(betterVerdict(file(1, { dubPosition: 0, resolution: 1080 }), [v(10, 0), v(11, 0)], byId, 2160)?.releaseId).toBe(11);
  expect(betterVerdict(file(1, { dubPosition: 0, resolution: 1080 }), [v(11, 0)], byId, 1080)).toBeNull();
  // хуже или не подходит
  expect(betterVerdict(file(1, { dubPosition: 0, resolution: 2160 }), [v(10, 1), v(11, 0, false)], byId, 2160)).toBeNull();
  expect(betterVerdict(file(1, { dubPosition: null, resolution: 720 }), [v(10, 0)], byId, 2160)).toBeNull();
});

test('подпись улучшения', () => {
  const names = (id: number) => ({ 1: 'HDrezka', 2: 'LostFilm' })[id];
  const [, r] = rel(11, 2160);
  expect(upgradeNote(file(1, { dubPosition: 1, studioLabel: 'LostFilm' }), r, v(11, 0), profile(), names)).toBe('Улучшение: LostFilm → HDrezka');
  expect(upgradeNote(file(1, { dubPosition: 0, resolution: 1080 }), r, v(11, 0), profile(), names)).toBe('Улучшение: 1080p → 2160p');
});
