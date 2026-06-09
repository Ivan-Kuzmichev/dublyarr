import { NextResponse } from "next/server";
import {
  addTitle,
  getPreset,
  getSetting,
  getTitleByTmdb,
  listTrackedTitles,
  syncEpisodes,
  type MonitorRule,
  type TitleType,
} from "@dublyarr/core/db";
import { TmdbError, getDetails, getSeasonEpisodes, type TmdbEpisode } from "@dublyarr/core/tmdb";
import { getDb } from "@/server/db";

export async function GET() {
  return NextResponse.json(listTrackedTitles(getDb()));
}

const MONITOR_RULES = new Set(["all", "future_only", "manual"]);

export async function POST(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  const type = body.type === "movie" || body.type === "tv" ? (body.type as TitleType) : null;
  const tmdbId = Number(body.tmdbId);
  const qualityPresetId = Number(body.qualityPresetId);
  const voiceover = typeof body.voiceover === "string" && body.voiceover.trim() ? body.voiceover.trim() : "any";
  const monitorRule = MONITOR_RULES.has(String(body.monitorRule))
    ? (body.monitorRule as MonitorRule)
    : "all";

  if (!type || !Number.isInteger(tmdbId) || tmdbId <= 0) {
    return NextResponse.json({ error: "Некорректные type/tmdbId" }, { status: 400 });
  }
  const db = getDb();
  if (!getPreset(db, qualityPresetId)) {
    return NextResponse.json({ error: "Пресет не найден" }, { status: 400 });
  }
  if (getTitleByTmdb(db, type, tmdbId)) {
    return NextResponse.json({ error: "Уже отслеживается" }, { status: 409 });
  }
  const apiKey = getSetting(db, "tmdb_api_key");
  if (!apiKey) {
    return NextResponse.json({ error: "TMDb API ключ не настроен" }, { status: 400 });
  }

  try {
    const details = await getDetails(type, tmdbId, apiKey);
    const title = addTitle(db, {
      tmdbId,
      type,
      titleRu: details.title,
      titleOriginal: details.originalTitle,
      year: details.year,
      posterPath: details.posterPath,
      overview: details.overview,
      tmdbStatus: details.status,
      qualityPresetId,
      voiceover,
      monitorRule,
    });
    if (type === "tv" && details.seasons) {
      const eps: TmdbEpisode[] = [];
      for (let s = 1; s <= details.seasons; s++) {
        eps.push(...(await getSeasonEpisodes(tmdbId, s, apiKey)));
      }
      syncEpisodes(db, title.id, eps, monitorRule);
    }
    return NextResponse.json(title, { status: 201 });
  } catch (e) {
    if (e instanceof TmdbError && e.status === 404) {
      return NextResponse.json({ error: "Тайтл не найден в TMDb" }, { status: 404 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
