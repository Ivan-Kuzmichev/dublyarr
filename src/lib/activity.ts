import { asc, desc, eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { downloads, releases, titles, type Download } from './db/schema';
import { CATEGORY } from './downloads';
import type { Qbit } from './qbit';
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
  speedBps: number;
  canPause: boolean;
  canResume: boolean;
  canRemove: boolean;
  active: boolean;
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
      return { state: `${d.pausedBySchedule ? 'Пауза по расписанию' : 'На паузе'} · ${pct} %`, tone: 'muted' };
    case 'stalled':
      return { state: `Нет сидов ${Math.round((now - (d.lastSeededAt ?? d.addedAt)) / HOUR)} ч · ${pct} %`, tone: 'danger' };
    case 'completed':
      return d.lastError ? { state: d.lastError, tone: 'danger' } : { state: 'Скачана, переношу в медиатеку', tone: 'progress' };
    case 'imported':
      return { state: 'В медиатеке', tone: 'ok' };
    case 'error':
      return { state: `Ошибка: ${d.lastError ?? 'неизвестная'}`, tone: 'danger' };
    case 'replaced':
      return { state: d.note ?? 'Заменена', tone: 'muted' };
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
    .select({ d: downloads, tmdbId: titles.tmdbId, title: titles.nameRu, topic: releases.detailsUrl })
    .from(downloads)
    .innerJoin(titles, eq(titles.id, downloads.titleId))
    .leftJoin(releases, eq(releases.id, downloads.releaseId))
    .orderBy(desc(downloads.addedAt), asc(downloads.id))
    .all();
  // когда заменили — время добавления замены
  const addedAt = new Map(rows.map(({ d }) => [d.id, d.addedAt]));
  const recent = (t: number | null | undefined) => t !== null && t !== undefined && now - t < 24 * HOUR;
  const group = (d: Download) =>
    ACTIVE.has(d.state)
      ? 0
      : d.state === 'error'
        ? 1
        : (d.state === 'imported' && recent(d.importedAt)) || (d.state === 'replaced' && recent(d.replacedById ? addedAt.get(d.replacedById) : null))
          ? 2
          : -1;
  return rows
    .filter(({ d }) => group(d) >= 0)
    .sort((a, b) => group(a.d) - group(b.d))
    .map(({ d, tmdbId, title, topic }) => {
      const st = stateOf(d, now);
      const watched = (d.note && ACTIVE.has(d.state) ? `${d.note} · ` : '') + (topic && d.kind === 'pack' && ACTIVE.has(d.state) ? 'Пак · следим за обновлениями · ' : '');
      return {
        id: d.id,
        hash: d.hash,
        tmdbId,
        title,
        code: codeOf(d),
        release: d.name,
        pct: Math.round(d.progress * 100),
        ...st,
        state: watched + st.state,
        speed: d.state === 'downloading' ? formatSpeed(d.dlSpeed) : '',
        speedBps: d.state === 'downloading' ? d.dlSpeed : 0,
        canPause: PAUSABLE.has(d.state),
        canResume: d.state === 'paused',
        canRemove: REMOVABLE.has(d.state),
        active: ACTIVE.has(d.state),
      };
    });
}

const PAUSABLE = new Set(['downloading', 'stalled']);
const REMOVABLE = new Set(['adding', 'downloading', 'paused', 'stalled', 'completed', 'error']);

/** Пауза / продолжить / убрать из клиента (файлы остаются) — только из подходящих состояний. */
export async function controlDownload(db: Db, qbit: Qbit | null, id: number, action: 'pause' | 'resume' | 'remove'): Promise<{ ok: true } | { error: string }> {
  const d = db.select().from(downloads).where(eq(downloads.id, id)).get();
  if (!d) return { error: 'Загрузка не найдена' };
  const allowed = { pause: PAUSABLE.has(d.state), resume: d.state === 'paused', remove: REMOVABLE.has(d.state) }[action];
  if (!allowed) return { error: { pause: 'Эту загрузку нельзя поставить на паузу', resume: 'Эту загрузку нельзя продолжить', remove: 'Эту загрузку нельзя убрать' }[action] };
  if (!qbit) return { error: 'qBittorrent не подключён' };
  try {
    if (action === 'pause') await qbit.stop([d.hash]);
    else if (action === 'resume') await qbit.start([d.hash]);
    else if ((await qbit.list(CATEGORY)).some((t) => t.hash === d.hash)) await qbit.remove([d.hash]);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const state = { pause: 'paused', resume: 'downloading', remove: 'removed' }[action] as Download['state'];
  db.update(downloads).set({ state }).where(eq(downloads.id, d.id)).run();
  return { ok: true };
}
