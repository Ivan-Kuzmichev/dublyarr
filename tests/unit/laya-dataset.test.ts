import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers';
import { buildDataset } from '@/lib/laya/dataset';
import { matchInput, studioInput, titleContext } from '@/lib/laya/review';
import { finalInput } from '@/lib/laya/final';
import { addRule } from '@/lib/release-rules';
import { addExample } from '@/lib/laya/examples';
import { downloads, releases, sources, studios, titles, type Release } from '@/lib/db/schema';
import type { ParsedRelease } from '@/lib/parse/types';

process.env.DUBLYARR_SECRET_KEY = randomBytes(32).toString('base64');

function setup() {
  const db = testDb();
  const src = db.insert(sources).values({ name: 'J', url: 'http://j', createdAt: 1 }).returning().get();
  const lf = db.insert(studios).values({ name: 'LostFilm', aliases: ['LF'], kind: 'both', source: 'manual', createdAt: 1 }).returning().get();
  const title = (tmdbId: number, nameRu: string, nameOriginal: string) =>
    db.insert(titles).values({ tmdbId, tmdbType: 'tv', kind: 'series', nameRu, nameOriginal, originalLanguage: 'en', status: 'returning', year: 2020, createdAt: 1, refreshedAt: 1 }).returning().get();
  const release = (titleId: number, name: string, o: { dub?: { id: number; label: string } } = {}) => {
    const parsed = {
      base: name.toLowerCase(),
      names: [name],
      year: null,
      seasons: [1],
      episodes: { from: 1, to: 1 },
      totalInSeason: null,
      absolute: false,
      pack: false,
      resolution: 1080,
      source: null,
      hdr: false,
      dv: false,
      screener: false,
      dubs: o.dub ? [{ kind: 'mvo', studioId: o.dub.id, label: o.dub.label, by: 'title' }] : [],
      original: false,
      subs: false,
    } as ParsedRelease;
    return db
      .insert(releases)
      .values({ titleId, sourceId: src.id, trackerName: 'RuTracker', title: name, size: 1_500_000_000, firstSeenAt: 1, lastSeenAt: 1, parsed, match: { score: 0.9, level: 'match', reasons: [] } })
      .returning()
      .get() as Release;
  };
  return { db, lf, title, release };
}
const by = (rows: ReturnType<typeof buildDataset>, task: string, source?: string) => rows.filter((r) => r.task === task && (!source || r.source === source));

test('ответы пользователя — как есть: вопрос, состояние и метка из примера', () => {
  const { db, title, release } = setup();
  const t = title(1, 'Тед Лассо', 'Ted Lasso');
  const r = release(t.id, 'Ted Lasso S01E01');
  const input = matchInput(t, r, titleContext(db, t));
  addExample(db, { task: 'match', key: input.key, input: { state: input.state, question: input.question, features: input.features }, label: false, source: 'match-answer', title: r.title });
  expect(by(buildDataset(db), 'match', 'user')).toEqual([{ task: 'match', group: 'tv:1', source: 'user', state: input.state, question: input.question, target: false }]);
});

test('ответ на прежний, короткий вопрос (до 2.5) — в наборе вопрос в нынешнем виде, если раздача ещё в базе', () => {
  const { db, title, release } = setup();
  const t = title(11, 'Тед Лассо', 'Ted Lasso');
  const r = release(t.id, 'Ted Lasso S01E02');
  const now = matchInput(t, r, titleContext(db, t));
  addExample(db, { task: 'match', key: now.key, input: { state: { сериал: 'Тед Лассо (Ted Lasso), 2020', раздача: r.title, размер: '1,4 ГБ' }, question: now.question, features: [0.9] }, label: true, source: 'match-answer', title: r.title });
  expect(by(buildDataset(db), 'match', 'user')).toEqual([expect.objectContaining({ state: now.state, target: true })]);
});

test('правила «это он / не тот» — метка для раздач сериала с той же основой', () => {
  const { db, title, release } = setup();
  const t = title(2, 'Тед', 'Ted');
  const r = release(t.id, 'Ted - S1 - rus 1080p WEBDL (LostFilm)');
  addRule(db, t.id, r.trackerName, r.title, 'reject');
  const rows = by(buildDataset(db), 'match', 'rule');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ target: false, state: matchInput(t, r, titleContext(db, t)).state });
});

test('скачанное: «тот сериал» — да, финальная проверка (серия, озвучка) — да', () => {
  const { db, lf, title, release } = setup();
  const t = title(3, 'Ричер', 'Reacher');
  const r = release(t.id, 'Reacher S04E05 (LostFilm)', { dub: { id: lf.id, label: 'LostFilm' } });
  db.insert(downloads).values({ hash: 'h', titleId: t.id, releaseId: r.id, season: 4, kind: 'episode', episodes: [{ season: 4, number: 5 }], state: 'imported', name: 'x', size: 1, addedAt: 1, studioLabel: 'LostFilm' }).run();
  const rows = buildDataset(db);
  expect(by(rows, 'match', 'download')).toEqual([expect.objectContaining({ target: true, group: 'tv:3' })]);
  const fin = by(rows, 'final', 'download');
  expect(fin).toHaveLength(1);
  const want = finalInput({ title: t, code: 'S04E05', what: 'серия 5 сезона 4', dub: 'LostFilm' }, r, titleContext(db, t));
  expect(fin[0]).toMatchObject({ target: true, state: want.state, question: want.question });
});

test('отрицательные пары: раздачи одного сериала, поставленные к другому, — «нет»; не больше положительных ×2', () => {
  const { db, title, release } = setup();
  const a = title(4, 'Фонари', 'Lanterns');
  title(5, 'Братья', 'Brothers'); // второй сериал — к нему подставляются раздачи «Фонарей»
  for (let i = 0; i < 3; i++) {
    const r = release(a.id, `Lanterns S01E0${i + 1}`);
    db.insert(downloads).values({ hash: `a${i}`, titleId: a.id, releaseId: r.id, season: 1, kind: 'episode', episodes: [{ season: 1, number: i + 1 }], state: 'imported', name: 'x', size: 1, addedAt: 1 }).run();
  }
  const rows = buildDataset(db);
  const pairs = by(rows, 'match', 'pair');
  expect(pairs.length).toBeGreaterThan(0);
  expect(pairs.length).toBeLessThanOrEqual(2 * by(rows, 'match').filter((r) => r.target === true).length);
  expect(pairs.every((p) => p.target === false && JSON.stringify(p.state).includes('Братья') && JSON.stringify(p.state).includes('Lanterns'))).toBe(true);
});

test('студии: подпись-вариант из словаря — выбор этой студии, вопрос как в бою', () => {
  const { db, lf, title, release } = setup();
  const t = title(6, 'Ричер', 'Reacher');
  const r = release(t.id, 'Reacher S04E01 MVO (LF)', { dub: { id: lf.id, label: 'LF' } });
  const rows = by(buildDataset(db), 'studio', 'alias');
  expect(rows).toHaveLength(1);
  const want = studioInput(db, t, r, 'LF');
  expect(rows[0]).toMatchObject({ target: 'LostFilm', state: want.state, question: want.question, group: 'tv:6' });
});

test('один сериал не перевешивает: не больше 200 строк задачи на сериал', () => {
  const { db, title, release } = setup();
  const t = title(7, 'Чёрный клевер', 'Black Clover');
  for (let i = 0; i < 300; i++) {
    const r = release(t.id, `Black Clover E${i + 1}`);
    db.insert(downloads).values({ hash: `c${i}`, titleId: t.id, releaseId: r.id, season: 1, kind: 'episode', episodes: [{ season: 1, number: i + 1 }], state: 'imported', name: 'x', size: 1, addedAt: 1 }).run();
  }
  const rows = buildDataset(db);
  expect(by(rows, 'match').filter((r) => r.group === 'tv:7').length).toBeLessThanOrEqual(200);
  expect(by(rows, 'final').filter((r) => r.group === 'tv:7').length).toBeLessThanOrEqual(200);
  // детерминированно
  expect(JSON.stringify(buildDataset(db))).toBe(JSON.stringify(rows));
});

