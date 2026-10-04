import type { Probe, Stream } from './probe';
import type { TrackPlan } from './tracks';

// Номера дорожек mkvmerge для любого контейнера. У mkv они совпадают с индексами ffprobe;
// у mp4/avi/ts mkvmerge нумерует по-своему (пропускает служебные, у ts — свой порядок),
// поэтому сопоставляем по порядку внутри типа (видео, звук, субтитры) с выводом `mkvmerge -J`.

type Identify = { container?: { recognized?: boolean; supported?: boolean }; tracks?: { id: number; type: string }[] };
const KIND: Record<string, Stream['type']> = { video: 'video', audio: 'audio', subtitles: 'subtitle' };

/** ffprobe-индекс → номер mkvmerge; null — сопоставить нельзя (кладём файл как есть). */
export function mkvTrackIds(p: Probe, identify: unknown): Map<number, number> | null {
  const media = p.streams.filter((s) => s.type !== 'other');
  if (p.container === 'matroska') return new Map(media.map((s) => [s.index, s.index]));
  const id = identify as Identify | null;
  if (!id?.container?.recognized || !id.container.supported) return null;
  const map = new Map<number, number>();
  for (const type of ['video', 'audio', 'subtitle'] as const) {
    const ours = media.filter((s) => s.type === type);
    const theirs = (id.tracks ?? []).filter((t) => KIND[t.type] === type);
    if (ours.length !== theirs.length) return null;
    ours.forEach((s, i) => map.set(s.index, theirs[i].id));
  }
  return map;
}

export function remapPlan(plan: TrackPlan, ids: Map<number, number>): TrackPlan {
  const m = (i: number) => ids.get(i)!;
  const d = (i: number | null) => (i === null ? null : m(i));
  return { ...plan, audio: plan.audio.map(m), subs: plan.subs.map(m), order: plan.order.map(m), defaults: { audio: d(plan.defaults.audio), sub: d(plan.defaults.sub) } };
}

export type TrackMeta = { name: string | null; language: string | null };

/** Имя и язык дорожек по номерам mkvmerge — для не-mkv: из mp4 (handler_name) и avi mkvmerge их сам не переносит. */
export function trackMeta(p: Probe, ids: Map<number, number>): Map<number, TrackMeta> {
  if (p.container === 'matroska') return new Map();
  const meta = new Map<number, TrackMeta>();
  for (const s of p.streams) {
    const id = ids.get(s.index);
    const name = s.title && !/handler$/i.test(s.title) ? s.title : null;
    if (id !== undefined && (name || s.language)) meta.set(id, { name, language: s.language });
  }
  return meta;
}
