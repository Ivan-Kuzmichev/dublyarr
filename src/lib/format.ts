import type { ParsedRelease } from './parse/types';

const num = (n: number) => (n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10).replace('.', ','));

/** «2,3 ГБ», «612 МБ», «1,5 ТБ». */
export function formatSize(bytes: number): string {
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${num(v)} ${units[i]}`;
}

const SOURCE: Record<NonNullable<ParsedRelease['source']>, string> = {
  webdl: 'WEB-DL',
  webrip: 'WEBRip',
  bdrip: 'BDRip',
  remux: 'Remux',
  hdtv: 'HDTV',
  dvd: 'DVD',
  cam: 'CAMRip',
};

export function qualityLabel(p: Pick<ParsedRelease, 'resolution' | 'source' | 'hdr' | 'dv'>): string {
  const parts = [p.resolution ? `${p.resolution}p` : null, p.source ? SOURCE[p.source] : null, p.dv ? 'DV' : p.hdr ? 'HDR' : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}
