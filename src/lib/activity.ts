import { asc, desc, eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { downloads, titles, type Download } from './db/schema';
import { plural } from './plural';

// Очередь «Активности»: загрузки с понятными состояниями.

export type QueueRow = {
  id: number;
  hash: string;
  tmdbId: number;
  title: string;
  code: string;
  release: string;
  pct: number;
  state: string;
  tone: 'progress' | 'danger' | 'ok' | 'muted';
  speed: string;
  canPause: boolean;
  canResume: boolean;
  canRemove: boolean;
};

const HOUR = 3_600_000;
const pad = (n: number) => String(n).padStart(2, '0');
const comma = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

export function formatSpeed(bps: number): string {
  if (bps <= 0) return '0 Б/с';
  if (bps >= 1024 ** 2) return `${comma(bps / 1024 ** 2)} МБ/с`;
  return `${Math.round(bps / 1024)} КБ/с`;
}

const eta = (s: number | null) => {
  if (!s || s <= 0 || s >= 8_640_000) return '';
  if (s < 3600) return ` · ${Math.max(1, Math.round(s / 60))} мин`;
  return ` · ${comma(s / 3600)} ч`;
};

function codeOf(d: Download): string {
  const s = `S${pad(d.season)}`;
  if (d.kind === 'season') return `${s} · весь сезон`;
  if (d.episodes.length === 1) return `${s}E${pad(d.episodes[0].number)}`;
  return `${s} · ${d.episodes.length} ${plural(d.episodes.length, 'серия', 'серии', 'серий')}`;
}

function stateOf(d: Download, now: number): Pick<QueueRow, 'state' | 'tone'> {
  const pct = Math.round(d.progress * 100);
  switch (d.state) {
    case 'adding':
      return { state: 'Добавляется', tone: 'muted' };
    case 'paused':
      return { state: `На паузе · ${pct} %`, tone: 'muted' };
    case 'stalled':
      return { state: `Нет сидов ${Math.round((now - (d.lastSeededAt ?? d.addedAt)) / HOUR)} ч · ${pct} %`, tone: 'danger' };
    case 'completed':
      return d.lastError ? { state: d.lastError, tone: 'danger' } : { state: 'Скачана, переношу в медиатеку', tone: 'progress' };
    case 'imported':
      return { state: 'В медиатеке', tone: 'ok' };
    case 'error':
      return { state: `Ошибка: ${d.lastError ?? 'неизвестная'}`, tone: 'danger' };
    default: {
      const wanted = d.files?.filter((f) => f.priority > 0).length ?? 0;
      const fromPack = d.kind === 'pack' && d.files ? `Из пака: ${wanted} ${plural(wanted, 'файл', 'файла', 'файлов')} из ${d.files.length} · ` : 'Качается · ';
      return { state: `${fromPack}${pct} %${eta(d.eta)}`, tone: 'progress' };
    }
  }
}

const ACTIVE = new Set(['adding', 'downloading', 'paused', 'stalled', 'completed']);

export function activityQueue(db: Db, now = Date.now()): QueueRow[] {
  const rows = db
    .select({ d: downloads, tmdbId: titles.tmdbId, title: titles.nameRu })
    .from(downloads)
    .innerJoin(titles, eq(titles.id, downloads.titleId))
    .orderBy(desc(downloads.addedAt), asc(downloads.id))
    .all();
  const group = (d: Download) => (ACTIVE.has(d.state) ? 0 : d.state === 'error' ? 1 : d.state === 'imported' && now - (d.importedAt ?? 0) < 24 * HOUR ? 2 : -1);
  return rows
    .filter(({ d }) => group(d) >= 0)
    .sort((a, b) => group(a.d) - group(b.d))
    .map(({ d, tmdbId, title }) => ({
      id: d.id,
      hash: d.hash,
      tmdbId,
      title,
      code: codeOf(d),
      release: d.name,
      pct: Math.round(d.progress * 100),
      ...stateOf(d, now),
      speed: d.state === 'downloading' ? formatSpeed(d.dlSpeed) : '',
      canPause: d.state === 'downloading' || d.state === 'stalled',
      canResume: d.state === 'paused',
      canRemove: d.state !== 'imported',
    }));
}
