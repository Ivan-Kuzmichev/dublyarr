import path from 'node:path';
import type { Title } from './db/schema';
import type { Paths } from './downloads';
import { isVideo } from './episode-file';

// Файлы фильма: основной видеофайл в раздаче и папка фильмов.

export const DEFAULT_MOVIE_TEMPLATE = '{Название} ({Год})/{Название} ({Год}) [{Перевод} {Качество}]';

const DISC = /(?:^|\/)(?:BDMV|VIDEO_TS|CERTIFICATE)(?:\/|$)|\.iso$/i;
const EXTRA = /(?:^|[\s._\-/])(?:sample|trailer|teaser|extras?|bonus|featurettes?|behind[\s._-]the[\s._-]scenes|deleted[\s._-]scenes)(?:$|[\s._\-/])/i;
const EXT_EXTERNAL = new Set(['.mka', '.ac3', '.eac3', '.dts', '.aac', '.flac', '.srt', '.ass', '.ssa']);

/** Основной видеофайл (самый большой, без сэмплов, трейлеров и бонусов) и внешние дорожки рядом. Индексы — как у qBittorrent. */
export function pickMovieFile(files: { index: number; name: string; size: number }[]): { main: number; external: number[] } | { error: string } {
  if (files.some((f) => DISC.test(f.name))) return { error: 'Диск, а не файл' };
  // корневая папка раздачи не считается: «Trailer.Park.Boys/…» — не трейлер
  const inner = (name: string) => name.split('/').slice(name.includes('/') ? 1 : 0).join('/');
  const extra = (name: string) => EXTRA.test(inner(name).replace(path.extname(name), ''));
  const videos = files.filter((f) => isVideo(f.name) && !extra(f.name)).sort((a, b) => b.size - a.size);
  if (!videos.length) return { error: 'В раздаче нет видеофайла' };
  const external = files.filter((f) => EXT_EXTERNAL.has(path.extname(f.name).toLowerCase()) && !extra(f.name)).map((f) => f.index);
  return { main: videos[0].index, external };
}

/** Корень медиатеки для вида: фильмы — своя папка (может быть не задана). */
export const mediaRoot = (paths: Paths, kind: Title['kind']): string | null => (kind === 'movie' ? (paths.movies ?? null) : paths.media);
