import type { Seg } from './detect';

// Главы для mkvpropedit (простой формат OGM) и решение, как писать в файл медиатеки.

const MIN = 1; // главы короче секунды не пишем

function stamp(sec: number) {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = ((ms % 60_000) / 1000).toFixed(3).padStart(6, '0');
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s}`;
}

export function buildChapters(o: { intro: Seg | null; credits: Seg | null; duration: number; introName: string; creditsName: string }): string {
  const parts: [number, number, string][] = [];
  const bodyStart = o.intro ? o.intro[1] : 0;
  const bodyEnd = o.credits ? o.credits[0] : o.duration;
  if (o.intro) parts.push([0, o.intro[0], 'Начало'], [o.intro[0], o.intro[1], o.introName]);
  parts.push([bodyStart, bodyEnd, 'Серия']);
  if (o.credits) parts.push([o.credits[0], o.credits[1], o.creditsName], [o.credits[1], o.duration, 'После титров']);
  const kept = parts.filter(([a, b]) => b - a >= MIN);
  return (
    kept
      .map(([a, , name], i) => {
        const n = String(i + 1).padStart(2, '0');
        return `CHAPTER${n}=${stamp(a)}\nCHAPTER${n}NAME=${name}`;
      })
      .join('\n') + '\n'
  );
}

export type WriteMode = 'inplace' | 'copy' | 'wait';

/** Своя копия (пересобран или единственная ссылка) — на месте; жёсткая ссылка на раздачу — копией, если диск не переполнен. */
export function decideWrite(o: { processed: boolean; nlink: number; diskPct: number | null; warnPct: number }): WriteMode {
  if (o.processed || o.nlink <= 1) return 'inplace';
  return o.diskPct !== null && o.diskPct >= o.warnPct ? 'wait' : 'copy';
}
