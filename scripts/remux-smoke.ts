// Проверка пересборки настоящими ffprobe/mkvmerge (внутри образа Docker): node dist/remux-smoke.cjs <вход.mkv> <папка>
import { rename } from "node:fs/promises";
import path from "node:path";
import { processEpisode } from "../src/lib/media/process";
import { systemRunner } from "../src/lib/media/runner";
import { parseProbe } from "../src/lib/media/probe";
import { DEFAULT_PROCESSING } from "../src/lib/media/tracks";

const [src, dir] = process.argv.slice(2);
const fail = (msg: string) => {
  console.error(`remux smoke: FAIL — ${msg}`);
  process.exit(1);
};

async function main() {
  const avail = await systemRunner.available();
  if (!avail.ffprobe || !avail.mkvmerge)
    fail(`нет программ: ${JSON.stringify(avail)}`);
  const r = await processEpisode({
    runner: systemRunner,
    src,
    targetDir: dir,
    settings: DEFAULT_PROCESSING,
    runtime: null,
    wanted: [1],
    backups: [2],
    originalLang: "en",
    studios: [
      { id: 1, name: "HDrezka", aliases: ["HDrezka Studio"] },
      { id: 2, name: "LostFilm", aliases: [] },
    ],
    external: [],
  });
  if (r.kind !== "remux") fail(`ожидалась пересборка, получено ${r.kind}`);
  const out = path.join(dir, "out.mkv");
  await rename((r as { tmp: string }).tmp, out);
  const p = parseProbe(await systemRunner.probe(out));
  const audio = p.streams.filter((s) => s.type === "audio");
  const subs = p.streams.filter((s) => s.type === "subtitle");
  console.log(
    JSON.stringify({
      audio: audio.map((s) => [s.title, s.language, s.isDefault]),
      subs: subs.map((s) => [s.title, s.language, s.isDefault]),
    }),
  );
  if (audio.length !== 2) fail(`аудио: ${audio.length} вместо 2`);
  if (audio[0].title !== "HDrezka Studio" || !audio[0].isDefault)
    fail("первая аудиодорожка должна быть HDrezka по умолчанию");
  if (audio[1].language !== "eng" || audio[1].isDefault)
    fail("вторая — оригинал, не по умолчанию");
  if (subs.length !== 2 || !subs[0].isDefault || subs[1].isDefault)
    fail("субтитры: форсированные по умолчанию, полные — нет");
  console.log("remux smoke: OK");
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
