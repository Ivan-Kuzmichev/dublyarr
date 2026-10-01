import type { EpisodeRef, Release } from './db/schema';
import type { Verdict } from './evaluate';
import type { ParsedRelease } from './parse/types';
import { filesForEpisodes } from './episode-file';

// Что делать с нужной серией (spec §4): уже есть → включить файл в качающемся паке → отдельная серия → пак с выбором файла.

export type ActiveDownload = {
  id: number;
  kind: 'episode' | 'pack' | 'season';
  season: number;
  episodes: EpisodeRef[];
  files: { index: number; name: string; size: number; priority: number }[] | null;
  state: string;
};

export type EpisodePlan =
  | { action: 'have' }
  | { action: 'enable-file'; downloadId: number; fileIndexes: number[] }
  | { action: 'add'; releaseId: number }
  | { action: 'add-pack'; releaseId: number }
  | { action: 'wait'; until: string; reason: string }
  | { action: 'ask'; reason: string }
  | { action: 'none'; reason: string };

const same = (a: EpisodeRef, b: EpisodeRef) => a.season === b.season && a.number === b.number;

export function planEpisode(ep: EpisodeRef, verdicts: Verdict[], releasesById: Map<number, Release>, active: ActiveDownload[]): EpisodePlan {
  if (active.some((d) => d.episodes.some((e) => same(e, ep)))) return { action: 'have' };

  for (const d of active) {
    if (d.kind === 'episode' || d.season !== ep.season || !d.files) continue;
    const idx = filesForEpisodes(d.files, ep.season, [ep.number]).get(ep.number);
    if (!idx?.length) continue;
    if (idx.every((i) => (d.files!.find((f) => f.index === i)?.priority ?? 0) > 0)) return { action: 'have' };
    return { action: 'enable-file', downloadId: d.id, fileIndexes: idx };
  }

  const best = verdicts.find((v) => v.best);
  const release = best && releasesById.get(best.releaseId);
  if (release) return release.parsed.pack ? { action: 'add-pack', releaseId: release.id } : { action: 'add', releaseId: release.id };

  const waits = verdicts.filter((v) => v.tone === 'wait' && v.until).sort((a, b) => a.until!.localeCompare(b.until!));
  if (waits.length) return { action: 'wait', until: waits[0].until!, reason: waits[0].reason };
  const ask = verdicts.find((v) => v.tone === 'ask');
  if (ask) return { action: 'ask', reason: ask.reason };
  if (!verdicts.length) return { action: 'none', reason: 'Подходящих раздач нет' };
  const counts = new Map<string, number>();
  for (const v of verdicts) counts.set(v.reason, (counts.get(v.reason) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return { action: 'none', reason: `Нет подходящих: ${top.charAt(0).toLowerCase()}${top.slice(1)}` };
}

/** Сезон закончился: все его серии с датами и последняя уже вышла. */
export function seasonFinished(season: number, episodes: { season: number; number: number; airDate: string | null }[], today: string): boolean {
  const eps = episodes.filter((e) => e.season === season);
  return eps.length > 0 && eps.every((e) => e.airDate && e.airDate <= today);
}

export function coversWholeSeason(p: ParsedRelease, season: number, episodeCount: number): boolean {
  if (!p.seasons.includes(season)) return false;
  if (!p.episodes || p.seasons.length > 1) return true;
  return p.episodes.from <= 1 && p.episodes.to >= episodeCount;
}
