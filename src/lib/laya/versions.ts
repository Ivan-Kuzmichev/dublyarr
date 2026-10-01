import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { desc, eq, not, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { layaExamples, layaVersions, type LayaAdapterSet } from '../db/schema';
import { getSchedule, inNightWindow } from '../schedule';
import { layaClient, type LayaClient, type Question } from './client';
import { layaHealthInfo, metrics, splitHoldout, trainAdapter, type TrainRow } from './adapter';
import { getLayaSettings, LAYA_TASKS, type LayaTaskId } from './settings';
import { exampleStats } from './examples';

// Версии адаптеров: ночное обучение при 30+ новых примерах, «только если не хуже», 3 последние + базовая, откат.

export const NEW_EXAMPLES = 30;
const MIN_PER_TASK = 10;
const KEEP = 3;
const CHOICE: LayaTaskId[] = ['studio', 'anime'];

type Example = typeof layaExamples.$inferSelect;

/** Пример → строка обучения: «да/нет» — ответ пользователя; «выбор» — угадала ли Laya (калибруем её уверенность). */
function toRow(task: LayaTaskId, e: Example, model: string): TrainRow | null {
  // ответы другой модели для адаптера не годятся (старые примеры без отметки — считаем текущей)
  if (!e.laya || (e.laya.model && e.laya.model !== model)) return null;
  const label = CHOICE.includes(task) ? e.laya.answer === e.label : e.label === true;
  return { id: e.id, pLaya: e.laya.raw, features: e.input.features ?? [], label };
}

function currentRow(db: Db) {
  return db.select().from(layaVersions).where(eq(layaVersions.current, true)).get();
}

/** Текущая версия не подходит к работающей Laya (обновились библиотека или модель) — нужно переобучение на всех примерах. */
export function needsRetrain(db: Db): boolean {
  const cur = currentRow(db);
  const h = layaHealthInfo(db);
  return !!cur && !!h.laya && (cur.laya !== h.laya || cur.model !== h.model);
}

/** Пора ли ночное обучение: в ночном окне «Расписания» и (30+ новых примеров или несовместимая версия). */
export function trainingDue(db: Db, now: Date): boolean {
  const s = getSchedule(db);
  if (!inNightWindow(now, s.nightFrom, s.nightTo)) return false;
  return needsRetrain(db) || exampleStats(db).sinceVersion >= NEW_EXAMPLES;
}

const ASK_PER_RUN = 50; // ~1 с на вопрос на NAS

/** Примеры без ответа текущей модели (пользователь ответил раньше, чем Laya спросила; модель обновилась) — спросить сейчас. */
async function fillMissing(db: Db, client: LayaClient, model: string, retrain: boolean) {
  let asked = 0;
  for (const e of db.select().from(layaExamples).all()) {
    if (asked >= ASK_PER_RUN) break;
    if (e.laya && !(retrain && e.laya.model !== model)) continue;
    asked++;
    const r = await client.ask(e.input.state, { q: e.input.question as Question });
    const a = r?.answers.q;
    if (!a) continue;
    const answer = typeof a.noul === 'number' ? a.noul >= 0.5 : a.choice!;
    const raw = typeof a.noul === 'number' ? a.noul : (a.probabilities?.[a.choice!] ?? 0);
    db.update(layaExamples).set({ laya: { answer, p: raw, raw, model } }).where(eq(layaExamples.id, e.id)).run();
  }
}

export async function trainVersion(db: Db, dataDir: string, o: { now?: number; force?: boolean; client?: LayaClient } = {}): Promise<{ applied: boolean; version?: number; reason: string }> {
  const now = o.now ?? Date.now();
  const h = layaHealthInfo(db);
  if (!h.laya || !h.model) return { applied: false, reason: 'Laya недоступна' };
  const retrain = needsRetrain(db);
  const cur = retrain ? undefined : currentRow(db);
  const since = exampleStats(db).sinceVersion;
  if (!o.force && !retrain && since < NEW_EXAMPLES) return { applied: false, reason: `Мало новых примеров: ${since} из ${NEW_EXAMPLES}` };
  await fillMissing(db, o.client ?? layaClient(), h.model, retrain);

  const threshold = getLayaSettings(db).threshold;
  const all = db.select().from(layaExamples).all();
  const adapters: LayaAdapterSet = {};
  const m: Record<string, { accuracy: number; logLoss: number; auto: number; n: number }> = {};
  let lossNext = 0;
  let lossCur = 0;
  let trained = 0;
  for (const task of LAYA_TASKS) {
    const rows = all.filter((e) => e.task === task).map((e) => toRow(task, e, h.model!)).filter((r): r is TrainRow => !!r);
    if (rows.length < MIN_PER_TASK) continue;
    const { train, test } = splitHoldout(rows);
    const next = trainAdapter(train);
    const mNext = metrics(next, test, threshold);
    const mCur = metrics(cur?.adapters[task] ?? null, test, threshold);
    lossNext += mNext.logLoss * mNext.n;
    lossCur += mCur.logLoss * mCur.n;
    adapters[task] = next;
    m[task] = { ...mNext, n: rows.length };
    trained++;
  }
  if (!trained) return { applied: false, reason: 'Мало примеров для обучения' };
  if (lossNext > lossCur + 1e-9) return { applied: false, reason: 'Новая версия хуже на проверке' };

  const number = (db.select().from(layaVersions).orderBy(desc(layaVersions.number)).get()?.number ?? 0) + 1;
  const dir = path.join(dataDir, 'versions', String(number));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'adapters.json'), JSON.stringify({ number, laya: h.laya, model: h.model, adapters, metrics: m }, null, 2));
  db.transaction((tx) => {
    tx.update(layaVersions).set({ current: false }).run();
    tx.insert(layaVersions).values({ number, createdAt: now, examples: all.length, laya: h.laya!, model: h.model!, current: true, adapters, metrics: m }).run();
  });
  // хранить 3 последние
  const keep = db.select({ n: layaVersions.number }).from(layaVersions).orderBy(desc(layaVersions.number)).limit(KEEP).all().map((x) => x.n);
  for (const old of db.select().from(layaVersions).where(not(inArray(layaVersions.number, keep))).all()) {
    rmSync(path.join(dataDir, 'versions', String(old.number)), { recursive: true, force: true });
    db.delete(layaVersions).where(eq(layaVersions.id, old.id)).run();
  }
  return { applied: true, version: number, reason: `Версия ${number}` };
}

/** Откат: на одну из хранимых версий или на базовую модель без адаптеров. */
export function rollback(db: Db, _dataDir: string, version: number | 'base') {
  db.transaction((tx) => {
    tx.update(layaVersions).set({ current: false }).run();
    if (version !== 'base') tx.update(layaVersions).set({ current: true }).where(eq(layaVersions.number, version)).run();
  });
}
