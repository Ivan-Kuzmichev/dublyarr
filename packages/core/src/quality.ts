export interface QualityLevel {
  key: string;
  label: string;
}

export const QUALITY_LADDER: QualityLevel[] = [
  { key: "bdremux-2160p", label: "BDRemux 2160p" },
  { key: "webdl-2160p", label: "WEB-DL 2160p" },
  { key: "bdremux-1080p", label: "BDRemux 1080p" },
  { key: "bluray-1080p", label: "BluRay 1080p" },
  { key: "bdrip-1080p", label: "BDRip 1080p" },
  { key: "webdl-1080p", label: "WEB-DL 1080p" },
  { key: "webrip-1080p", label: "WEBRip 1080p" },
  { key: "hdtv-1080p", label: "HDTV 1080p" },
  { key: "720p", label: "720p" },
  { key: "sd", label: "SD" },
];

export function qualityRank(key: string): number {
  const i = QUALITY_LADDER.findIndex((q) => q.key === key);
  return i === -1 ? -1 : QUALITY_LADDER.length - i;
}

export function qualityLabel(key: string): string {
  return QUALITY_LADDER.find((q) => q.key === key)?.label ?? key;
}

const SOURCE_1080: Record<string, string> = {
  bdremux: "bdremux-1080p",
  remux: "bdremux-1080p",
  bluray: "bluray-1080p",
  bdrip: "bdrip-1080p",
  "web-dl": "webdl-1080p",
  webrip: "webrip-1080p",
  hdtv: "hdtv-1080p",
};

export function qualityKeyFor(
  source: string | null,
  resolution: string | null,
): string | null {
  const src = source?.toLowerCase() ?? null;
  if (resolution === "2160p") {
    return src === "bdremux" || src === "remux" ? "bdremux-2160p" : "webdl-2160p";
  }
  if (resolution === "1080p") {
    return (src && SOURCE_1080[src]) || "hdtv-1080p";
  }
  if (resolution === "720p") return "720p";
  if (resolution) return "sd";
  return source ? "sd" : null;
}

export function highestAllowed(allowed: string[]): string | null {
  let best: string | null = null;
  for (const key of allowed) {
    if (best === null || qualityRank(key) > qualityRank(best)) best = key;
  }
  return best;
}
