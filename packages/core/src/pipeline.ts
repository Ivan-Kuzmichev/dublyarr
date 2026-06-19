import { isBlacklisted } from "./db/blacklist.js";
import { listDownloadsForTitle, REFRESHABLE_STATUSES } from "./db/downloads.js";
import type { Db } from "./db/index.js";
import { addHistory, recentSearchAt } from "./db/history.js";
import { getPreset } from "./db/presets.js";
import { listEpisodes, listTrackedTitles, type Episode, type Title } from "./db/titles.js";
import { getFile, listFiles } from "./db/files.js";
import type { GrabInput } from "./grab.js";
import type { JackettRelease } from "./jackett.js";
import type { ParsedInfo, ParsedRelease } from "./parser.js";
import { pickBestRelease, type ScoreContext } from "./scoring.js";
import { qualityKeyFor, qualityRank } from "./quality.js";

export interface Candidate {
  title: Title;
  reason: "missing" | "upgrade";
  /** Сезоны с целевыми эпизодами (для tv); для movie — []. */
  wantedSeasons: number[];
  /** Целевые эпизоды (недостающие или апгрейдируемые) — для episodesCovered. */
  wantedEpisodes: Episode[];
  /** Для upgrade: минимальный ранг среди апгрейдируемых файлов (порог «строго лучше»). 0 для missing. */
  upgradeFromRank: number;
}

export interface SelectOptions {
  now?: Date;
  /** Не искать тайтл чаще, чем раз в N минут (по умолчанию 60). */
  rateLimitMinutes?: number;
}

function rankOfFile(source: string | null, resolution: string | null): number {
  const k = qualityKeyFor(source, resolution);
  return k ? qualityRank(k) : -1;
}

function episodeRangeBounds(range: string): [number, number] | null {
  const m = range.match(/^(\d+)(?:\s*[-–—]\s*(\d+))?$/);
  if (!m) return null;
  const a = parseInt(m[1], 10);
  const b = m[2] ? parseInt(m[2], 10) : a;
  return a <= b ? [a, b] : null;
}

/**
 * Покрывает ли раздача эпизод: сезон совпадает (или в раздаче не распознан)
 * и номер серии в диапазоне «Серии: N-M» (или диапазон не распознан — полный сезон).
 */
function releaseCoversEpisode(parsed: ParsedInfo, e: Episode): boolean {
  if (parsed.seasons.length > 0 && !parsed.seasons.includes(e.season)) return false;
  if (parsed.episodes) {
    const r = episodeRangeBounds(parsed.episodes.range);
    if (r && (e.episode < r[0] || e.episode > r[1])) return false;
  }
  return true;
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

    const preset = getPreset(db, title.qualityPresetId);

    // Уже идущие (queued/downloading/completed) загрузки: не подбираем заново то,
    // что уже качается/импортируется — иначе повторный грабёж той же раздачи (шторм).
    const active = listDownloadsForTitle(db, title.id).filter((d) =>
      REFRESHABLE_STATUSES.includes(d.status),
    );

    if (title.type === "movie") {
      if (active.length > 0) continue;
      const fs = listFiles(db, title.id);
      if (fs.length === 0) {
        out.push({ title, reason: "missing", wantedSeasons: [], wantedEpisodes: [], upgradeFromRank: 0 });
        continue;
      }
      if (preset?.upgradeEnabled) {
        const prefRank = qualityRank(preset.preferred);
        const ranks = fs.map((f) => rankOfFile(f.qualitySource, f.qualityResolution));
        const minRank = Math.min(...ranks);
        if (minRank < prefRank) {
          out.push({ title, reason: "upgrade", wantedSeasons: [], wantedEpisodes: [], upgradeFromRank: minRank });
        }
      }
      continue;
    }

    const eps = listEpisodes(db, title.id);
    const coveredByActive = new Set(active.flatMap((d) => d.episodesCovered));
    // Невышедшие серии (airDate в будущем) не ищем; без даты — считаем потенциально вышедшими.
    // Серии, уже покрытые активной загрузкой, исключаем (качаются/импортируются).
    const wantedMissing = eps.filter(
      (e) =>
        e.wanted &&
        e.fileId == null &&
        !coveredByActive.has(e.id) &&
        (e.airDate == null || e.airDate <= today),
    );
    if (wantedMissing.length > 0) {
      out.push({
        title,
        reason: "missing",
        wantedSeasons: [...new Set(wantedMissing.map((e) => e.season))].sort((a, b) => a - b),
        wantedEpisodes: wantedMissing,
        upgradeFromRank: 0,
      });
      continue;
    }

    if (preset?.upgradeEnabled) {
      const prefRank = qualityRank(preset.preferred);
      const upgradable = eps.filter((e) => {
        if (e.fileId == null || coveredByActive.has(e.id)) return false;
        const f = getFile(db, e.fileId);
        return f != null && rankOfFile(f.qualitySource, f.qualityResolution) < prefRank;
      });
      if (upgradable.length > 0) {
        const minRank = Math.min(
          ...upgradable.map((e) => {
            const f = getFile(db, e.fileId!)!;
            return rankOfFile(f.qualitySource, f.qualityResolution);
          }),
        );
        out.push({
          title,
          reason: "upgrade",
          wantedSeasons: [...new Set(upgradable.map((e) => e.season))].sort((a, b) => a - b),
          wantedEpisodes: upgradable,
          upgradeFromRank: minRank,
        });
      }
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
 * скоринг → grab лучшего. Пишет историю на каждом шаге.
 * Для upgrade дополнительно фильтрует раздачи рангом строго выше upgradeFromRank.
 */
export async function runTitle(db: Db, cand: Candidate, deps: RunDeps): Promise<void> {
  const { title } = cand;
  const isUpgrade = cand.reason === "upgrade";
  addHistory(db, {
    titleId: title.id,
    kind: "search",
    message: isUpgrade ? `Поиск апгрейда: ${title.titleOriginal}` : `Поиск: ${title.titleOriginal}`,
  });

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

  if (title.type === "tv" && cand.wantedEpisodes.length > 0) {
    releases = releases.filter((r) =>
      cand.wantedEpisodes.some((e) => releaseCoversEpisode(r.parsed, e)),
    );
  }

  if (isUpgrade) {
    releases = releases.filter((r) => {
      const k = qualityKeyFor(r.parsed.quality.source, r.parsed.quality.resolution);
      return k != null && qualityRank(k) > cand.upgradeFromRank;
    });
  }

  const best = pickBestRelease(releases, ctx, (guid) => isBlacklisted(db, title.id, guid));
  if (!best) {
    addHistory(db, { titleId: title.id, kind: "not_found", message: "Подходящих раздач нет" });
    return;
  }

  const covered =
    title.type === "tv"
      ? cand.wantedEpisodes.filter((e) => releaseCoversEpisode(best.parsed, e))
      : [];

  const studios = best.parsed.voiceovers.flatMap((v) => v.studios);
  await deps.grab({
    titleId: title.id,
    link: best.link,
    guid: best.guid,
    releaseTitle: best.title,
    episodesCovered: covered.map((e) => e.id),
    wantedEpisodes: covered.map((e) => ({ season: e.season, episode: e.episode })),
    voiceoverStudio: title.voiceover !== "any" ? title.voiceover : (studios[0] ?? null),
    qualitySource: best.parsed.quality.source,
    qualityResolution: best.parsed.quality.resolution,
  });
  addHistory(db, {
    titleId: title.id,
    kind: "grab",
    message: isUpgrade ? `Качаю апгрейд: ${best.title}` : `Скачиваю: ${best.title}`,
  });
}
