import { isBlacklisted } from "./db/blacklist.js";
import type { Db } from "./db/index.js";
import { addHistory, recentSearchAt } from "./db/history.js";
import { getPreset } from "./db/presets.js";
import { listEpisodes, listTrackedTitles, type Episode, type Title } from "./db/titles.js";
import { listFiles } from "./db/files.js";
import type { GrabInput } from "./grab.js";
import type { JackettRelease } from "./jackett.js";
import type { ParsedRelease } from "./parser.js";
import { pickBestRelease, type ScoreContext } from "./scoring.js";

export interface Candidate {
  title: Title;
  reason: "missing";
  /** Сезоны с wanted-эпизодами без файла (для tv); для movie — []. */
  wantedSeasons: number[];
  /** wanted-эпизоды без файла (для расчёта episodesCovered при grab). */
  wantedEpisodes: Episode[];
}

export interface SelectOptions {
  now?: Date;
  /** Не искать тайтл чаще, чем раз в N минут (по умолчанию 60). */
  rateLimitMinutes?: number;
}

/**
 * Кандидаты на поиск: сериалы с wanted-эпизодами без файла и фильмы без файлов.
 * Исключает тайтлы, по которым искали недавно (рейт-лимит по history).
 */
export function selectCandidates(
  db: Db,
  today: string,
  opts: SelectOptions = {},
): Candidate[] {
  const now = opts.now ?? new Date();
  const rateMs = (opts.rateLimitMinutes ?? 60) * 60_000;
  const out: Candidate[] = [];

  for (const title of listTrackedTitles(db)) {
    const last = recentSearchAt(db, title.id);
    if (last) {
      const lastMs = new Date(last.replace(" ", "T") + (last.includes("Z") ? "" : "Z")).getTime();
      if (!Number.isNaN(lastMs) && now.getTime() - lastMs < rateMs) continue;
    }

    if (title.type === "movie") {
      if (listFiles(db, title.id).length === 0) {
        out.push({ title, reason: "missing", wantedSeasons: [], wantedEpisodes: [] });
      }
      continue;
    }

    const wantedMissing = listEpisodes(db, title.id).filter((e) => e.wanted && e.fileId == null);
    if (wantedMissing.length > 0) {
      out.push({
        title,
        reason: "missing",
        wantedSeasons: [...new Set(wantedMissing.map((e) => e.season))].sort((a, b) => a - b),
        wantedEpisodes: wantedMissing,
      });
    }
  }
  return out;
}

export interface RunDeps {
  /** Поиск в Jackett по запросу → распарсенные раздачи. */
  search: (query: string) => Promise<ParsedRelease<JackettRelease>[]>;
  /** Скачать выбранную раздачу. */
  grab: (input: GrabInput) => Promise<unknown>;
  /** Минимум сидов. */
  minSeeders: number;
  now?: Date;
}

/**
 * Один тайтл: поиск → фильтр (озвучка/качество/сиды/покрытие сезонов/blacklist) →
 * скоринг → grab лучшего. Пишет историю на каждом шаге. Без апгрейдов (M3b).
 */
export async function runTitle(db: Db, cand: Candidate, deps: RunDeps): Promise<void> {
  const { title } = cand;
  addHistory(db, { titleId: title.id, kind: "search", message: `Поиск: ${title.titleOriginal}` });

  const preset = getPreset(db, title.qualityPresetId);
  if (!preset) {
    addHistory(db, { titleId: title.id, kind: "fail", message: "Пресет качества не найден" });
    return;
  }
  const ctx: ScoreContext = {
    allowed: preset.allowed,
    preferred: preset.preferred,
    voiceover: title.voiceover,
    minSeeders: deps.minSeeders,
  };

  let releases = await deps.search(title.titleOriginal);

  // Для сериала оставляем раздачи, покрывающие хотя бы один нужный сезон.
  if (title.type === "tv" && cand.wantedSeasons.length > 0) {
    const wanted = new Set(cand.wantedSeasons);
    releases = releases.filter(
      (r) => r.parsed.seasons.length === 0 || r.parsed.seasons.some((s) => wanted.has(s)),
    );
  }

  const best = pickBestRelease(releases, ctx, (guid) => isBlacklisted(db, title.id, guid));
  if (!best) {
    addHistory(db, { titleId: title.id, kind: "not_found", message: "Подходящих раздач нет" });
    return;
  }

  const episodesCovered =
    title.type === "tv"
      ? cand.wantedEpisodes
          .filter(
            (e) => best.parsed.seasons.length === 0 || best.parsed.seasons.includes(e.season),
          )
          .map((e) => e.id)
      : [];

  const studios = best.parsed.voiceovers.flatMap((v) => v.studios);
  await deps.grab({
    titleId: title.id,
    link: best.link,
    guid: best.guid,
    releaseTitle: best.title,
    episodesCovered,
    voiceoverStudio: title.voiceover !== "any" ? title.voiceover : (studios[0] ?? null),
    qualitySource: best.parsed.quality.source,
    qualityResolution: best.parsed.quality.resolution,
  });
  addHistory(db, { titleId: title.id, kind: "grab", message: `Скачиваю: ${best.title}` });
}
