// Где искать и когда верить: окна начала/конца серии и согласие отрезков, найденных с разными соседями.

export type Seg = [number, number];
const TOL = 3;
const PAIR_MIN = 20;

export function windows(duration: number): { head: Seg; tail: Seg } {
  const half = duration / 2;
  const head = Math.min(600, half);
  const tail = Math.min(240, half);
  return { head: [0, head], tail: [duration - tail, tail] };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

/** Отрезок, с которым согласны ≥ 2 соседа (или единственный сосед в сезоне из 2 серий); null — не уверены. */
export function agree(segs: Seg[], usable: number): Seg | null {
  if (usable === 2 && segs.length === 1) return segs[0][1] - segs[0][0] >= PAIR_MIN ? segs[0] : null;
  let best: Seg[] = [];
  for (const s of segs) {
    const group = segs.filter((o) => Math.abs(o[0] - s[0]) <= TOL && Math.abs(o[1] - s[1]) <= TOL);
    if (group.length > best.length) best = group;
  }
  if (best.length < 2) return null;
  return [median(best.map((s) => s[0])), median(best.map((s) => s[1]))];
}

/** До n ближайших по номеру серий: поровну с каждой стороны, недостающих — с другой. */
export function nearest<T extends { number: number }>(all: T[], self: T, n = 4): T[] {
  const others = all.filter((e) => e !== self);
  const before = others.filter((e) => e.number < self.number).sort((a, b) => b.number - a.number);
  const after = others.filter((e) => e.number > self.number).sort((a, b) => a.number - b.number);
  const out: T[] = [];
  for (let i = 0; out.length < n && (i < before.length || i < after.length); i++) {
    if (i < before.length && out.length < n) out.push(before[i]);
    if (i < after.length && out.length < n) out.push(after[i]);
  }
  return out;
}
