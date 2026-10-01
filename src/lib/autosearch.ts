import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from './db/client';
import { downloads, episodeFiles, subscriptions, titles, wantedState, type EpisodeRef, type Release } from './db/schema';
import { listEpisodes, listSeasons } from './catalog';
import { wantedEpisodes } from './subscriptions';
import { listStudios } from './studios';
import type { Profile } from './profile-core';
import { searchTitle, type SearchOptions } from './search';
import { evaluateReleases, type Verdict } from './evaluate';
import { betterVerdict, upgradeCandidates, upgradeNote } from './upgrade';
import { planEpisode, seasonFinished, coversWholeSeason, claimedSeasonTotal } from './plan';
import { activeDownloads, enableFiles, releaseStalled, startRelease, type DownloadDeps, type Paths } from './downloads';
import type { Qbit } from './qbit';
import { todayIso } from './dates';
import { log } from './log';
import { eagerTitles } from './forecast';
import { notifyWanted } from './notify-events';
import { getSchedule, inNightWindow, searchDue, type ScheduleSettings } from './schedule';

// Поиск и загрузка по подпискам (воркер, раз в час и по кнопке «Искать сейчас»).


export type AutoDeps = {
  qbit: Qbit | null;
  fetchTorrent: DownloadDeps['fetchTorrent'];
  paths: Paths;
  searchOpts?: SearchOptions;
  today?: string;
  now?: number;
};

const key = (e: EpisodeRef) => `${e.season}:${e.number}`;

function setWanted(db: Db, titleId: number, ep: EpisodeRef, state: 'waiting' | 'missing' | 'ask', reason: string, until: string | null, now: number, releaseId: number | null = null) {
  const prev = db
    .select({ state: wantedState.state })
    .from(wantedState)
    .where(and(eq(wantedState.titleId, titleId), eq(wantedState.season, ep.season), eq(wantedState.number, ep.number)))
    .get();
  const row = { titleId, season: ep.season, number: ep.number, state, reason, until, releaseId, checkedAt: now };
  db.insert(wantedState)
    .values(row)
    .onConflictDoUpdate({ target: [wantedState.titleId, wantedState.season, wantedState.number], set: row })
    .run();
  notifyWanted(db, row, prev?.state ?? null, now);
}
const clearWanted = (db: Db, titleId: number, ep: EpisodeRef) =>
  db.delete(wantedState).where(and(eq(wantedState.titleId, titleId), eq(wantedState.season, ep.season), eq(wantedState.number, ep.number))).run();

/** Подпись студии для имени файла: позиция профиля, по которой раздача прошла. */
function studioFor(profile: Profile, v: Verdict | undefined, r: Release, names: Map<number, string>): string | null {
  const pos = v?.position;
  const d = pos === null || pos === undefined ? undefined : profile.dubs[pos];
  if (d?.kind === 'studio') return names.get(d.studioId) ?? null;
  if (d?.kind === 'original') return 'Оригинал';
  const known = r.parsed.dubs.find((x) => x.studioId !== null);
  return known ? (names.get(known.studioId!) ?? known.label) : (r.parsed.dubs[0]?.label ?? null);
}

export async function searchSubscription(db: Db, titleId: number, deps: AutoDeps) {
  const res = { started: 0, waiting: 0, missing: 0 };
  const now = deps.now ?? Date.now();
  const today = deps.today ?? todayIso();
  const sub = db.select().from(subscriptions).where(eq(subscriptions.titleId, titleId)).get();
  if (!sub) return res;
  const profile = sub.profile;
  const seasons = listSeasons(db, titleId);
  const eps = seasons.flatMap((s) => listEpisodes(db, titleId, s.number));
  const fileRows = db.select().from(episodeFiles).where(eq(episodeFiles.titleId, titleId)).all();
  const have = new Set(fileRows.map(key));
  // застрявшие (сутки без сидов) не считаются «уже качается» — для их серий ищем замену
  const stalled = activeDownloads(db, titleId).filter((d) => d.state === 'stalled');
  const stuck = new Set(stalled.flatMap((d) => d.episodes.map(key)));
  const busy = new Set(activeDownloads(db, titleId).filter((d) => d.state !== 'stalled').flatMap((d) => d.episodes.map(key)));
  const wanted = wantedEpisodes(sub, eps, today).filter((e) => !have.has(key(e)));
  let need = wanted.filter((e) => !busy.has(key(e)));
  // статусы серий, которые больше не нужны (сменилась подписка, скачали вручную), — убрать
  const wantedKeys = new Set(wanted.map(key));
  for (const w of db.select().from(wantedState).where(eq(wantedState.titleId, titleId)).all())
    if (!wantedKeys.has(key(w))) clearWanted(db, titleId, w);
  // скачанные серии, которые стоит улучшить (озвучка выше по приоритету, целевое качество)
  const upgrades = upgradeCandidates(sub, fileRows, eps, today).filter((f) => !busy.has(key(f)));
  if (!need.length && !upgrades.length) return res;

  // «Сезон целиком после финала»: незаконченные сезоны ждут, законченные качаются одним паком.
  // Сезон с сериями без даты решается после поиска — по паку, заявляющему весь сезон.
  const finished: number[] = [];
  const maybe: number[] = [];
  const forFinale = need;
  const waitFinale = (s: number) => {
    for (const e of forFinale.filter((x) => x.season === s)) {
      setWanted(db, titleId, e, 'waiting', 'Ждём финал сезона', null, now);
      res.waiting++;
    }
  };
  if (profile.wholeSeasonAfterFinale) {
    for (const s of [...new Set(need.map((e) => e.season))]) {
      if (seasonFinished(s, eps, today)) finished.push(s);
      else if (seasonFinished(s, eps, today, Infinity)) maybe.push(s);
      else waitFinale(s);
    }
    need = [];
  }
  if (!need.length && !finished.length && !maybe.length && !upgrades.length) return res;

  const { releases } = await searchTitle(db, titleId, deps.searchOpts);
  // отвергнутые раздачи: убранная из клиента — целиком, с ошибкой «нет файла» — только для тех серий
  const rejected = new Map<number, Set<string> | 'all'>();
  for (const d of db.select().from(downloads).where(and(eq(downloads.titleId, titleId), inArray(downloads.state, ['error', 'removed', 'stalled']))).all()) {
    if (d.releaseId === null) continue;
    const prev = rejected.get(d.releaseId);
    if (d.state === 'removed' || prev === 'all') rejected.set(d.releaseId, 'all');
    else rejected.set(d.releaseId, new Set([...(prev ?? []), ...d.episodes.map(key)]));
  }
  const usableFor = (ep?: EpisodeRef) =>
    releases.filter((r) => {
      const x = rejected.get(r.id);
      return !x || (x !== 'all' && (ep ? !x.has(key(ep)) : x.size === 0));
    });
  const usable = usableFor();
  const byId = new Map(releases.map((r) => [r.id, r]));
  const names = new Map(listStudios(db).map((s) => [s.id, s.name]));
  const ctx = { profile, episodes: eps, studioName: (id: number) => names.get(id), today };
  const dl: DownloadDeps | null = deps.qbit ? { qbit: deps.qbit, fetchTorrent: deps.fetchTorrent, paths: { qbitDownloads: deps.paths.qbitDownloads ?? deps.paths.downloads }, now } : null;

  // Что запустить: раздача → серии (серии одного пака — одной загрузкой).
  type Start = { release: Release; eps: EpisodeRef[]; kind: 'episode' | 'pack' | 'season'; label: string | null; dubPosition: number | null; note?: string; upgrade?: boolean };
  const starts = new Map<number, Start>();

  const seasonTargets = [...finished];
  for (const s of maybe) {
    // «весь сезон» — только от подходящих раздач (не отклонённых по сериалу, качеству, размеру)
    const okIds = new Set(evaluateReleases(usable, ctx, { season: s }).filter((v) => v.ok).map((v) => v.releaseId));
    const claims = usable
      .filter((r) => okIds.has(r.id))
      .map((r) => claimedSeasonTotal(r.parsed, s))
      .filter((n): n is number => n !== undefined);
    if (claims.length && seasonFinished(s, eps, today, Math.max(...claims))) seasonTargets.push(s);
    else waitFinale(s);
  }
  for (const s of seasonTargets) {
    const count = eps.filter((e) => e.season === s).length;
    const verdicts = evaluateReleases(usable, ctx, { season: s }).filter((v) => v.ok && coversWholeSeason(byId.get(v.releaseId)!.parsed, s, count));
    const best = verdicts.find((v) => v.best) ?? verdicts[0];
    // серии сезона по подписке, без файла и не в другой загрузке; серии без даты закончившегося сезона — тоже
    const dated = eps.map((e) => (e.season === s && !e.airDate ? { ...e, airDate: today } : e));
    const seasonEps = wantedEpisodes(sub, dated, today).filter((e) => e.season === s && !have.has(key(e)) && !busy.has(key(e)));
    if (!seasonEps.length) continue;
    if (!best) {
      for (const e of seasonEps) setWanted(db, titleId, e, 'missing', 'Нет полного пака сезона', null, now);
      res.missing += seasonEps.length;
      continue;
    }
    const r = byId.get(best.releaseId)!;
    starts.set(r.id, { release: r, eps: seasonEps, kind: 'season', label: studioFor(profile, best, r, names), dubPosition: best.position });
  }

  const active = activeDownloads(db, titleId).filter((d) => d.state !== 'stalled');
  for (const ep of need) {
    const verdicts = evaluateReleases(usableFor(ep), ctx, { season: ep.season, episode: ep.number });
    const plan = planEpisode(ep, verdicts, byId, active);
    if (plan.action === 'have') continue;
    // замены нет — серия остаётся в застрявшей загрузке («качается»)
    if (stuck.has(key(ep)) && (plan.action === 'wait' || plan.action === 'ask' || plan.action === 'none')) continue;
    if (plan.action === 'wait') {
      setWanted(db, titleId, ep, 'waiting', plan.reason, plan.until, now);
      res.waiting++;
      continue;
    }
    if (plan.action === 'ask' || plan.action === 'none') {
      const askAbout = plan.action === 'ask' ? (verdicts.find((v) => v.tone === 'ask')?.releaseId ?? null) : null;
      setWanted(db, titleId, ep, plan.action === 'ask' ? 'ask' : 'missing', plan.reason, null, now, askAbout);
      res.missing++;
      continue;
    }
    if (!dl) {
      setWanted(db, titleId, ep, 'missing', 'qBittorrent не подключён', null, now);
      res.missing++;
      continue;
    }
    if (plan.action === 'enable-file') {
      try {
        await enableFiles(db, dl, plan.downloadId, [ep]);
        clearWanted(db, titleId, ep);
        res.started++;
      } catch (e) {
        setWanted(db, titleId, ep, 'missing', e instanceof Error ? e.message : String(e), null, now);
        res.missing++;
      }
      continue;
    }
    const r = byId.get(plan.releaseId)!;
    const v = verdicts.find((x) => x.releaseId === r.id);
    const entry = starts.get(r.id) ?? { release: r, eps: [], kind: plan.action === 'add-pack' ? ('pack' as const) : ('episode' as const), label: studioFor(profile, v, r, names), dubPosition: v?.position ?? null };
    entry.eps.push(ep);
    starts.set(r.id, entry);
  }

  // улучшения — отдельными загрузками с подписью; статусы «нужна» их не касаются
  if (dl)
    for (const f of upgrades) {
      const ep = { season: f.season, number: f.number };
      // раздача, из которой этот файл и взят, улучшением не считается (позиция могла устареть после правки профиля)
      const ownRelease = f.downloadId ? db.select({ r: downloads.releaseId }).from(downloads).where(eq(downloads.id, f.downloadId)).get()?.r : null;
      const verdicts = evaluateReleases(usableFor(ep), ctx, { season: f.season, episode: f.number }).filter((x) => x.releaseId !== ownRelease);
      const v = betterVerdict(f, verdicts, byId, profile.quality.target);
      if (!v) continue;
      const r = byId.get(v.releaseId)!;
      const same = starts.get(r.id);
      if (same?.upgrade) {
        same.eps.push(ep); // улучшения из одного пака — одной загрузкой
        continue;
      }
      if (same) continue; // раздача уже идёт для нужных серий — улучшение в следующий раз
      starts.set(r.id, { release: r, eps: [ep], kind: r.parsed.pack ? 'pack' : 'episode', label: studioFor(profile, v, r, names), dubPosition: v.position, note: upgradeNote(f, r, v, profile, (id) => names.get(id)), upgrade: true });
    }

  if (!dl) {
    for (const s of starts.values()) for (const e of s.eps) setWanted(db, titleId, e, 'missing', 'qBittorrent не подключён', null, now);
    return res;
  }
  for (const s of starts.values()) {
    try {
      const d = await startRelease(db, dl, s.release, s.eps, s.kind, s.label, { dubPosition: s.dubPosition, note: s.note });
      if (s.upgrade) {
        if (d.state !== 'error') res.started++;
        continue;
      }
      if (d.state === 'error') for (const e of s.eps) setWanted(db, titleId, e, 'missing', d.lastError ?? 'Ошибка загрузки', null, now);
      else {
        for (const e of s.eps) clearWanted(db, titleId, e);
        for (const st of stalled) {
          const moved = s.eps.filter((e) => st.episodes.some((x) => key(x) === key(e)));
          if (moved.length) await releaseStalled(db, st.id, moved, d.id, dl.qbit);
        }
        res.started++;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn({ titleId, release: s.release.id, err: msg }, 'start failed');
      if (s.upgrade) continue;
      for (const ep of s.eps) setWanted(db, titleId, ep, 'missing', msg, null, now);
      res.missing += s.eps.length;
    }
  }
  return res;
}

async function searchTitles(db: Db, deps: AutoDeps, ids: number[], now: number, keepGoing: (titleId: number) => boolean = () => true) {
  const res = { titles: 0, started: 0, errors: 0 };
  for (const titleId of ids) {
    if (!keepGoing(titleId)) continue;
    res.titles++;
    try {
      res.started += (await searchSubscription(db, titleId, deps)).started;
    } catch (e) {
      res.errors++;
      log.warn({ titleId, err: e instanceof Error ? e.message : String(e) }, 'subscription search failed');
    }
    // время попытки — и при ошибке, чтобы не повторять сбойный поиск каждые 5 минут
    db.update(subscriptions).set({ lastSearchedAt: now }).where(eq(subscriptions.titleId, titleId)).run();
  }
  return res;
}

/** Все подписки по очереди («Искать сейчас»); ошибка одной не мешает остальным. */
export async function searchAll(db: Db, deps: AutoDeps) {
  const ids = db.select({ titleId: subscriptions.titleId }).from(subscriptions).innerJoin(titles, eq(titles.id, subscriptions.titleId)).all().map((s) => s.titleId);
  return searchTitles(db, deps, ids, deps.now ?? Date.now());
}

/** Подписки, которым пора искать по расписанию (spec §5). */
export function dueTitles(db: Db, now: Date, settings: ScheduleSettings): number[] {
  const eager = settings.eager ? eagerTitles(db, now.toLocaleDateString('sv-SE')) : new Set<number>();
  return db
    .select({ titleId: subscriptions.titleId, last: subscriptions.lastSearchedAt })
    .from(subscriptions)
    .innerJoin(titles, eq(titles.id, subscriptions.titleId))
    .all()
    .filter((s) => searchDue({ lastSearchedAt: s.last, now, settings, eagerToday: eager.has(s.titleId) }))
    .map((s) => s.titleId);
}

/** Поиск по расписанию (задача воркера раз в 5 минут). */
export async function searchDueTitles(db: Db, deps: AutoDeps, now = new Date(), clock: () => Date = () => new Date()) {
  const settings = getSchedule(db);
  const ids = dueTitles(db, now, settings);
  const eager = settings.eager ? eagerTitles(db, now.toLocaleDateString('sv-SE')) : new Set<number>();
  // «только ночью»: окно могло закончиться посреди прохода — остальные ждут следующей ночи
  const keepGoing = (id: number) => settings.every !== 'night' || eager.has(id) || inNightWindow(clock(), settings.nightFrom, settings.nightTo);
  return searchTitles(db, { ...deps, today: deps.today ?? now.toLocaleDateString('sv-SE') }, ids, now.getTime(), keepGoing);
}
