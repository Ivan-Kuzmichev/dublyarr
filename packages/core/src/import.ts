import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { addFile, type LibFile } from "./db/files.js";
import type { Download } from "./db/downloads.js";
import { updateDownload } from "./db/downloads.js";
import type { Db } from "./db/index.js";
import { listEpisodes, type Title } from "./db/titles.js";
import { renderTemplate } from "./naming.js";
import { parseEpisodeTag } from "./parser.js";
import { qualityKeyFor, qualityLabel } from "./quality.js";

const VIDEO_EXT = new Set([".mkv", ".mp4", ".avi", ".m4v"]);

export interface ImportOptions {
  libraryDir: string;
  template: string;
  /** Подменяется в тестах; по умолчанию hardlink с fallback на копию. */
  linkFile?: (src: string, dest: string) => void;
}

export type ImportResult =
  | { ok: true; files: LibFile[] }
  | { ok: false; error: string };

export function hardlinkOrCopy(src: string, dest: string): void {
  try {
    linkSync(src, dest);
  } catch {
    copyFileSync(src, dest);
  }
}

function listVideoFiles(root: string): { path: string; size: number }[] {
  const st = statSync(root);
  if (st.isFile()) {
    return VIDEO_EXT.has(extname(root).toLowerCase())
      ? [{ path: root, size: st.size }]
      : [];
  }
  const out: { path: string; size: number }[] = [];
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!VIDEO_EXT.has(extname(entry.name).toLowerCase())) continue;
    const p = join(entry.parentPath, entry.name);
    out.push({ path: p, size: statSync(p).size });
  }
  return out;
}

/**
 * Раскладывает завершённую загрузку в библиотеку: сериалы — по SxxEyy
 * из имён файлов, фильмы — самый большой видеофайл. При успехе пишет
 * files, проставляет episodes.file_id и переводит download в imported.
 * При ошибке БД не трогает — вызывающий решает, что писать в error.
 */
export function importDownload(
  db: Db,
  download: Download,
  title: Title,
  contentPath: string,
  opts: ImportOptions,
): ImportResult {
  if (!existsSync(contentPath)) {
    return { ok: false, error: "Файлы загрузки не найдены на диске" };
  }
  const videos = listVideoFiles(contentPath);
  if (videos.length === 0) {
    return { ok: false, error: "В загрузке нет видеофайлов" };
  }
  const link = opts.linkFile ?? hardlinkOrCopy;
  const qKey = qualityKeyFor(download.qualitySource, download.qualityResolution);
  const vars = {
    show: title.titleOriginal || title.titleRu,
    year: title.year,
    quality: qKey ? qualityLabel(qKey) : "",
    vo: download.voiceoverStudio ?? "",
  };
  const imported: LibFile[] = [];

  if (title.type === "movie") {
    const best = [...videos].sort((a, b) => b.size - a.size)[0];
    const dest = join(
      opts.libraryDir,
      renderTemplate(opts.template, vars) + extname(best.path).toLowerCase(),
    );
    mkdirSync(dirname(dest), { recursive: true });
    link(best.path, dest);
    imported.push(
      addFile(db, {
        titleId: title.id,
        episodeId: null,
        path: dest,
        size: best.size,
        qualitySource: download.qualitySource,
        qualityResolution: download.qualityResolution,
        voiceoverStudio: download.voiceoverStudio,
        releaseGuid: download.releaseGuid,
      }),
    );
  } else {
    const byKey = new Map(
      listEpisodes(db, title.id).map((e) => [`${e.season}:${e.episode}`, e]),
    );
    for (const v of videos) {
      const tag = parseEpisodeTag(basename(v.path));
      if (!tag) continue;
      const ep = byKey.get(`${tag.season}:${tag.episode}`);
      if (!ep || ep.fileId != null) continue;
      const dest = join(
        opts.libraryDir,
        renderTemplate(opts.template, {
          ...vars,
          season: tag.season,
          episode: tag.episode,
        }) + extname(v.path).toLowerCase(),
      );
      mkdirSync(dirname(dest), { recursive: true });
      link(v.path, dest);
      imported.push(
        addFile(db, {
          titleId: title.id,
          episodeId: ep.id,
          path: dest,
          size: v.size,
          qualitySource: download.qualitySource,
          qualityResolution: download.qualityResolution,
          voiceoverStudio: download.voiceoverStudio,
          releaseGuid: download.releaseGuid,
        }),
      );
    }
    if (imported.length === 0) {
      return { ok: false, error: "Не удалось сопоставить файлы с сериями" };
    }
  }

  updateDownload(db, download.id, { status: "imported", progress: 1, error: null });
  return { ok: true, files: imported };
}
