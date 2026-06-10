import { blacklistRelease } from "./db/blacklist.js";
import {
  getDownload,
  listDownloadsForTitle,
  REFRESHABLE_STATUSES,
  updateDownload,
  type Download,
} from "./db/downloads.js";
import { getMonitorNumber, getSetting } from "./db/settings.js";
import { getTitle } from "./db/titles.js";
import type { Db } from "./db/index.js";
import { addHistory } from "./db/history.js";
import { importDownload } from "./import.js";
import { DEFAULT_NAMING_MOVIE, DEFAULT_NAMING_TV } from "./naming.js";
import { QbtError, qbtStateToStatus, type QbtClient } from "./qbittorrent.js";

/** Состояния qBittorrent, которые считаем «застрял» (нет источника/метаданных). */
const STALLED_STATES = new Set(["stalledDL", "metaDL"]);

export interface PollOptions {
  /** Текущее время (для детекта зависших). По умолчанию new Date(). */
  now?: Date;
  /** Таймаут зависания в часах; по умолчанию читается из настроек. */
  stallHours?: number;
}

function hoursBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 3_600_000;
}

/**
 * Один проход по загрузке: queued→downloading→completed→imported по данным qBittorrent.
 * Зависшую (downloading дольше stallHours в состоянии stalledDL/metaDL) помечает failed
 * и заносит в blacklist. Сам читает настройки библиотек/шаблонов. Кидает только при
 * недоступности qBittorrent (ошибка listTorrents).
 */
export async function refreshDownload(
  db: Db,
  qbt: QbtClient,
  d: Download,
  opts: PollOptions = {},
): Promise<void> {
  const now = opts.now ?? new Date();
  const stallHours =
    opts.stallHours ?? getMonitorNumber(db, "monitor_stall_hours");
  const torrent = (await qbt.listTorrents({ tag: d.tag }))[0];

  const fresh = getDownload(db, d.id);
  if (!fresh || !REFRESHABLE_STATUSES.includes(fresh.status)) return;
  d = fresh;

  if (d.status === "queued") {
    if (!torrent) return;
    d = updateDownload(db, d.id, {
      qbitHash: torrent.hash,
      status: "downloading",
      progress: torrent.progress,
    })!;
  }

  if (d.status === "downloading") {
    if (!torrent) {
      updateDownload(db, d.id, { status: "failed", error: "Раздача пропала из qBittorrent" });
      return;
    }
    const next = qbtStateToStatus(torrent.state, torrent.progress);
    if (next === "failed") {
      updateDownload(db, d.id, { status: "failed", error: `qBittorrent: ${torrent.state}` });
      blacklistRelease(db, d.titleId, d.releaseGuid, `qBittorrent: ${torrent.state}`);
      return;
    }
    if (next === "downloading" && stallHours > 0 && STALLED_STATES.has(torrent.state)) {
      const started = new Date(d.createdAt.replace(" ", "T") + (d.createdAt.includes("Z") ? "" : "Z"));
      if (!Number.isNaN(started.getTime()) && hoursBetween(now, started) > stallHours) {
        updateDownload(db, d.id, { status: "failed", error: "Загрузка зависла (таймаут)" });
        blacklistRelease(db, d.titleId, d.releaseGuid, "Зависла дольше таймаута");
        return;
      }
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
    if (!torrent.contentPath) return;
    const title = getTitle(db, d.titleId);
    if (!title) return;
    const libraryDir = getSetting(db, title.type === "tv" ? "library_tv" : "library_movies");
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
      const result = importDownload(db, d, title, torrent.contentPath, { libraryDir, template });
      if (!result.ok) {
        updateDownload(db, d.id, { error: result.error });
      } else {
        addHistory(db, {
          titleId: title.id,
          kind: result.replaced > 0 ? "upgrade" : "import",
          message:
            result.replaced > 0
              ? `Апгрейд: ${d.releaseTitle || d.tag}`
              : `Импортировано: ${d.releaseTitle || d.tag}`,
        });
      }
    } catch (e) {
      updateDownload(db, d.id, {
        error: `Ошибка импорта: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
}

/** Рефреш всех обновляемых загрузок тайтла; возвращает свежий список + текст ошибки qbt. */
export async function pollTitle(
  db: Db,
  qbt: QbtClient,
  titleId: number,
  opts: PollOptions = {},
): Promise<{ downloads: Download[]; qbtError: string | null }> {
  let qbtError: string | null = null;
  const refreshable = listDownloadsForTitle(db, titleId).filter((d) =>
    REFRESHABLE_STATUSES.includes(d.status),
  );
  for (const d of refreshable) {
    try {
      await refreshDownload(db, qbt, d, opts);
    } catch (e) {
      qbtError = e instanceof QbtError ? e.message : "qBittorrent недоступен";
      break;
    }
  }
  return { downloads: listDownloadsForTitle(db, titleId), qbtError };
}
