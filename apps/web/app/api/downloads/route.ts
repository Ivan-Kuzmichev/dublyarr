import { NextResponse } from "next/server";
import {
  getDownload,
  getSetting,
  getTitle,
  listDownloadsForTitle,
  listEpisodes,
  updateDownload,
  REFRESHABLE_STATUSES,
  type Download,
} from "@dublyarr/core/db";
import { grabRelease } from "@dublyarr/core/grab";
import { importDownload } from "@dublyarr/core/import";
import {
  DEFAULT_NAMING_MOVIE,
  DEFAULT_NAMING_TV,
} from "@dublyarr/core/naming";
import { QbtError, qbtStateToStatus, type QbtClient } from "@dublyarr/core/qbittorrent";
import { getDb } from "@/server/db";
import { qbtFromSettings } from "@/server/qbt";

async function refreshOne(
  db: ReturnType<typeof getDb>,
  qbt: QbtClient,
  d: Download,
): Promise<void> {
  const torrent = (await qbt.listTorrents({ tag: d.tag }))[0];

  // после await статус мог измениться конкурентным запросом — перечитываем
  const fresh = getDownload(db, d.id);
  if (!fresh || !REFRESHABLE_STATUSES.includes(fresh.status)) return;
  d = fresh;

  if (d.status === "queued") {
    if (!torrent) return; // ещё не появился в qBittorrent
    d = updateDownload(db, d.id, {
      qbitHash: torrent.hash,
      status: "downloading",
      progress: torrent.progress,
    })!;
  }

  if (d.status === "downloading") {
    if (!torrent) {
      updateDownload(db, d.id, {
        status: "failed",
        error: "Раздача пропала из qBittorrent",
      });
      return;
    }
    const next = qbtStateToStatus(torrent.state, torrent.progress);
    if (next === "failed") {
      updateDownload(db, d.id, {
        status: "failed",
        error: `qBittorrent: ${torrent.state}`,
      });
      return;
    }
    d = updateDownload(db, d.id, { status: next, progress: torrent.progress })!;
  }

  if (d.status === "completed") {
    if (!torrent) {
      updateDownload(db, d.id, {
        status: "failed",
        error: "Раздача пропала из qBittorrent — импорт невозможен",
      });
      return;
    }
    if (!torrent.contentPath) return; // qbt ещё не отдал content_path
    const title = getTitle(db, d.titleId);
    if (!title) return;
    const libraryDir = getSetting(
      db,
      title.type === "tv" ? "library_tv" : "library_movies",
    );
    if (!libraryDir) {
      updateDownload(db, d.id, {
        error: "Не настроена папка библиотеки (Настройки → Папки и имена)",
      });
      return;
    }
    const template =
      getSetting(db, title.type === "tv" ? "naming_tv" : "naming_movie") ||
      (title.type === "tv" ? DEFAULT_NAMING_TV : DEFAULT_NAMING_MOVIE);
    try {
      const result = importDownload(db, d, title, torrent.contentPath, {
        libraryDir,
        template,
      });
      if (!result.ok) updateDownload(db, d.id, { error: result.error });
    } catch (e) {
      updateDownload(db, d.id, {
        error: `Ошибка импорта: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
}

export async function GET(req: Request) {
  const titleId = Number(new URL(req.url).searchParams.get("titleId"));
  if (!Number.isInteger(titleId) || titleId <= 0) {
    return NextResponse.json({ error: "Некорректный titleId" }, { status: 400 });
  }
  const db = getDb();
  const qbt = qbtFromSettings(db);
  let qbtError: string | null = null;

  if (qbt) {
    const refreshable = listDownloadsForTitle(db, titleId).filter((d) =>
      REFRESHABLE_STATUSES.includes(d.status),
    );
    for (const d of refreshable) {
      try {
        await refreshOne(db, qbt, d);
      } catch (e) {
        qbtError = e instanceof QbtError ? e.message : "qBittorrent недоступен";
        break;
      }
    }
  }

  return NextResponse.json({
    downloads: listDownloadsForTitle(db, titleId),
    qbtError,
  });
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
