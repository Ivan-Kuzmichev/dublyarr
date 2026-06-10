import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { addFile, deleteFileRecord, getFile, listFiles, type LibFile } from "./db/files.js";
import type { Download } from "./db/downloads.js";
import { updateDownload } from "./db/downloads.js";
import type { Db } from "./db/index.js";
import { listEpisodes, type Title } from "./db/titles.js";
import { renderTemplate } from "./naming.js";
import { parseEpisodeTag } from "./parser.js";
import { qualityKeyFor, qualityLabel, qualityRank } from "./quality.js";

const VIDEO_EXT = new Set([".mkv", ".mp4", ".avi", ".m4v"]);

export interface ImportOptions {
  libraryDir: string;
  template: string;
  /** Подменяется в тестах; по умолчанию hardlink с fallback на копию. */
  linkFile?: (src: string, dest: string) => void;
}

export type ImportResult =
  | { ok: true; files: LibFile[]; replaced: number }
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

/** Ранг качества записи файла (или -1, если не распознан). */
function rankOf(source: string | null, resolution: string | null): number {
  const k = qualityKeyFor(source, resolution);
  return k ? qualityRank(k) : -1;
}

/** Удаляет старую запись файла и unlink с диска (если путь отличается от нового). */
function dropOldFile(db: Db, oldId: number, newDest: string): void {
  const removed = deleteFileRecord(db, oldId);
  if (removed && removed.path !== newDest) {
    try {
      unlinkSync(removed.path);
    } catch {
      // файла уже нет — запись всё равно удалена
    }
  }
}

/**
 * Раскладывает завершённую загрузку в библиотеку: сериалы — по SxxEyy из имён,
 * фильмы — самый большой видеофайл. Если у эпизода/фильма уже есть файл, новый
 * заменяет старый ТОЛЬКО при строго более высоком качестве (апгрейд): старый файл
 * удаляется с диска и из БД; иначе видео пропускается. Переводит download в imported.
 * Ранние ошибки (нет файлов/видео/не сопоставлено) БД не мутируют; повторный импорт
 * безопасен (равное/худшее качество не трогает существующие файлы).
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
  const newRank = qKey ? qualityRank(qKey) : -1;
  const vars = {
    show: title.titleOriginal || title.titleRu,
    year: title.year,
    quality: qKey ? qualityLabel(qKey) : "",
    vo: download.voiceoverStudio ?? "",
  };
  const imported: LibFile[] = [];
  let replaced = 0;

  function place(dest: string, srcPath: string, episodeId: number | null, size: number): void {
    mkdirSync(dirname(dest), { recursive: true });
    link(srcPath, dest);
    imported.push(
      addFile(db, {
        titleId: title.id,
        episodeId,
        path: dest,
        size,
        qualitySource: download.qualitySource,
        qualityResolution: download.qualityResolution,
        voiceoverStudio: download.voiceoverStudio,
        releaseGuid: download.releaseGuid,
      }),
    );
  }

  if (title.type === "movie") {
    const existing = listFiles(db, title.id);
    const bestExistingRank = existing.length
      ? Math.max(...existing.map((f) => rankOf(f.qualitySource, f.qualityResolution)))
      : -1;
    if (existing.length > 0 && newRank <= bestExistingRank) {
      updateDownload(db, download.id, { status: "imported", progress: 1, error: null });
      return { ok: true, files: [], replaced: 0 };
    }
    const best = [...videos].sort((a, b) => b.size - a.size)[0];
    const rendered = renderTemplate(opts.template, vars);
    if (!rendered) return { ok: false, error: "Шаблон имени дал пустой путь" };
    const dest = join(opts.libraryDir, rendered + extname(best.path).toLowerCase());
    place(dest, best.path, null, best.size);
    for (const old of existing) {
      dropOldFile(db, old.id, dest);
      replaced += 1;
    }
  } else {
    const byKey = new Map(
      listEpisodes(db, title.id).map((e) => [`${e.season}:${e.episode}`, e]),
    );
    let matched = 0;
    for (const v of videos) {
      const tag = parseEpisodeTag(basename(v.path));
      if (!tag) continue;
      const key = `${tag.season}:${tag.episode}`;
      const ep = byKey.get(key);
      if (!ep) continue;
      matched += 1;

      let oldFileId: number | null = null;
      if (ep.fileId != null) {
        const oldFile = getFile(db, ep.fileId);
        const oldRank = oldFile ? rankOf(oldFile.qualitySource, oldFile.qualityResolution) : -1;
        if (newRank <= oldRank) continue;
        oldFileId = ep.fileId;
      }

      const rendered = renderTemplate(opts.template, {
        ...vars,
        season: tag.season,
        episode: tag.episode,
      });
      if (!rendered) return { ok: false, error: "Шаблон имени дал пустой путь" };
      const dest = join(opts.libraryDir, rendered + extname(v.path).toLowerCase());
      place(dest, v.path, ep.id, v.size);
      if (oldFileId != null) {
        dropOldFile(db, oldFileId, dest);
        replaced += 1;
      }
      byKey.delete(key);
    }
    if (imported.length === 0 && matched === 0) {
      return { ok: false, error: "Не удалось сопоставить файлы с сериями" };
    }
  }

  updateDownload(db, download.id, { status: "imported", progress: 1, error: null });
  return { ok: true, files: imported, replaced };
}
