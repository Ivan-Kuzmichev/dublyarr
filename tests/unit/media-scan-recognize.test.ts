import { expect, test } from 'vitest';
import { recognize, type Candidate } from '@/lib/media-scan/recognize';
import type { ScanItem } from '@/lib/media-scan/group';

const item = (o: Partial<ScanItem>): ScanItem => ({ key: 'x', root: 'media', kind: 'series', names: ['Silo'], year: null, episodes: [], unknown: [], size: 0, ...o });
const cand = (o: Partial<Candidate>): Candidate => ({ tmdbId: 1, type: 'tv', name: 'Укрытие', original: 'Silo', year: 2023, posterPath: null, score: 0, ...o });

test('лучший кандидат по названию и году; уверенно — от 0,8', async () => {
  const asked: string[] = [];
  const search = async (q: string, type: 'tv' | 'movie') => (asked.push(`${type}:${q}`), [cand({ tmdbId: 9, original: 'Silos' }), cand({ tmdbId: 125988 })]);
  const r = await recognize(item({ names: ['Silo'] }), search);
  expect(asked).toEqual(['tv:Silo']);
  expect(r).toMatchObject({ best: { tmdbId: 125988 }, sure: true });
});

test('год не совпал — не уверенно; фильм ищется как фильм; ничего — null', async () => {
  const r = await recognize(item({ kind: 'movie', names: ['Happy Gilmore'], year: 1996 }), async (_q, type) => (type === 'movie' ? [cand({ type: 'movie', name: 'Счастливчик Гилмор', original: 'Happy Gilmore', year: 2025 })] : []));
  expect(r.sure).toBe(false);
  expect(await recognize(item({ names: ['Nothing'] }), async () => [])).toEqual({ best: null, sure: false });
});

test('название без латиницы — запрос как есть', async () => {
  const asked: string[] = [];
  await recognize(item({ names: ['참교육'] }), async (q) => (asked.push(q), []));
  expect(asked).toEqual(['참교육']);
});
