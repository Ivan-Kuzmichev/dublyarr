import path from 'node:path';

// Пути: перевод «как видит qBittorrent» → «как видит Dublyarr» и имя файла в медиатеке по шаблону.

export const DEFAULT_TEMPLATE = '{Название} ({Год})/Season {С}/{Название} S{С}E{Е} [{Студия} {Качество}]';
export type TemplateVars = { name: string; original: string; year: number | null; season: number; episode: number; studio: string; quality: string };

export class PathError extends Error {}

const MAX_PART = 120;
const sanitize = (s: string) => s.replace(/[/\\:*?"<>|]/g, '-');
const two = (n: number) => String(n).padStart(2, '0');

/** Относительный путь в медиатеке. «/» в шаблоне — разделитель каталогов; значения не могут его добавить. */
export function renderTemplate(template: string, v: TemplateVars, ext: string): string {
  const values: Record<string, string> = {
    Название: v.name,
    Оригинал: v.original,
    Год: v.year === null ? '' : String(v.year),
    С: two(v.season),
    Е: two(v.episode),
    Студия: v.studio,
    Перевод: v.studio, // фильм: тип перевода
    Качество: v.quality,
  };
  const parts = template
    .split('/')
    .map((part) =>
      part
        .replace(/\{([^}]+)\}/g, (_m, k: string) => sanitize(values[k] ?? ''))
        .replace(/\s+/g, ' ')
        .replace(/\[\s*/g, '[')
        .replace(/\s*\]/g, ']')
        .replace(/\(\s*/g, '(')
        .replace(/\s*\)/g, ')')
        .replace(/\[\]|\(\)/g, '')
        .replace(/\s+/g, ' ')
        .replace(/^[\s.]+|[\s.]+$/g, '')
        .slice(0, MAX_PART)
        .trim(),
    )
    .filter(Boolean);
  if (!parts.length) throw new PathError('Шаблон дал пустое имя');
  const e = ext.startsWith('.') ? ext : `.${ext}`;
  return `${parts.join('/')}${e}`;
}

/** Путь файла от qBittorrent → путь внутри контейнера Dublyarr (замена корня папки загрузок). */
export function toLocalPath(qbitPath: string, qbitRoot: string, localRoot: string): string {
  const fail = () => new PathError(`Путь qBittorrent вне папки загрузок: ${qbitPath}`);
  if (qbitPath.includes('\\') || /^[A-Za-z]:/.test(qbitPath)) throw fail();
  const p = path.posix.normalize(qbitPath).replace(/\/+$/, '');
  const root = path.posix.normalize(qbitRoot).replace(/\/+$/, '');
  const local = localRoot.replace(/\/+$/, '');
  if (p === root) return local;
  if (!p.startsWith(`${root}/`)) throw fail();
  return `${local}${p.slice(root.length)}`;
}
