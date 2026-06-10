import type { Db } from "./db/index.js";
import { addHistory } from "./db/history.js";
import { getMonitorNumber, getSetting } from "./db/settings.js";
import { getTitle } from "./db/titles.js";
import { grabRelease, type GrabInput } from "./grab.js";
import { searchJackett as realSearchJackett } from "./jackett.js";
import { parseRelease } from "./parser.js";
import {
  runTitle,
  selectCandidates,
  type Candidate,
  type RunDeps,
} from "./pipeline.js";
import { pollTitle } from "./poll.js";
import { QbtClient } from "./qbittorrent.js";

type SearchJackett = typeof realSearchJackett;

export interface TickClients {
  /** Подменяется в тестах; по умолчанию реальный searchJackett. */
  searchJackett?: SearchJackett;
  /** Готовый qBittorrent-клиент. */
  qbt: QbtClient;
}

/** Собирает RunDeps из настроек БД и клиентов. */
export function makeDeps(db: Db, clients: TickClients): RunDeps {
  const search: SearchJackett = clients.searchJackett ?? realSearchJackett;
  const jackettUrl = getSetting(db, "jackett_url") ?? "";
  const jackettKey = getSetting(db, "jackett_api_key") ?? "";
  const stagingDir = getSetting(db, "staging_dir") || undefined;

  return {
    minSeeders: getMonitorNumber(db, "monitor_min_seeders"),
    search: async (query) =>
      (await search({ url: jackettUrl, apiKey: jackettKey }, query)).map(parseRelease),
    grab: (input: GrabInput) => grabRelease(db, clients.qbt, input, { stagingDir }),
  };
}

/** Обрабатывает одного кандидата (поиск+grab), затем пробует продвинуть его загрузки. */
async function processCandidate(db: Db, qbt: QbtClient, deps: RunDeps, cand: Candidate): Promise<void> {
  try {
    await runTitle(db, cand, deps);
  } catch (e) {
    addHistory(db, {
      titleId: cand.title.id,
      kind: "fail",
      message: `Ошибка поиска: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
  // Сразу попробуем продвинуть статусы (queued→downloading и т.п.)
  await pollTitle(db, qbt, cand.title.id).catch(() => {});
}

/**
 * Один полный тик: поиск недостающего по кандидатам + продвижение их загрузок.
 * Возвращает число обработанных тайтлов.
 */
export async function runTick(db: Db, clients: TickClients): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const deps = makeDeps(db, clients);
  const candidates = selectCandidates(db, today);
  for (const cand of candidates) {
    await processCandidate(db, clients.qbt, deps, cand);
  }
  return candidates.length;
}

/**
 * «Искать сейчас» для одного тайтла: игнорирует рейт-лимит, всегда ищет.
 * Возвращает true, если тайтл существует и отслеживается.
 */
export async function runOneTitle(db: Db, titleId: number, clients: TickClients): Promise<boolean> {
  const title = getTitle(db, titleId);
  if (!title || title.tracked !== 1) return false;
  const today = new Date().toISOString().slice(0, 10);
  const candidates = selectCandidates(db, today, { rateLimitMinutes: 0 }).filter(
    (c) => c.title.id === titleId,
  );
  const deps = makeDeps(db, clients);
  for (const cand of candidates) {
    await processCandidate(db, clients.qbt, deps, cand);
  }
  return true;
}
