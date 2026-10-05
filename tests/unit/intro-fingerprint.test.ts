import { expect, test } from 'vitest';
import { STEP, commonSegment, popcount } from '@/lib/intros/fingerprint';

// псевдослучайный, но повторяемый «звук»
function noise(n: number, seed: number) {
  const out = new Uint32Array(n);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    out[i] = x;
  }
  return out;
}
const sec = (s: number) => Math.round(s / STEP);
/** вставить кусок intro в шум с позиции at (секунды) */
function episode(len: number, seed: number, intro: Uint32Array, at: number) {
  const e = noise(sec(len), seed);
  e.set(intro, sec(at));
  return e;
}

test('popcount', () => {
  expect(popcount(0)).toBe(0);
  expect(popcount(0xffffffff)).toBe(32);
  expect(popcount(0b1011)).toBe(3);
});

test('общий кусок со сдвигом: в каждой серии — на своём месте', () => {
  const intro = noise(sec(74), 7);
  const r = commonSegment(episode(600, 1, intro, 113), episode(600, 2, intro, 68))!;
  expect(r.a[0]).toBeCloseTo(113, 0);
  expect(r.a[1]).toBeCloseTo(187, 0);
  expect(r.b[0]).toBeCloseTo(68, 0);
});

test('шум в нескольких битах и редкие сбойные кадры не рвут отрезок', () => {
  const intro = noise(sec(60), 9);
  const damaged = intro.map((v, i) => (i % 50 === 0 ? ~v >>> 0 : v ^ 0b101)); // 2 бита везде, каждый 50-й кадр — мусор
  const r = commonSegment(episode(300, 1, intro, 30), episode(300, 2, Uint32Array.from(damaged), 40))!;
  expect(r.a[1] - r.a[0]).toBeGreaterThan(55);
});

test('короче 15 с или длиннее 120 с — нет', () => {
  expect(commonSegment(episode(300, 1, noise(sec(10), 5), 20), episode(300, 2, noise(sec(10), 5), 50))).toBeNull();
  const long = noise(sec(150), 5);
  expect(commonSegment(episode(400, 1, long, 20), episode(400, 2, long, 50))).toBeNull();
});

test('разные серии без общего куска — нет', () => {
  expect(commonSegment(noise(sec(300), 1), noise(sec(300), 2))).toBeNull();
});

test('голос поверх опенинга (название серии) — разрыв до 12 с при том же сдвиге не режет опенинг', () => {
  const op = noise(sec(90), 11);
  const a = episode(600, 1, op, 100);
  const b = episode(600, 2, op, 40);
  // в каждой серии с 16-й по 26-ю секунду опенинга звук свой
  a.set(noise(sec(10), 21), sec(100 + 16));
  b.set(noise(sec(10), 22), sec(40 + 16));
  const r = commonSegment(a, b)!;
  expect(r.a[0]).toBeCloseTo(100, 0);
  expect(r.a[1]).toBeCloseTo(190, 0);
});

test('разрыв длиннее 12 с — два разных куска, берётся длинный', () => {
  const op = noise(sec(90), 11);
  const a = episode(600, 1, op, 100);
  const b = episode(600, 2, op, 40);
  a.set(noise(sec(20), 21), sec(100 + 16));
  b.set(noise(sec(20), 22), sec(40 + 16));
  const r = commonSegment(a, b)!;
  expect(r.a[0]).toBeCloseTo(136, 0);
});
