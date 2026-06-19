import { blacklistRelease } from "./db/blacklist.js";
import { createDownload, updateDownload, type Download } from "./db/downloads.js";
import type { Db } from "./db/index.js";
import { parseEpisodeTag } from "./parser.js";
import { QbtError, type QbtClient } from "./qbittorrent.js";

/**
 * Индексы файлов раздачи, которые НЕ нужно качать: распознанные как серия SxxEyy,
 * но не входящие в keep (нужные серии). Нераспознанные файлы и сами keep-серии
 * остаются. Пустой keep → ничего не сбрасываем (защита от полного дропа).
 */
export function unwantedFileIndices(
  files: { name: string }[],
  keep: { season: number; episode: number }[],
): number[] {
  if (keep.length === 0) return [];
  const wantedKeys = new Set(keep.map((e) => `${e.season}:${e.episode}`));
  const wantedEpisodes = new Set(keep.map((e) => e.episode));
  const drop: number[] = [];
  files.forEach((f, i) => {
    const tag = parseEpisodeTag(f.name);
    if (!tag) return; // нераспознанные файлы не трогаем
    // Аниме-метка без сезона: матчим по номеру серии (keep — обычно один сезон).
    const isWanted =
      tag.season != null
        ? wantedKeys.has(`${tag.season}:${tag.episode}`)
        : wantedEpisodes.has(tag.episode);
    if (!isWanted) drop.push(i);
  });
  return drop;
}

export interface GrabInput {
  titleId: number;
  link: string;
  guid: string;
  releaseTitle: string;
  episodesCovered: number[];
  voiceoverStudio: string | null;
  qualitySource: string | null;
  qualityResolution: string | null;
  /** Серии, которые реально нужны из раздачи; остальные файлы пака не качаем. */
  wantedEpisodes?: { season: number; episode: number }[];
}

export interface GrabOptions {
  /** Путь staging для qBittorrent (savepath). */
  stagingDir?: string;
  /** Сколько раз опрашивать listTorrents в поисках hash (по умолчанию 5). */
  attempts?: number;
  /** Пауза между попытками, мс (по умолчанию 1000; в тестах 0). */
  waitMs?: number;
  /** Таймаут скачивания .torrent-файла, мс (по умолчанию 120000). */
  torrentFetchTimeoutMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Для season-пака помечает priority=0 файлам серий, которые не нужны (есть/не wanted),
 * чтобы качались только нужные серии. Ошибки глотаем: торрент уже добавлен, в худшем
 * случае скачается целиком. Без wantedEpisodes (фильм/нет данных) ничего не делает.
 */
async function deselectUnwantedFiles(
  qbt: QbtClient,
  hash: string,
  wantedEpisodes: GrabInput["wantedEpisodes"],
): Promise<void> {
  if (!wantedEpisodes || wantedEpisodes.length === 0) return;
  try {
    const files = await qbt.listFiles(hash);
    const drop = unwantedFileIndices(files, wantedEpisodes).map(
      (i) => files[i].index,
    );
    if (drop.length > 0) await qbt.setFilePriority(hash, drop, 0);
  } catch {
    // приоритеты не критичны — не валим grab
  }
}

type TorrentSource = { kind: "file"; file: Buffer } | { kind: "magnet"; uri: string };

/**
 * Скачивает .torrent сам (Jackett может ходить на трекер дольше, чем 30-секундный
 * таймаут qBittorrent — раздача тогда молча не появляется). Редирект на magnet
 * пробрасывается как магнит; не-bencode ответ (HTML-страница ошибки) — отказ.
 */
async function fetchTorrentSource(
  url: string,
  timeoutMs: number,
  depth = 0,
): Promise<TorrentSource> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "manual",
  });
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location") ?? "";
    if (loc.startsWith("magnet:")) return { kind: "magnet", uri: loc };
    if (loc && depth < 3) {
      return fetchTorrentSource(new URL(loc, url).toString(), timeoutMs, depth + 1);
    }
    throw new QbtError(`Не удалось скачать torrent-файл: редирект без адреса (HTTP ${res.status})`);
  }
  if (!res.ok) {
    throw new QbtError(`Не удалось скачать torrent-файл: HTTP ${res.status}`);
  }
  const file = Buffer.from(await res.arrayBuffer());
  // bencode-словарь начинается с 'd'; иначе это, скорее всего, HTML-страница ошибки
  if (file.length === 0 || file[0] !== 0x64) {
    throw new QbtError("Источник вернул не torrent-файл");
  }
  return { kind: "file", file };
}

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
    const common = {
      savePath: opts.stagingDir || undefined,
      category: "dublyarr",
      tags: download.tag,
    };
    if (/^https?:\/\//i.test(input.link)) {
      const source = await fetchTorrentSource(
        input.link,
        opts.torrentFetchTimeoutMs ?? 120_000,
      );
      if (source.kind === "file") {
        await qbt.addTorrentFile({
          file: source.file,
          filename: `${download.tag}.torrent`,
          ...common,
        });
      } else {
        await qbt.addTorrent({ url: source.uri, ...common });
      }
    } else {
      await qbt.addTorrent({ url: input.link, ...common });
    }
  } catch (e) {
    const msg = e instanceof QbtError ? e.message : e instanceof Error ? e.message : "qBittorrent недоступен";
    updateDownload(db, download.id, { status: "failed", error: msg });
    // qBittorrent отклонил саму раздачу (битый/дубликат торрента) — это устойчиво,
    // заносим в blacklist, чтобы конвейер не выбирал её снова и снова (шторм отказов).
    // Сетевые/HTTP-ошибки (прокси флапает) не блэклистим — они транзиентные.
    if (e instanceof QbtError && e.code === "rejected") {
      blacklistRelease(db, input.titleId, input.guid, "qBittorrent отклонил раздачу");
    }
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
        await deselectUnwantedFiles(qbt, found.hash, input.wantedEpisodes);
        break;
      }
    } catch {
      break; // hash доберётся при следующем поллинге
    }
    if (i < attempts - 1) await sleep(waitMs);
  }

  return download;
}
