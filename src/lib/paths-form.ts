import { DEFAULT_TEMPLATE } from './library-path';
import { DEFAULT_MOVIE_TEMPLATE } from './movie-files';
import type { Paths } from './downloads';

const LABEL: Record<string, string> = { qbitDownloads: 'Папка загрузок в qBittorrent', downloads: 'Папка загрузок в Dublyarr', media: 'Медиатека', movies: 'Папка фильмов' };

/** Пути — абсолютные, без завершающего «/»; пустой путь qBittorrent — такой же, как у Dublyarr. */
export function parsePathsForm(form: FormData): (Required<Omit<Paths, 'movies' | 'movieTemplate'>> & Pick<Paths, 'movies' | 'movieTemplate'>) | { error: string } {
  const read = (k: string) => String(form.get(k) ?? '').trim().replace(/(.)\/+$/, '$1');
  const downloads = read('downloads');
  const media = read('media');
  const qbitDownloads = read('qbitDownloads') || downloads;
  for (const [k, v] of Object.entries({ qbitDownloads, downloads, media })) if (!v.startsWith('/')) return { error: `${LABEL[k]}: нужен абсолютный путь` };
  const template = String(form.get('template') ?? '').trim() || DEFAULT_TEMPLATE;
  if (!template.includes('{С}') || !template.includes('{Е}')) return { error: 'В шаблоне нужны {С} и {Е}' };
  // папка фильмов необязательна: без неё фильмы не скачиваются
  const movies = read('movies');
  if (movies && !movies.startsWith('/')) return { error: `${LABEL.movies}: нужен абсолютный путь` };
  const movieTemplate = String(form.get('movieTemplate') ?? '').trim() || DEFAULT_MOVIE_TEMPLATE;
  return { qbitDownloads, downloads, media, template, ...(movies ? { movies, movieTemplate } : {}) };
}
