import { isMovieProfile, type MovieProfile } from './movie-profile';
import type { Episode, EpisodeFile, Release } from './db/schema';
import type { Verdict } from './evaluate';
import { dubLabel, type Profile } from './profile-core';

// Замена скачанной серии на лучшую версию: озвучка выше по приоритету или целевое качество (spec §1).

export const UPGRADE_DAYS = 30;
const DAY = 86_400_000;
const daysSince = (date: string, today: string) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY);

/** Скачанные серии, которые ещё стоит улучшать: не старше 30 дней после эфира, взяты не по первой позиции или ниже целевого качества. */
export function upgradeCandidates(sub: { profile: Profile | MovieProfile }, files: EpisodeFile[], episodes: Pick<Episode, 'season' | 'number' | 'airDate'>[], today: string): EpisodeFile[] {
  const p = sub.profile;
  if (isMovieProfile(p)) return []; // фильмы — movieUpgrade
  return files.filter((f) => {
    const e = episodes.find((x) => x.season === f.season && x.number === f.number);
    if (!e?.airDate || daysSince(e.airDate, today) > UPGRADE_DAYS) return false;
    const dub = p.replaceWithHigher && f.dubPosition !== null && f.dubPosition > 0;
    const quality = f.dubPosition !== null && f.resolution !== null && f.resolution < p.quality.target;
    return dub || quality;
  });
}

/** Первая по рейтингу подходящая раздача, которая лучше файла: позиция выше, либо та же позиция и качество выше (не выше целевого). */
export function betterVerdict(file: EpisodeFile, verdicts: Verdict[], releasesById: Map<number, Pick<Release, 'parsed'>>, target: number): Verdict | null {
  if (file.dubPosition === null) return null;
  for (const v of verdicts) {
    if (!v.ok || v.position === null) continue;
    const res = releasesById.get(v.releaseId)?.parsed.resolution ?? null;
    if (v.position < file.dubPosition) return v;
    if (v.position === file.dubPosition && res !== null && file.resolution !== null && res > file.resolution && res <= target) return v;
  }
  return null;
}

/** «Улучшение: LostFilm → HDrezka» или «Улучшение: 1080p → 2160p». */
export function upgradeNote(file: EpisodeFile, release: Pick<Release, 'parsed'>, v: Verdict, profile: Profile, studioName: (id: number) => string | undefined): string {
  if (v.position !== null && file.dubPosition !== null && v.position < file.dubPosition) {
    const d = profile.dubs[v.position];
    return `Улучшение: ${file.studioLabel ?? dubLabel(profile.dubs[file.dubPosition], studioName)} → ${d ? dubLabel(d, studioName) : '?'}`;
  }
  return `Улучшение: ${file.resolution}p → ${release.parsed.resolution}p`;
}
