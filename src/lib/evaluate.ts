import type { Episode, Release } from './db/schema';
import { dubLabel, type DubPosition, type Profile } from './profile-core';
import { addDays, formatShortDate } from './dates';
import type { ParsedRelease } from './parse/types';

// Оценка раздач для подписки: почему раздача не подходит, и какая из подходящих лучшая.

export type Target = { season: number; episode?: number };
export type Verdict = {
  releaseId: number;
  ok: boolean;
  best: boolean;
  reason: string;
  position: number | null; // индекс позиции профиля, которой соответствует раздача
  tone: 'best' | 'ok' | 'wait' | 'reject' | 'ask';
  until?: string; // для ожидания — дата, когда позиция откроется
};
type Ctx = { profile: Profile; episodes: Pick<Episode, 'season' | 'number' | 'airDate'>[]; studioName: (id: number) => string | undefined; today: string };

const GB = 1024 ** 3;
const GENERIC = /^(?:DUB|MVO|DVO|VO|AVO)$/;
const MIN_ALLOWED = 720;

/** Место для финальной проверки Laya (фаза 4): «это серия N сезона S в озвучке Y?». Пока — всегда «да». */
export const finalCheck = (_r: Release) => true;

function covers(p: ParsedRelease, t: Target, singleSeason: boolean): boolean {
  const seasons = p.seasons.length ? p.seasons : singleSeason ? [1] : [];
  if (!seasons.includes(t.season)) return false;
  if (t.episode === undefined || !p.episodes || seasons.length > 1) return true;
  return p.episodes.from <= t.episode && t.episode <= p.episodes.to;
}

function positionOf(p: ParsedRelease, dubs: DubPosition[]): number | null {
  const i = dubs.findIndex((d) =>
    d.kind === 'studio' ? p.dubs.some((x) => x.studioId === d.studioId) : d.kind === 'any' ? p.dubs.length > 0 : p.original && p.subs,
  );
  return i < 0 ? null : i;
}

function episodeCount(p: ParsedRelease, ctx: Ctx): number {
  if (p.episodes) return Math.max(1, p.episodes.to - p.episodes.from + 1);
  const n = ctx.episodes.filter((e) => p.seasons.includes(e.season)).length;
  return Math.max(1, n);
}

/** Дата эфира цели: серия — её дата; сезон — последняя вышедшая серия сезона. */
function airDateOf(t: Target, ctx: Ctx): string | null {
  if (t.episode !== undefined) return ctx.episodes.find((e) => e.season === t.season && e.number === t.episode)?.airDate ?? null;
  const aired = ctx.episodes.filter((e) => e.season === t.season && e.airDate && e.airDate <= ctx.today).map((e) => e.airDate!);
  return aired.sort().at(-1) ?? null;
}

type Checked = { r: Release; verdict: Verdict };

export function evaluateReleases(releases: Release[], ctx: Ctx, target: Target): Verdict[] {
  const q = ctx.profile.quality;
  const singleSeason = new Set(ctx.episodes.filter((e) => e.season > 0).map((e) => e.season)).size <= 1;
  const air = airDateOf(target, ctx);
  const hasAny = ctx.profile.dubs.some((d) => d.kind === 'any');
  const reject = (r: Release, reason: string, tone: Verdict['tone'] = 'reject', position: number | null = null): Checked => ({
    r,
    verdict: { releaseId: r.id, ok: false, best: false, reason, position, tone },
  });

  const checked: Checked[] = releases.map((r) => {
    const p = r.parsed;
    if (r.match.level === 'reject') return reject(r, r.match.rule === 'reject' ? 'В чёрном списке' : 'Не тот сериал');
    if (r.match.level === 'doubt') return reject(r, 'Сомнительное совпадение', 'ask');
    if (!covers(p, target, singleSeason)) return reject(r, 'Не та серия');
    if (p.screener) return reject(r, 'Экранка');
    const res = p.resolution ?? 480;
    if (res < q.target) {
      if (!q.allowLower) return reject(r, `Ниже ${q.target}p`);
      if (res < MIN_ALLOWED) return reject(r, `Ниже ${MIN_ALLOWED}p`);
    }
    if (q.maxSizeGb !== null && r.size / episodeCount(p, ctx) > q.maxSizeGb * GB) return reject(r, `Больше ${String(q.maxSizeGb).replace('.', ',')} ГБ`);
    if (r.seeders === 0) return reject(r, 'Нет сидов');
    const pos = positionOf(p, ctx.profile.dubs);
    if (pos === null) {
      const unknownNamed = p.dubs.some((d) => d.studioId === null && d.by !== 'tag' && !GENERIC.test(d.label));
      return unknownNamed && !hasAny ? reject(r, 'Неизвестная студия', 'ask') : reject(r, 'Не в профиле озвучки');
    }
    const opensAt = air ? addDays(air, ctx.profile.dubs[pos].waitDays) : null;
    if (opensAt && opensAt > ctx.today) {
      const top = dubLabel(ctx.profile.dubs[0], ctx.studioName);
      const w = reject(r, `Рано: ждём ${top} до ${formatShortDate(opensAt, ctx.today)}`, 'wait', pos);
      w.verdict.until = opensAt;
      return w;
    }
    return { r, verdict: { releaseId: r.id, ok: true, best: false, reason: '', position: pos, tone: 'ok' } };
  });

  const rank = (c: Checked) => {
    const p = c.r.parsed;
    const res = p.resolution ?? 480;
    return [
      c.verdict.position ?? 99,
      p.pack ? 1 : 0,
      res === q.target ? 0 : res > q.target ? 1 : 2,
      res > q.target ? res - q.target : q.target - res,
      q.preferHdr && (p.hdr || p.dv) ? 0 : 1,
      -(c.r.seeders ?? 0),
      c.r.size,
    ];
  };
  const cmp = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  };
  const passed = checked.filter((c) => c.verdict.ok).sort((a, b) => cmp(rank(a), rank(b)));
  const best = passed.find((c) => finalCheck(c.r));
  for (const c of passed) {
    const n = (c.verdict.position ?? 0) + 1;
    c.verdict.best = c === best;
    c.verdict.tone = c === best ? 'best' : 'ok';
    c.verdict.reason = `${c === best ? 'Лучший' : 'Подходит'} · ${n}-я по приоритету`;
  }
  return checked.map((c) => c.verdict);
}
