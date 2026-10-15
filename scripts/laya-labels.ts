// Ручная разметка для дообучения голов Laya (laya-train/labels/*.json) → строки набора в формате боевых вопросов Dublyarr.
//   pnpm laya:labels  →  laya-train/data/labeled.json
// В группе: сериалы TMDB и раздачи с отметкой, к какому сериалу раздача относится ('' — ни к какому).
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { migrateDb, openDb } from '../src/lib/db/client';
import { titles, studios as studiosTable, type Release, type Title } from '../src/lib/db/schema';
import { seedStudios, listStudios } from '../src/lib/studios';
import { parseRelease } from '../src/lib/parse/dubs';
import { matchInput, studioInput } from '../src/lib/laya/review';
import { finalInput } from '../src/lib/laya/final';
import type { DatasetRow } from '../src/lib/laya/dataset';

type Group = { titles: Record<string, [string, string, number, ('series' | 'anime' | 'movie')?]>; releases: [string, string, string][] };

const DIR = path.resolve('laya-train/labels');
const OUT = path.resolve('laya-train/data/labeled.json');
const hash = (s: string) => createHash('sha1').update(s).digest('hex');
const pad = (n: number) => String(n).padStart(2, '0');

/** «9,5 ГБ» → байты (как показывает трекер; formatSize вернёт ту же строку). */
function bytes(s: string): number {
  const m = /([\d,]+)\s*(ТБ|ГБ|МБ|КБ)/.exec(s);
  if (!m) return 0;
  const k = { КБ: 1024, МБ: 1024 ** 2, ГБ: 1024 ** 3, ТБ: 1024 ** 4 }[m[2] as 'ГБ'];
  return Math.round(Number(m[1].replace(',', '.')) * k);
}
const tracker = (t: string) => (/AniLiberty/.test(t) ? 'Anilibria' : / - RUSSIAN…?$/.test(t) ? 'Kinozal' : /^\S.*\(Lost[Ff]ilm\)$/.test(t) || / - rus /.test(t) ? 'LostFilm.tv' : /Полный S\d|\(Обновляемая\)/.test(t) ? 'RUDUB' : /\[RUS\] \[HDTV/.test(t) ? 'AniDUB' : 'RuTracker.org');

const db = openDb(':memory:');
migrateDb(db);
seedStudios(db);
const refs = listStudios(db).map((s) => ({ id: s.id, name: s.name, aliases: s.aliases, trackers: s.trackers }));
const studioNames = listStudios(db).map((s) => s.name);

const rows: DatasetRow[] = [];
let tmdb = 1;
const groups: Group[] = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .flatMap((f) => JSON.parse(readFileSync(path.join(DIR, f), 'utf8')) as Group[]);
const allTitles: { key: string; t: Title; gi: number }[] = [];
groups.forEach((g, gi) => {
  for (const [key, [ru, orig, year, kind]] of Object.entries(g.titles)) {
    const t = db
      .insert(titles)
      .values({ tmdbId: tmdb++, tmdbType: kind === 'movie' ? 'movie' : 'tv', kind: kind ?? 'series', nameRu: ru, nameOriginal: orig, originalLanguage: 'xx', year, status: 'ended', createdAt: 1, refreshedAt: 1 })
      .returning()
      .get();
    allTitles.push({ key: `${gi}:${key}`, t, gi });
  }
});
const groupOf = (t: Title) => `${t.tmdbType}:${t.tmdbId}`;

groups.forEach((g, gi) => {
  const mine = allTitles.filter((x) => x.gi === gi);
  const others = allTitles.filter((x) => x.gi !== gi && x.t.kind !== 'movie');
  for (const [title, size, owner] of g.releases) {
    const trackerName = tracker(title);
    const parsed = parseRelease(title, {}, { id: trackerName.toLowerCase(), name: trackerName }, refs);
    const r = { id: 0, titleId: 0, trackerName, title, size: bytes(size), parsed, match: { score: 0, level: 'doubt', reasons: [] } } as unknown as Release;
    // «тот ли сериал»: к каждому сериалу группы + к одному чужому (явное «нет»)
    for (const x of mine) {
      const m = matchInput(x.t, r);
      rows.push({ task: 'match', group: groupOf(x.t), source: 'user', state: m.state, question: m.question, target: owner === x.key.split(':')[1] });
    }
    const stranger = others.sort((a, b) => hash(title + a.key).localeCompare(hash(title + b.key)))[0];
    if (stranger) {
      const m = matchInput(stranger.t, r);
      rows.push({ task: 'match', group: groupOf(stranger.t), source: 'pair', state: m.state, question: m.question, target: false });
    }
    const own = mine.find((x) => x.key.split(':')[1] === owner)?.t;
    // «какая студия»: подписи из заголовка — студия словаря или «новая»
    for (const d of parsed.dubs) {
      if (d.by !== 'title' || !d.label || /^(?:DUB|MVO|DVO|VO|AVO)$/i.test(d.label)) continue;
      const q = studioInput(db, own ?? mine[0].t, r, d.label);
      const target = d.studioId === null ? 'новая' : (listStudios(db).find((s) => s.id === d.studioId)?.name ?? 'новая');
      if (!(q.question as { criteria: Record<string, string> }).criteria[target]) continue;
      rows.push({ task: 'studio', group: `studio:${d.label.toLowerCase()}`, source: 'user', state: q.state, question: q.question, target });
    }
    // финальная проверка: серия из раздачи нужного сериала, в студии из заголовка — «да»; чужая студия или чужой сезон — «нет»
    // сквозная нумерация вместо сезона (S1E1-134) — вопрос «серия 67 сезона 1» был бы бессмыслицей
    if (!own || own.kind === 'movie' || !parsed.seasons.length || (parsed.episodes && parsed.episodes.to > 30)) continue;
    const named = parsed.dubs.filter((d) => d.by === 'title' && d.studioId !== null).map((d) => listStudios(db).find((s) => s.id === d.studioId)!.name);
    if (!named.length) continue;
    const season = parsed.seasons[0];
    const ep = parsed.episodes ? parsed.episodes.from + Math.floor((parsed.episodes.to - parsed.episodes.from) / 2) : 1;
    const ask = (s: number, n: number, dub: string, target: boolean) => {
      const f = finalInput({ title: own, code: parsed.pack ? `S${pad(s)}` : `S${pad(s)}E${pad(n)}`, what: `серия ${n} сезона ${s}`, dub }, r);
      rows.push({ task: 'final', group: groupOf(own), source: 'user', state: f.state, question: f.question, target });
    };
    ask(season, ep, named[0], true);
    const wrongDub = studioNames.filter((n) => !named.includes(n)).sort((a, b) => hash(title + a).localeCompare(hash(title + b)))[0];
    // обрезанный заголовок («…») мог спрятать эту студию — «нет» только для полного списка
    if (wrongDub && !title.endsWith('…')) ask(season, ep, wrongDub, false);
    if (parsed.seasons.length === 1 && !parsed.absolute) ask(season + 3, 1, named[0], false);
  }
});

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ rows }));
const by = (task: string) => rows.filter((r) => r.task === task);
console.log(`строк: ${rows.length} · match ${by('match').length} (да ${by('match').filter((r) => r.target === true).length}) · final ${by('final').length} · studio ${by('studio').length}`);
void studiosTable;
