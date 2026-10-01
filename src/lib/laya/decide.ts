import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { layaAnswers, layaExamples } from '../db/schema';
import { layaClient, type LayaClient, type Question } from './client';
import { applyAdapter, currentAdapters, layaHealthInfo } from './adapter';
import { getLayaSettings, type LayaTaskId } from './settings';
import { beat } from '../heartbeat';

// Решение Laya: ответ пользователя (пример) → ответ модели (кэш или вопрос) → адаптер → порог.
// Laya выключена/недоступна — решают правила ('rules'); кончился бюджет вопросов — 'budget' (решить позже).

export type LayaTask = LayaTaskId;
export type Budget = { left: number }; // вопросов к Laya на проход поиска одного сериала
export const SEARCH_BUDGET = 10;
export const FINAL_BUDGET = 10;
export type Decision<T> = { by: 'laya'; answer: T; p: number; raw: number; sure: boolean; user?: true } | { by: 'rules' } | { by: 'budget' };
export type DecideInput = { key: string; state: unknown; question: Question; features: number[] };

/** Пользователь уже ответил на этот вопрос — его ответ окончательный (Laya не переспрашивается). */
function userDecision<T>(db: Db, task: LayaTask, key: string): Decision<T> | null {
  const e = db.select().from(layaExamples).where(and(eq(layaExamples.task, task), eq(layaExamples.key, key))).get();
  if (!e) return null;
  const p = typeof e.label === 'boolean' ? (e.label ? 1 : 0) : 1;
  return { by: 'laya', answer: e.label as T, p, raw: p, sure: true, user: true };
}

/** Ответ модели → вероятность после адаптера текущей версии → уверенность по порогу. */
function fromRaw<T>(db: Db, task: LayaTask, answer: string | boolean, raw: number, features: number[]): Decision<T> {
  const { threshold } = getLayaSettings(db);
  const p = applyAdapter(currentAdapters(db).adapters[task] ?? null, raw, features);
  const a = typeof answer === 'boolean' ? p >= 0.5 : answer;
  return { by: 'laya', answer: a as T, p, raw, sure: (typeof a === 'boolean' ? Math.max(p, 1 - p) : p) >= threshold };
}

const cachedRaw = (db: Db, task: LayaTask, key: string) =>
  db
    .select()
    .from(layaAnswers)
    .where(and(eq(layaAnswers.task, task), eq(layaAnswers.key, key), eq(layaAnswers.model, layaHealthInfo(db).model ?? '')))
    .get();

export async function decide<T extends string | boolean>(db: Db, task: LayaTask, input: DecideInput, o: { budget: Budget; client?: LayaClient; now?: number }): Promise<Decision<T>> {
  if (!getLayaSettings(db).tasks[task]) return { by: 'rules' };
  const user = userDecision<T>(db, task, input.key);
  if (user) return user;
  const cached = cachedRaw(db, task, input.key);
  if (cached) return fromRaw<T>(db, task, cached.answer, cached.raw, input.features);
  if (o.budget.left <= 0) return { by: 'budget' };
  o.budget.left--;
  const r = await (o.client ?? layaClient()).ask(input.state, { q: input.question });
  // долгий проход с вопросами к Laya — воркер жив (иначе «Воркер не отвечает»)
  if (process.env.DUBLYARR_PROCESS === 'worker') beat(db, 'worker', true);
  if (!r) return { by: 'rules' };
  const a = r.answers.q;
  const raw = input.question.type === 'noul' ? a.noul! : (a.probabilities?.[a.choice!] ?? 0);
  const answer = input.question.type === 'noul' ? raw >= 0.5 : a.choice!;
  const row = { task, key: input.key, version: 0, model: layaHealthInfo(db).model ?? '', answer, p: raw, raw, input: { state: input.state, question: input.question, features: input.features }, at: o.now ?? Date.now() };
  db.insert(layaAnswers).values(row).onConflictDoUpdate({ target: [layaAnswers.task, layaAnswers.key, layaAnswers.model], set: row }).run();
  return fromRaw<T>(db, task, answer, raw, input.features);
}

/** Уже известное решение (ответ пользователя или кэш модели) без запроса — для синхронного переразбора раздач. */
export function cachedDecision<T extends string | boolean>(db: Db, task: LayaTask, key: string, features: number[] = []): Decision<T> | null {
  if (!getLayaSettings(db).tasks[task]) return null;
  const user = userDecision<T>(db, task, key);
  if (user) return user;
  const c = cachedRaw(db, task, key);
  return c ? fromRaw<T>(db, task, c.answer, c.raw, c.input?.features ?? features) : null;
}
