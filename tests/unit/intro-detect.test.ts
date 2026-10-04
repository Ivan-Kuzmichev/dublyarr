import { expect, test } from 'vitest';
import { agree, nearest, windows } from '@/lib/intros/detect';

test('окна: 10 мин начала и 4 мин конца, у короткой серии — не пересекаются', () => {
  expect(windows(1450)).toEqual({ head: [0, 600], tail: [1210, 240] });
  expect(windows(240)).toEqual({ head: [0, 120], tail: [120, 120] });
});

test('согласие соседей: двое согласны — медиана; один — нет', () => {
  expect(agree([[113, 187.4], [112.9, 187.5], [40, 60]], 5)).toEqual([112.9, 187.4]);
  expect(agree([[113, 187]], 5)).toBeNull();
  expect(agree([], 5)).toBeNull();
});

test('соседи несогласны — null (не пишем неверные главы)', () => {
  expect(agree([[10, 40], [100, 160], [300, 330]], 6)).toBeNull();
});

test('сезон из двух серий: одного отрезка ≥ 20 с достаточно', () => {
  expect(agree([[30, 60]], 2)).toEqual([30, 60]);
  expect(agree([[30, 45]], 2)).toBeNull();
});

test('ближайшие соседи: по 2 с каждой стороны, иначе добор с другой', () => {
  const eps = [1, 2, 3, 4, 5, 6, 7].map((number) => ({ number }));
  expect(nearest(eps, eps[3]).map((e) => e.number)).toEqual([3, 5, 2, 6]);
  expect(nearest(eps, eps[0]).map((e) => e.number)).toEqual([2, 3, 4, 5]);
});
