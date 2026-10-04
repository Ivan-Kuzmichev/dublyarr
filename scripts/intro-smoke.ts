// Проверка разметки настоящими ffmpeg/mkvpropedit (внутри образа): node dist/intro-smoke.cjs <медиатека>
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { readdirSync } from 'node:fs';
import { getDb } from '../src/lib/db/client';
import { episodeFiles, titles } from '../src/lib/db/schema';
import { processSeason } from '../src/lib/intros/run';
import { systemIntroTools } from '../src/lib/intros/tools';

const [media] = process.argv.slice(2);
const fail = (m: string) => {
  console.error(`intro smoke: FAIL — ${m}`);
  process.exit(1);
};

async function main() {
  if (!(await systemIntroTools.available())) fail('нет ffmpeg chromaprint или mkvpropedit');
  const db = getDb();
  const t = db.insert(titles).values({ tmdbId: 1, kind: 'series', nameRu: 'Show', nameOriginal: 'Show', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  const dir = 'Сериал (2020)/Season 01'; // кириллица в пути — как в настоящей медиатеке
  readdirSync(path.join(media, dir)).sort().forEach((f, i) =>
    db.insert(episodeFiles).values({ titleId: t.id, season: 1, number: i + 1, path: `${dir}/${f}`, size: 1, method: 'hardlink', importedAt: i, processed: true }).run(),
  );
  const r = await processSeason(db, systemIntroTools, { media, cacheDir: path.join(process.env.DATA_DIR!, 'fp'), now: Date.now() });
  const rows = db.select().from(episodeFiles).all();
  console.log(JSON.stringify({ r, rows: rows.map((x) => [x.number, x.introState, x.introNote, x.introStart, x.introEnd]) }));
  const expected = [20, 45, 70];
  rows.forEach((x, i) => {
    if (x.introState !== 'marked') fail(`серия ${x.number}: ${x.introState} (${x.introNote})`);
    if (Math.abs(x.introStart! / 1000 - expected[i]) > 1.5) fail(`серия ${x.number}: начало ${x.introStart} вместо ${expected[i]} с`);
  });
  const ch = execFileSync('ffprobe', ['-v', 'error', '-show_chapters', '-of', 'compact=p=0', path.join(media, rows[0].path)]).toString();
  if (!ch.includes('title=Intro')) fail(`главы не вписаны: ${ch}`);
  if (!ch.includes('title=Серия')) fail(`кириллица в главах побита: ${ch}`);
  console.log('intro smoke: OK');
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
