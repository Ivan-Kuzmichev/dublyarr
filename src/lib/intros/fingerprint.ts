// Сравнение отпечатков Chromaprint (raw, uint32 на кадр): самый длинный общий кусок двух окон.
// Кандидаты сдвига — перебором по прореженным кадрам, затем полный проход по лучшим сдвигам с допуском по битам.

export const STEP = 4096 / 3 / 11025; // секунд на кадр
/** Значение отпечатка описывает ~2 с звука от своей позиции: найденные границы раньше настоящих примерно на секунду (замер в образе). */
export const LAG = 1;
const MAX_BITS = 8;
const MAX_GAP = 3;
const MIN_LEN = 15;
const MAX_LEN = 120;
const TOP_SHIFTS = 12;
const SAMPLE = 4;

export function popcount(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Самый длинный отрезок при сдвиге s (i в a ↔ i - s в b): допускается MAX_GAP плохих кадров подряд. */
function bestRun(a: Uint32Array, b: Uint32Array, s: number): [number, number] {
  let best: [number, number] = [0, 0];
  let start = -1;
  let lastGood = -1;
  const from = Math.max(0, s);
  const to = Math.min(a.length, b.length + s);
  for (let i = from; i < to; i++) {
    if (popcount((a[i] ^ b[i - s]) >>> 0) <= MAX_BITS) {
      if (start < 0 || i - lastGood > MAX_GAP + 1) start = i;
      lastGood = i;
      if (lastGood + 1 - start > best[1] - best[0]) best = [start, lastGood + 1];
    }
  }
  return best;
}

export function commonSegment(a: Uint32Array, b: Uint32Array): { a: [number, number]; b: [number, number] } | null {
  // кандидаты сдвига: перебор всех сдвигов по каждому SAMPLE-му кадру с допуском по битам
  // (точных совпадений у перекодированного звука может не быть вовсе)
  const minHits = Math.ceil(MIN_LEN / STEP / SAMPLE / 2);
  const top: [number, number][] = [];
  for (let s = -(b.length - 1); s < a.length; s++) {
    let hits = 0;
    const to = Math.min(a.length, b.length + s);
    for (let i = Math.max(0, s); i < to; i += SAMPLE) if (popcount((a[i] ^ b[i - s]) >>> 0) <= MAX_BITS) hits++;
    if (hits < minHits) continue;
    top.push([s, hits]);
    if (top.length > TOP_SHIFTS * 4) top.sort((x, y) => y[1] - x[1]).splice(TOP_SHIFTS);
  }
  const shifts = top.sort((x, y) => y[1] - x[1]).slice(0, TOP_SHIFTS).map(([s]) => s);
  let best: { s: number; run: [number, number] } | null = null;
  for (const s of shifts) {
    const run = bestRun(a, b, s);
    if (!best || run[1] - run[0] > best.run[1] - best.run[0]) best = { s, run };
  }
  if (!best) return null;
  const len = (best.run[1] - best.run[0]) * STEP;
  if (len < MIN_LEN || len > MAX_LEN) return null;
  const [i0, i1] = best.run;
  return { a: [i0 * STEP, i1 * STEP], b: [(i0 - best.s) * STEP, (i1 - best.s) * STEP] };
}
