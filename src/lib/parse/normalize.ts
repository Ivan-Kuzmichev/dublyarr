/** Для сравнения названий: нижний регистр, ё→е, без апострофов и знаков, одинарные пробелы. */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/['’`ʼ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export const tokens = (s: string) => normalizeTitle(s).split(' ').filter(Boolean);
