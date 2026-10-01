import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { layaAnswers } from '../db/schema';
import { layaClient, type LayaClient, type Question } from './client';
import { applyAdapter, currentAdapters } from './adapter';
import { getLayaSettings, type LayaTaskId } from './settings';

// Решение Laya: вопрос → адаптер → порог. Laya выключена/недоступна, бюджет кончился — решают правила (by: 'rules').

export type LayaTask = LayaTaskId;
export type Budget = { left: number }; // вопросов к Laya на проход поиска одного сериала
export const SEARCH_BUDGET = 20;
export type Decision<T> = { by: 'laya'; answer: T; p: number; raw: number; sure: boolean } | { by: 'rules' };
export type DecideInput = { key: string; state: unknown; question: Question; features: number[] };

export async function decide<T extends string | boolean>(db: Db, task: LayaTask, input: DecideInput, o: { budget: Budget; client?: LayaClient; now?: number }): Promise<Decision<T>> {
  const settings = getLayaSettings(db);
  if (!settings.tasks[task]) return { by: 'rules' };
  const { version, adapters } = currentAdapters(db);
  const sure = (p: number, answer: string | boolean) => (typeof answer === 'boolean' ? Math.max(p, 1 - p) : p) >= settings.threshold;
  const cached = db
    .select()
    .from(layaAnswers)
    .where(and(eq(layaAnswers.task, task), eq(layaAnswers.key, input.key), eq(layaAnswers.version, version)))
    .get();
  if (cached) return { by: 'laya', answer: cached.answer as T, p: cached.p, raw: cached.raw, sure: sure(cached.p, cached.answer) };
  if (o.budget.left <= 0) return { by: 'rules' };
  o.budget.left--;
  const r = await (o.client ?? layaClient()).ask(input.state, { q: input.question });
  if (!r) return { by: 'rules' };
  const a = r.answers.q;
  const adapter = adapters[task] ?? null;
  let answer: string | boolean;
  let raw: number;
  let p: number;
  if (input.question.type === 'noul') {
    raw = a.noul!;
    p = applyAdapter(adapter, raw, input.features);
    answer = p >= 0.5;
  } else {
    answer = a.choice!;
    raw = a.probabilities?.[a.choice!] ?? 0;
    p = applyAdapter(adapter, raw, input.features);
  }
  db.insert(layaAnswers)
    .values({ task, key: input.key, version, answer, p, raw, input: { state: input.state, question: input.question, features: input.features }, at: o.now ?? Date.now() })
    .onConflictDoUpdate({ target: [layaAnswers.task, layaAnswers.key, layaAnswers.version], set: { answer, p, raw } })
    .run();
  return { by: 'laya', answer: answer as T, p, raw, sure: sure(p, answer) };
}

/** Уже известный ответ (кэш) без запроса к Laya — для синхронного переразбора раздач. */
export function cachedDecision<T extends string | boolean>(db: Db, task: LayaTask, key: string): Decision<T> | null {
  const settings = getLayaSettings(db);
  if (!settings.tasks[task]) return null;
  const { version } = currentAdapters(db);
  const c = db
    .select()
    .from(layaAnswers)
    .where(and(eq(layaAnswers.task, task), eq(layaAnswers.key, key), eq(layaAnswers.version, version)))
    .get();
  if (!c) return null;
  const sure = (typeof c.answer === 'boolean' ? Math.max(c.p, 1 - c.p) : c.p) >= settings.threshold;
  return { by: 'laya', answer: c.answer as T, p: c.p, raw: c.raw, sure };
}
