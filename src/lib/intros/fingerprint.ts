// Сравнение отпечатков Chromaprint (raw, uint32 на кадр): самый длинный общий кусок двух окон.
// Кандидаты сдвига — перебором по прореженным кадрам, затем полный проход по лучшим сдвигам с допуском по битам.

export const STEP = 4096 / 3 / 11025; // секунд на кадр
/** Значение отпечатка описывает ~2 с звука от своей позиции: найденный конец раньше настоящего примерно на секунду (замер в образе и по главам AniDUB). */
export const LAG = 1;
/** Начало: по главам AniDUB точно, по «Клеверу» и синтетике — на 1–2 с раньше; середина — +0,5 с. */
export const LAG_START = 0.5;
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

const MERGE_GAP = Math.round(12 / STEP); // голос поверх музыки опенинга (название серии) — до 12 с
const MIN_PIECE = Math.round(3 / STEP); // склеиваются только куски от 3 с — не случайные совпадения

/** Самый длинный отрезок при сдвиге s (i в a ↔ i - s в b): внутри куска — до MAX_GAP плохих кадров подряд,
 *  куски от 3 с при том же сдвиге склеиваются через разрыв до 12 с. */
function bestRun(a: Uint32Array, b: Uint32Array, s: number): [number, number] {
  const pieces: [number, number][] = [];
  let start = -1;
  let lastGood = -1;
  const from = Math.max(0, s);
  const to = Math.min(a.length, b.length + s);
  for (let i = from; i < to; i++) {
    if (popcount((a[i] ^ b[i - s]) >>> 0) > MAX_BITS) continue;
    if (start < 0 || i - lastGood > MAX_GAP + 1) {
      if (start >= 0) pieces.push([start, lastGood + 1]);
      start = i;
    }
    lastGood = i;
  }
  if (start >= 0) pieces.push([start, lastGood + 1]);
  let best: [number, number] = [0, 0];
  let cur: [number, number] | null = null;
  for (const p of pieces) {
    if (p[1] - p[0] < MIN_PIECE) continue;
    cur = cur && p[0] - cur[1] <= MERGE_GAP ? [cur[0], p[1]] : [p[0], p[1]];
    if (cur[1] - cur[0] > best[1] - best[0]) best = cur;
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

const PRE_PIECE = Math.round(1 / STEP); // кусок общей музыки — от 1 с
const PRE_GAP = Math.round(6 / STEP); // между кусками — голос, до 6 с
const PRE_MAX_START = Math.round(3 / STEP);
const PRE_SHIFT = Math.round(1 / STEP); // у разных серий вступление сдвинуто на доли секунды
/** Вступление короче — не глава (решение владельца: только больше 5 с). */
export const PRELUDE_MIN = 5;

/** Общее вступление с первой секунды: куски общей музыки от 1 с через разрывы (голос) до 6 с, первый — в первые 3 с,
 *  при сдвиге между сериями до ±1 с; координаты — в a; null — нет или ≤ 5 с. */
export function preludeRun(a: Uint32Array, b: Uint32Array): [number, number] | null {
  let best: [number, number] | null = null;
  for (let s = -PRE_SHIFT; s <= PRE_SHIFT; s++) {
    const r = preludeAt(a, b, s);
    if (r && (!best || r[1] - r[0] > best[1] - best[0])) best = r;
  }
  return best;
}

/** То же при сдвиге s: кадр i в a ↔ i - s в b. */
function preludeAt(a: Uint32Array, b: Uint32Array, shift: number): [number, number] | null {
  const to = Math.min(a.length, b.length + shift);
  let chain: [number, number] | null = null;
  let start = -1;
  let lastGood = -1;
  const close = (): boolean => {
    // кусок [start, lastGood] закончен: продолжает цепочку или (первый) открывает её; false — дальше искать незачем
    if (start < 0 || lastGood + 1 - start < PRE_PIECE) return true;
    if (!chain) {
      if (start > PRE_MAX_START) return false;
      chain = [start, lastGood + 1];
    } else if (start - chain[1] <= PRE_GAP) chain[1] = lastGood + 1;
    else return false;
    return true;
  };
  for (let i = Math.max(0, shift); i < to; i++) {
    if (popcount((a[i] ^ b[i - shift]) >>> 0) > MAX_BITS) continue;
    if (start < 0 || i - lastGood > MAX_GAP + 1) {
      if (!close()) break;
      if (chain && i - (chain as [number, number])[1] > PRE_GAP) break;
      start = i;
    }
    lastGood = i;
  }
  close();
  if (!chain) return null;
  const r: [number, number] = [(chain as [number, number])[0] * STEP, (chain as [number, number])[1] * STEP];
  return r[1] - r[0] > PRELUDE_MIN ? r : null;
}
