// «Та ли серия»: длительность файла против длительности серии по TMDB (spec §6).

const fmt = (sec: number) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин`;
};

/** Причина, если файл явно не серия; null — похоже на серию (или проверить нечем). */
export function wrongEpisode(durationSec: number | null, runtimeMin: number | null): string | null {
  if (!durationSec) return null;
  if (runtimeMin) {
    const ratio = durationSec / 60 / runtimeMin;
    return ratio < 0.5 || ratio > 2 ? `Не та серия: ${fmt(durationSec)} вместо ~${runtimeMin} мин` : null;
  }
  return durationSec > 100 * 60 ? `Похоже на фильм: ${fmt(durationSec)}` : null;
}
