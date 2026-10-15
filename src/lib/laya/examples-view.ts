import { desc } from 'drizzle-orm';
import type { Db } from '../db/client';
import { layaExamples } from '../db/schema';
import { LAYA_TASKS, type LayaTaskId } from './settings';

// Данные экрана «Настройки → AI → Примеры»: ответы пользователя, на которых головы Laya дообучаются на компьютере (laya-train/).

const TASK: Record<LayaTaskId, { name: string; question: string }> = {
  studio: { name: 'Какая студия', question: 'Какая студия?' },
  match: { name: 'Тот ли это сериал', question: 'Тот ли это сериал?' },
  anime: { name: 'Нумерация аниме', question: 'Какая это серия?' },
  final: { name: 'Финальная проверка', question: 'Это нужная раздача?' },
};
const SHOWN = 50;
const pct = (x: number) => `${Math.round(x * 100)} %`;
const fmt = (v: string | boolean) => (v === true ? 'да' : v === false ? 'нет' : v);

export function examplesData(db: Db, o: { wrong?: boolean } = {}) {
  const all = db
    .select()
    .from(layaExamples)
    .orderBy(desc(layaExamples.createdAt), desc(layaExamples.id))
    .all()
    .map((e) => ({ ...e, wrong: !!e.laya && e.laya.answer !== e.label }));
  const tasks = LAYA_TASKS.map((task) => {
    const mine = all.filter((e) => e.task === task);
    return { task, name: TASK[task].name, n: mine.length, wrong: mine.filter((e) => e.wrong).length };
  });
  const examples = (o.wrong ? all.filter((e) => e.wrong) : all).slice(0, SHOWN).map((e) => ({
    id: e.id,
    title: e.title,
    question: TASK[e.task as LayaTaskId]?.question ?? e.task,
    model: e.laya ? `${fmt(e.laya.answer)} · ${pct(typeof e.laya.answer === 'boolean' && e.laya.answer === false ? 1 - e.laya.p : e.laya.p)}` : '—',
    you: String(fmt(e.label)),
    wrong: e.wrong,
  }));
  return { total: all.length, wrongTotal: all.filter((e) => e.wrong).length, tasks, examples };
}
