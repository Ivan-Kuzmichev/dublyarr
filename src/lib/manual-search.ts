import { isMovieProfile } from './movie-profile';
import { eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { releases, type Release } from './db/schema';
import { getTitleByTmdbId, listEpisodes, listSeasons } from './catalog';
import { getSubscription } from './subscriptions';
import { getDefaultProfile } from './profile';
import { createStudio, listStudios, updateStudio } from './studios';
import { normalizeStudio } from './studios-normalize';
import { searchTitle, reparseReleases, type SearchOptions, type SourceStatus } from './search';
import { evaluateReleases, type Target, type Verdict } from './evaluate';
import { addRule } from './release-rules';
import { todayIso } from './dates';
import type { DubBy } from './parse/types';

export type ManualRow = { release: Release; verdict: Verdict; dubs: { label: string; studioName?: string; by: DubBy }[] };
export type ManualResult = { rows: ManualRow[]; sources: SourceStatus[]; profileSource: 'subscription' | 'default' };

const TONE_ORDER: Verdict['tone'][] = ['best', 'ok', 'wait', 'ask', 'reject'];

/** Ручной поиск: опросить источники и оценить раздачи для серии или сезона по профилю подписки (или профилю по умолчанию). */
export async function runManualSearch(db: Db, tmdbId: number, target: Target, opts: SearchOptions & { today?: string } = {}): Promise<ManualResult> {
  const title = getTitleByTmdbId(db, tmdbId);
  if (!title) throw new Error('Сериал не найден');
  const { releases: found, sources } = await searchTitle(db, title.id, opts);
  const sub = getSubscription(db, title.id);
  const profile = sub && !isMovieProfile(sub.profile) ? sub.profile : getDefaultProfile(db, title.kind);
  const names = new Map(listStudios(db).map((s) => [s.id, s.name]));
  const episodes = listSeasons(db, title.id).flatMap((s) => listEpisodes(db, title.id, s.number));
  const verdicts = evaluateReleases(found, { profile, episodes, studioName: (id) => names.get(id), today: opts.today ?? todayIso() }, target);
  const byId = new Map(verdicts.map((v) => [v.releaseId, v]));
  const rows = found
    .map((release) => ({
      release,
      verdict: byId.get(release.id)!,
      dubs: release.parsed.dubs.map((d) => ({ label: d.label, studioName: d.studioId !== null ? names.get(d.studioId) : undefined, by: d.by })),
    }))
    .sort((a, b) => TONE_ORDER.indexOf(a.verdict.tone) - TONE_ORDER.indexOf(b.verdict.tone) || (b.release.seeders ?? 0) - (a.release.seeders ?? 0));
  return { rows, sources, profileSource: sub ? 'subscription' : 'default' };
}

/** «Назначить студию»: подпись из заголовка становится вариантом написания студии (или новой студией). */
export function assignStudio(db: Db, titleId: number, a: { label: string; studioId: number } | { label: string; newName: string }) {
  if ('studioId' in a) {
    const s = listStudios(db).find((x) => x.id === a.studioId);
    if (!s) throw new Error('Студия не найдена');
    if (![s.name, ...s.aliases].some((v) => normalizeStudio(v) === normalizeStudio(a.label)))
      updateStudio(db, s.id, { name: s.name, aliases: [...s.aliases, a.label], kind: s.kind, trackers: s.trackers });
  } else {
    createStudio(db, { name: a.newName, aliases: normalizeStudio(a.newName) === normalizeStudio(a.label) ? [] : [a.label], kind: 'both', trackers: [] });
  }
  reparseReleases(db, titleId);
}

/** Ответ «это он / не он» — правило для трекера и основы заголовка. */
export function answerMatch(db: Db, titleId: number, releaseId: number, verdict: 'match' | 'reject') {
  const r = db.select().from(releases).where(eq(releases.id, releaseId)).get();
  if (!r || r.titleId !== titleId) throw new Error('Раздача не найдена');
  addRule(db, titleId, r.trackerName, r.title, verdict);
  reparseReleases(db, titleId);
}
