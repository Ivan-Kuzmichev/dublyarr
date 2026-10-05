import { expect, test } from 'vitest';
import { buildChapters, decideWrite } from '@/lib/intros/chapters';

const names = { introName: 'Intro', creditsName: 'Credits' };

test('полный набор глав', () => {
  expect(buildChapters({ intros: [[113, 187.4]], credits: [1320.1, 1387.6], duration: 1450, ...names })).toBe(
    [
      'CHAPTER01=00:00:00.000', 'CHAPTER01NAME=Начало',
      'CHAPTER02=00:01:53.000', 'CHAPTER02NAME=Intro',
      'CHAPTER03=00:03:07.400', 'CHAPTER03NAME=Серия',
      'CHAPTER04=00:22:00.100', 'CHAPTER04NAME=Credits',
      'CHAPTER05=00:23:07.600', 'CHAPTER05NAME=После титров',
      '',
    ].join('\n'),
  );
});

test('заставка с первой секунды, титры до конца — без пустых глав', () => {
  const t = buildChapters({ intros: [[0.4, 90]], credits: [1300, 1449.5], duration: 1450, ...names });
  expect(t).not.toContain('Начало');
  expect(t).not.toContain('После титров');
  expect(t.split('\n')[1]).toBe('CHAPTER01NAME=Intro');
});

test('только титры', () => {
  const t = buildChapters({ intros: [], credits: [1300, 1380], duration: 1450, ...names });
  expect(t).toContain('CHAPTER01NAME=Серия');
  expect(t).toContain('CHAPTER02NAME=Credits');
  expect(t).not.toContain('Intro');
});

test('как писать: своя копия — на месте; ссылка — копией при свободном диске; диск полон — ждать', () => {
  const GB = 1024 ** 3;
  const disk = (pct: number, freeGb: number) => ({ pct, free: freeGb * GB });
  expect(decideWrite({ processed: true, nlink: 2, disk: disk(95, 1), size: GB, warnPct: 90 })).toBe('inplace');
  expect(decideWrite({ processed: false, nlink: 1, disk: null, size: GB, warnPct: 90 })).toBe('inplace');
  expect(decideWrite({ processed: false, nlink: 2, disk: disk(50, 500), size: GB, warnPct: 90 })).toBe('copy');
  expect(decideWrite({ processed: false, nlink: 2, disk: disk(90, 500), size: GB, warnPct: 90 })).toBe('wait');
  // диск не прочитался — не рискуем; места меньше файла с запасом — ждём
  expect(decideWrite({ processed: false, nlink: 2, disk: null, size: GB, warnPct: 90 })).toBe('wait');
  expect(decideWrite({ processed: false, nlink: 2, disk: disk(50, 2), size: 1.5 * GB, warnPct: 90 })).toBe('wait');
});

test('два интро: вступление и опенинг через сцену', () => {
  const t = buildChapters({ intros: [[0, 30], [91, 189]], credits: null, duration: 1450, ...names });
  expect(t.split('\n').filter((l) => l.includes('NAME=')).map((l) => l.split('=')[1])).toEqual(['Intro', 'Серия', 'Intro', 'Серия']);
  expect(t).toContain('CHAPTER03=00:01:31.000');
});
