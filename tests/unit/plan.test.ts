import { expect, test } from 'vitest';
import { planEpisode, seasonFinished, coversWholeSeason, type ActiveDownload } from '@/lib/plan';
import type { Verdict } from '@/lib/evaluate';
import type { Release } from '@/lib/db/schema';
import type { ParsedRelease } from '@/lib/parse/types';

const parsed = (o: Partial<ParsedRelease>): ParsedRelease => ({
  base: 'x', names: [], year: null, seasons: [1], episodes: { from: 3, to: 3 }, totalInSeason: null, absolute: false, pack: false,
  resolution: 1080, source: 'webdl', hdr: false, dv: false, screener: false, dubs: [], original: false, subs: false, ...o,
});
const rel = (id: number, o: Partial<ParsedRelease> = {}) => ({ id, parsed: parsed(o) }) as unknown as Release;
const v = (releaseId: number, o: Partial<Verdict>): Verdict => ({ releaseId, ok: false, best: false, reason: '', position: null, tone: 'reject', ...o });
const ep = { season: 1, number: 3 };
const byId = (...rs: Release[]) => new Map(rs.map((r) => [r.id, r]));

test('серия уже качается — ничего не делать', () => {
  const active: ActiveDownload[] = [{ id: 1, kind: 'episode', season: 1, episodes: [ep], files: null, state: 'downloading' }];
  expect(planEpisode(ep, [], new Map(), active)).toEqual({ action: 'have' });
});

test('пак сезона уже качается — включить файл серии', () => {
  const files = [1, 2, 3].map((n, i) => ({ index: i, name: `Show.S01E0${n}.mkv`, size: 1, priority: n === 1 ? 1 : 0 }));
  const active: ActiveDownload[] = [{ id: 7, kind: 'pack', season: 1, episodes: [{ season: 1, number: 1 }], files, state: 'downloading' }];
  expect(planEpisode(ep, [], new Map(), active)).toEqual({ action: 'enable-file', downloadId: 7, fileIndexes: [2] });
  const enabled = files.map((f) => ({ ...f, priority: 1 }));
  expect(planEpisode(ep, [], new Map(), [{ ...active[0], files: enabled }])).toEqual({ action: 'have' });
});

test('лучшая — серия или пак', () => {
  expect(planEpisode(ep, [v(1, { ok: true, best: true, tone: 'best' })], byId(rel(1)), [])).toEqual({ action: 'add', releaseId: 1 });
  expect(planEpisode(ep, [v(2, { ok: true, best: true, tone: 'best' })], byId(rel(2, { pack: true, episodes: { from: 1, to: 10 } })), [])).toEqual({
    action: 'add-pack',
    releaseId: 2,
  });
});

test('нет лучшей: ждать, спросить, нечего', () => {
  const waits = [v(1, { tone: 'wait', reason: 'Рано: ждём LostFilm до 3 окт', until: '2026-10-03' }), v(2, { tone: 'wait', reason: 'Рано: ждём LostFilm до 30 сент', until: '2026-09-30' })];
  expect(planEpisode(ep, waits, new Map(), [])).toEqual({ action: 'wait', until: '2026-09-30', reason: 'Рано: ждём LostFilm до 30 сент' });
  expect(planEpisode(ep, [v(1, { tone: 'ask', reason: 'Неизвестная студия' })], new Map(), [])).toEqual({ action: 'ask', reason: 'Неизвестная студия' });
  expect(planEpisode(ep, [], new Map(), [])).toEqual({ action: 'none', reason: 'Подходящих раздач нет' });
  expect(planEpisode(ep, [v(1, { reason: 'Нет сидов' }), v(2, { reason: 'Нет сидов' }), v(3, { reason: 'Экранка' })], new Map(), [])).toEqual({
    action: 'none',
    reason: 'Нет подходящих: нет сидов',
  });
});

test('сезон закончен', () => {
  const eps = [1, 2, 3].map((n) => ({ season: 1, number: n, airDate: `2026-09-${10 + n}` }));
  expect(seasonFinished(1, eps, '2026-09-13')).toBe(true);
  expect(seasonFinished(1, eps, '2026-09-12')).toBe(false);
  expect(seasonFinished(1, [...eps, { season: 1, number: 4, airDate: null }], '2026-10-01')).toBe(false);
  expect(seasonFinished(2, eps, '2026-10-01')).toBe(false);
});

test('пак покрывает весь сезон', () => {
  expect(coversWholeSeason(parsed({ episodes: null, pack: true }), 1, 10)).toBe(true);
  expect(coversWholeSeason(parsed({ episodes: { from: 1, to: 10 }, pack: true }), 1, 10)).toBe(true);
  expect(coversWholeSeason(parsed({ episodes: { from: 1, to: 9 }, pack: true }), 1, 10)).toBe(false);
  expect(coversWholeSeason(parsed({ seasons: [2], episodes: null }), 1, 10)).toBe(false);
});
