import type { JackettRelease } from "./jackett.js";
import type { ParsedRelease } from "./parser.js";
import { qualityKeyFor, qualityRank } from "./quality.js";

export interface ScoreContext {
  /** Ключи качеств из пресета (галочки по лестнице). */
  allowed: string[];
  /** Предпочитаемый ключ качества. */
  preferred: string;
  /** Выбранная студия озвучки или "any". */
  voiceover: string;
  /** Минимум сидов. */
  minSeeders: number;
}

type Rel = ParsedRelease<JackettRelease>;

function studios(r: Rel): string[] {
  return r.parsed.voiceovers.flatMap((v) => v.studios);
}

/** Ключ качества раздачи по source+resolution или null, если не распознан. */
export function releaseQualityKey(r: Rel): string | null {
  return qualityKeyFor(r.parsed.quality.source, r.parsed.quality.resolution);
}

/** Проходит ли раздача базовые фильтры: озвучка, качество в allowed, сиды ≥ min. */
export function releaseMatches(r: Rel, ctx: ScoreContext): boolean {
  if (ctx.voiceover !== "any" && !studios(r).includes(ctx.voiceover)) return false;
  const key = releaseQualityKey(r);
  if (!key || !ctx.allowed.includes(key)) return false;
  if (r.seeders < ctx.minSeeders) return false;
  return true;
}

/**
 * Чем ближе качество к preferred — тем выше; при равной близости выше тот,
 * у кого выше абсолютный ранг; финальный tie-break — сиды.
 */
export function scoreRelease(r: Rel, ctx: ScoreContext): number {
  const key = releaseQualityKey(r);
  const rank = key ? qualityRank(key) : 0;
  const dist = Math.abs(rank - qualityRank(ctx.preferred));
  const seeders = Math.min(r.seeders, 9999);
  return -dist * 1_000_000 + rank * 10_000 + seeders;
}

/**
 * Лучшая подходящая раздача из списка (не в blacklist) или null.
 * isBlacklisted(guid) — предикат проверки чёрного списка.
 */
export function pickBestRelease(
  releases: Rel[],
  ctx: ScoreContext,
  isBlacklisted: (guid: string) => boolean,
): Rel | null {
  const candidates = releases
    .filter((r) => releaseMatches(r, ctx) && !isBlacklisted(r.guid))
    .sort((a, b) => scoreRelease(b, ctx) - scoreRelease(a, ctx));
  return candidates[0] ?? null;
}
