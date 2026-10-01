import { desc } from 'drizzle-orm';
import type { Db } from '../db/client';
import { layaExamples, layaVersions } from '../db/schema';
import { getSetting } from '../settings';
import { exampleStats } from './examples';
import { LAYA_TASKS, type LayaTaskId } from './settings';

// Данные экрана «Дообучение» (AiTraining.dc.html).

const TASK: Record<LayaTaskId, { name: string; note: string; question: string }> = {
  studio: { name: 'Какая студия', note: 'новые и странные названия озвучек', question: 'Какая студия?' },
  match: { name: 'Тот ли это сериал', note: 'похожие названия, ремейки, фильмы', question: 'Тот ли это сериал?' },
  anime: { name: 'Нумерация аниме', note: 'сквозные номера серий', question: 'Какая это серия?' },
  final: { name: 'Финальная проверка', note: 'перед загрузкой', question: 'Это нужная раздача?' },
};
const pct = (x: number) => `${Math.round(x * 100)} %`;
const fmt = (v: string | boolean) => (v === true ? 'да' : v === false ? 'нет' : v);
const dateText = (ms: number) => new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

export function trainingData(db: Db, now = Date.now()) {
  const stats = exampleStats(db);
  const versions = db.select().from(layaVersions).orderBy(desc(layaVersions.number)).all();
  const current = versions.find((v) => v.current);
  const tasks = LAYA_TASKS.map((task) => {
    const m = current?.metrics[task];
    const n = stats.byTask[task];
    return { task, name: TASK[task].name, note: n < 10 ? 'мало примеров — пока чаще спрашивает' : TASK[task].note, n, accuracy: m ? pct(m.accuracy) : '—', auto: m ? pct(m.auto) : '—', low: n < 10 };
  });
  const examples = db
    .select()
    .from(layaExamples)
    .orderBy(desc(layaExamples.createdAt), desc(layaExamples.id))
    .limit(30)
    .all()
    .map((e) => ({
      id: e.id,
      title: e.title,
      question: TASK[e.task as LayaTaskId]?.question ?? e.task,
      model: e.laya ? `${fmt(e.laya.answer)} · ${pct(typeof e.laya.answer === 'boolean' && e.laya.answer === false ? 1 - e.laya.p : e.laya.p)}` : '—',
      you: String(fmt(e.label)),
      wrong: !!e.laya && e.laya.answer !== e.label,
    }));
  const last = getSetting<{ at: number; applied: boolean; reason: string; version?: number }>(db, 'laya.lastTrain');
  return {
    tasks,
    examples,
    newCount: stats.sinceVersion,
    total: stats.total,
    versions: [
      ...versions.map((v) => ({
        id: v.number as number | 'base',
        name: `Версия ${v.number}`,
        meta: `${dateText(v.createdAt)} · ${v.examples} примеров${v.metrics.match ? ` · решает сама ${pct(v.metrics.match.auto)}` : ''}`,
        current: v.current,
        canRollback: !v.current,
      })),
      { id: 'base' as const, name: 'Базовая', meta: 'laya-multilingual без дообучения', current: !current, canRollback: !!current },
    ],
    lastTrain: last ? `Последнее обучение: ${last.applied ? `версия ${last.version}` : `не применено — ${last.reason}`}` : null,
    now,
  };
}
