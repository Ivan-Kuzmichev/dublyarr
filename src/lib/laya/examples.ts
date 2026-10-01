import type { Db } from '../db/client';
import { layaExamples } from '../db/schema';
import type { LayaTask } from './decide';

// Размеченные примеры для дообучения: ответ пользователя на тот же вопрос, что видела (или увидела бы) Laya.

export type ExampleSource = 'match-answer' | 'studio-assign' | 'studio-confirm' | 'telegram' | 'final-reject' | 'correction';

export function addExample(
  db: Db,
  e: { task: LayaTask; key: string; input: { state: unknown; question: unknown; features: number[] }; label: string | boolean; laya?: { answer: string | boolean; p: number; raw: number } | null; source: ExampleSource; title?: string; now?: number },
) {
  const row = { task: e.task, key: e.key, input: e.input, label: e.label, laya: e.laya ?? null, source: e.source, title: e.title ?? '', createdAt: e.now ?? Date.now() };
  // один пример на вопрос: последний ответ пользователя побеждает
  db.insert(layaExamples).values(row).onConflictDoUpdate({ target: [layaExamples.task, layaExamples.key], set: row }).run();
}
