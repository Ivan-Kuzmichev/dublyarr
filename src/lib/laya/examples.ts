import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { layaAnswers, layaExamples, layaVersions, type Release, type Title } from '../db/schema';
import type { LayaTask } from './decide';

// Размеченные примеры для дообучения: ответ пользователя на тот же вопрос, что видела (или увидела бы) Laya.

export type ExampleSource = 'match-answer' | 'studio-assign' | 'studio-confirm' | 'telegram' | 'final-reject' | 'correction';

export function addExample(
  db: Db,
  e: { task: LayaTask; key: string; input: { state: unknown; question: unknown; features: number[] }; label: string | boolean; laya?: { answer: string | boolean; p: number; raw: number; model?: string } | null; source: ExampleSource; title?: string; now?: number },
) {
  const row = { task: e.task, key: e.key, input: e.input, label: e.label, laya: e.laya ?? null, source: e.source, title: e.title ?? '', createdAt: e.now ?? Date.now() };
  // один пример на вопрос: последний ответ пользователя побеждает
  db.insert(layaExamples).values(row).onConflictDoUpdate({ target: [layaExamples.task, layaExamples.key], set: row }).run();
}

/** Последний ответ Laya на этот вопрос (любая версия адаптеров) — кладётся рядом с примером. */
export function lastLayaAnswer(db: Db, task: LayaTask, key: string) {
  const a = db.select().from(layaAnswers).where(and(eq(layaAnswers.task, task), eq(layaAnswers.key, key))).orderBy(desc(layaAnswers.at), desc(layaAnswers.id)).get();
  return a ? { row: a, laya: { answer: a.answer, p: a.p, raw: a.raw, model: a.model || undefined } } : null;
}

/**
 * Ответ пользователя по раздаче, которую отклонила финальная проверка: скачал вручную — «да», «Не тот сериал» — «нет».
 * Пример — для каждого вопроса финальной проверки об этой раздаче.
 */
export function markFinalAnswer(db: Db, t: Pick<Title, 'tmdbType' | 'tmdbId'>, r: Pick<Release, 'trackerName' | 'title' | 'size'>, ok: boolean, now = Date.now()) {
  const prefix = `final|${t.tmdbType}:${t.tmdbId}|`;
  const suffix = `|${r.trackerName}|${r.title}|${r.size}`;
  const asked = db.select().from(layaAnswers).where(eq(layaAnswers.task, 'final')).all().filter((a) => a.key.startsWith(prefix) && a.key.endsWith(suffix) && a.input);
  for (const a of asked) addExample(db, { task: 'final', key: a.key, input: a.input!, label: ok, laya: { answer: a.answer, p: a.p, raw: a.raw, model: a.model || undefined }, source: 'correction', title: r.title, now });
}

/** Сколько примеров: всего, по задачам и новых с текущей версии адаптеров. */
export function exampleStats(db: Db) {
  const rows = db.select({ task: layaExamples.task, at: layaExamples.createdAt }).from(layaExamples).all();
  const current = db.select().from(layaVersions).where(eq(layaVersions.current, true)).get();
  const byTask = { studio: 0, match: 0, anime: 0, final: 0 } as Record<LayaTask, number>;
  for (const r of rows) if (r.task in byTask) byTask[r.task as LayaTask]++;
  return { total: rows.length, byTask, sinceVersion: rows.filter((r) => r.at > (current?.createdAt ?? 0)).length };
}
