import { NextResponse } from "next/server";
import {
  getSetting,
  getTitle,
  listDownloadsForTitle,
  listEpisodes,
} from "@dublyarr/core/db";
import { grabRelease } from "@dublyarr/core/grab";
import { QbtError } from "@dublyarr/core/qbittorrent";
import { pollTitle } from "@dublyarr/core/poll";
import { getDb } from "@/server/db";
import { qbtFromSettings } from "@/server/qbt";

export async function GET(req: Request) {
  const titleId = Number(new URL(req.url).searchParams.get("titleId"));
  if (!Number.isInteger(titleId) || titleId <= 0) {
    return NextResponse.json({ error: "Некорректный titleId" }, { status: 400 });
  }
  const db = getDb();
  const qbt = qbtFromSettings(db);
  if (!qbt) {
    return NextResponse.json({ downloads: listDownloadsForTitle(db, titleId), qbtError: null });
  }
  const { downloads, qbtError } = await pollTitle(db, qbt, titleId);
  return NextResponse.json({ downloads, qbtError });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const titleId = Number(body.titleId);
  const link = typeof body.link === "string" ? body.link : "";
  const guid = typeof body.guid === "string" ? body.guid : "";
  const releaseTitle = typeof body.title === "string" ? body.title : "";
  const seasons = Array.isArray(body.seasons)
    ? (body.seasons.filter((n) => Number.isInteger(n)) as number[])
    : [];
  const voiceoverStudio =
    typeof body.voiceoverStudio === "string" && body.voiceoverStudio
      ? body.voiceoverStudio
      : null;
  const qualitySource =
    typeof body.qualitySource === "string" && body.qualitySource
      ? body.qualitySource
      : null;
  const qualityResolution =
    typeof body.qualityResolution === "string" && body.qualityResolution
      ? body.qualityResolution
      : null;

  if (!Number.isInteger(titleId) || titleId <= 0 || !link) {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  const db = getDb();
  const title = getTitle(db, titleId);
  if (!title) {
    return NextResponse.json({ error: "Тайтл не найден" }, { status: 404 });
  }
  const qbt = qbtFromSettings(db);
  if (!qbt) {
    return NextResponse.json({ error: "qBittorrent не настроен" }, { status: 400 });
  }

  const episodesCovered =
    title.type === "tv" && seasons.length > 0
      ? listEpisodes(db, titleId)
          .filter((e) => seasons.includes(e.season))
          .map((e) => e.id)
      : [];

  try {
    const download = await grabRelease(
      db,
      qbt,
      {
        titleId,
        link,
        guid,
        releaseTitle,
        episodesCovered,
        voiceoverStudio,
        qualitySource,
        qualityResolution,
      },
      { stagingDir: getSetting(db, "staging_dir") || undefined },
    );
    return NextResponse.json(download, { status: 201 });
  } catch (e) {
    const msg = e instanceof QbtError ? e.message : "qBittorrent недоступен";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
