export const DEFAULT_NAMING_TV =
  "{Show}/Season {ss}/{Show} - S{ss}E{ee} - {Quality} {VO}";
export const DEFAULT_NAMING_MOVIE =
  "{Show} ({Year})/{Show} ({Year}) - {Quality} {VO}";

/** Чистит сегмент пути от запрещённых в ФС символов. */
export function sanitizeName(s: string): string {
  return s
    .replace(/[/\\:*?"<>|]/g, " ")
    .replace(/\.\.+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface NameVars {
  show: string;
  year: string;
  season?: number;
  episode?: number;
  quality: string;
  vo: string;
}

/**
 * Подставляет токены {Show} {Year} {ss} {ee} {Quality} {VO} в шаблон.
 * Сегменты пути чистятся по отдельности; пустые токены не оставляют
 * висячих разделителей в конце сегмента.
 */
export function renderTemplate(template: string, vars: NameVars): string {
  const pad = (n?: number) => (n == null ? "" : String(n).padStart(2, "0"));
  return template
    .split("/")
    .map((segment) =>
      segment
        .replaceAll("{Show}", sanitizeName(vars.show))
        .replaceAll("{Year}", sanitizeName(vars.year))
        .replaceAll("{ss}", pad(vars.season))
        .replaceAll("{ee}", pad(vars.episode))
        .replaceAll("{Quality}", sanitizeName(vars.quality))
        .replaceAll("{VO}", sanitizeName(vars.vo))
        .replace(/\s+/g, " ")
        .replace(/[\s.\-–]+$/, "")
        .trim(),
    )
    .filter((seg) => seg.length > 0)
    .join("/");
}
