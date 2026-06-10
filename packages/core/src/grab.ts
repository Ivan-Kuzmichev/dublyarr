import { createDownload, updateDownload, type Download } from "./db/downloads.js";
import type { Db } from "./db/index.js";
import { QbtError, type QbtClient } from "./qbittorrent.js";

export interface GrabInput {
  titleId: number;
  link: string;
  guid: string;
  releaseTitle: string;
  episodesCovered: number[];
  voiceoverStudio: string | null;
  qualitySource: string | null;
  qualityResolution: string | null;
}

export interface GrabOptions {
  /** Путь staging для qBittorrent (savepath). */
  stagingDir?: string;
  /** Сколько раз опрашивать listTorrents в поисках hash (по умолчанию 5). */
  attempts?: number;
  /** Пауза между попытками, мс (по умолчанию 1000; в тестах 0). */
  waitMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Создаёт download, добавляет раздачу в qBittorrent (category=dublyarr, tag=download.tag)
 * и пытается резолвить hash по тегу. При ошибке addTorrent помечает download failed и
 * пробрасывает исключение. Если hash не нашёлся — download остаётся queued
 * (hash доберётся при следующем поллинге).
 */
export async function grabRelease(
  db: Db,
  qbt: QbtClient,
  input: GrabInput,
  opts: GrabOptions = {},
): Promise<Download> {
  let download = createDownload(db, {
    titleId: input.titleId,
    releaseGuid: input.guid,
    releaseTitle: input.releaseTitle,
    episodesCovered: input.episodesCovered,
    voiceoverStudio: input.voiceoverStudio,
    qualitySource: input.qualitySource,
    qualityResolution: input.qualityResolution,
  });

  try {
    await qbt.addTorrent({
      url: input.link,
      savePath: opts.stagingDir || undefined,
      category: "dublyarr",
      tags: download.tag,
    });
  } catch (e) {
    const msg = e instanceof QbtError ? e.message : e instanceof Error ? e.message : "qBittorrent недоступен";
    updateDownload(db, download.id, { status: "failed", error: msg });
    throw e;
  }

  const attempts = opts.attempts ?? 5;
  const waitMs = opts.waitMs ?? 1000;
  for (let i = 0; i < attempts; i++) {
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
      break; // hash доберётся при следующем поллинге
    }
    if (i < attempts - 1) await sleep(waitMs);
  }

  return download;
}
