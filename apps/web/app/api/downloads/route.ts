import { NextResponse } from "next/server";
import {
  createDownload,
  getSetting,
  getTitle,
  listEpisodes,
  updateDownload,
} from "@dublyarr/core/db";
import { QbtError } from "@dublyarr/core/qbittorrent";
import { getDb } from "@/server/db";
import { qbtFromSettings } from "@/server/qbt";

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

  let download = createDownload(db, {
    titleId,
    releaseGuid: guid,
    releaseTitle,
    episodesCovered,
    voiceoverStudio,
    qualitySource,
    qualityResolution,
  });

  try {
    await qbt.addTorrent({
      url: link,
      savePath: getSetting(db, "staging_dir") || undefined,
      category: "dublyarr",
      tags: download.tag,
    });
  } catch (e) {
    const msg = e instanceof QbtError ? e.message : "qBittorrent недоступен";
    updateDownload(db, download.id, { status: "failed", error: msg });
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // qBittorrent не возвращает hash при добавлении — ищем по тегу
  for (let i = 0; i < 5; i++) {
    try {
      const found = (await qbt.listTorrents({ tag: download.tag }))[0];
      if (found) {
        download = updateDownload(db, download.id, {
          qbitHash: found.hash,
          status: "downloading",
          progress: found.progress,
        })!;
        break;
      }
    } catch {
      break; // hash доберётся при следующем GET-рефреше
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  return NextResponse.json(download, { status: 201 });
}
