import { randomBytes } from 'node:crypto';
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { parseProbe, type Probe } from './probe';
import { planTracks, type External, type ProcessingSettings, type TrackPlan } from './tracks';
import { mkvmergeArgs } from './mkvmerge';
import { wrongEpisode, wrongMovie } from './checks';
import type { Runner } from './runner';

// Обработка серии при импорте: ffprobe → «та ли серия» → выбор дорожек → mkvmerge во временный файл в медиатеке.

export class WrongEpisodeError extends Error {}
/** Пересборка отложена до следующего прохода синхронизации (за проход — одна, чтобы не держать воркер). */
export class RemuxDeferred extends Error {}

/** Временные файлы пересборки — в скрытой папке медиатеки (VidHub их не видит), чистятся при старте воркера. */
export const TMP_DIR = '.dublyarr-tmp';
export async function cleanRemuxTmp(media: string) {
  const dir = path.join(media, TMP_DIR);
  for (const f of await readdir(dir).catch(() => [])) await rm(path.join(dir, f), { force: true, recursive: true });
}

export type ProcessResult = { kind: 'link'; probe: Probe | null } | { kind: 'remux'; tmp: string; plan: TrackPlan; probe: Probe };

export async function processEpisode(o: {
  runner: Runner;
  src: string;
  targetDir: string;
  settings: ProcessingSettings;
  runtime: number | null;
  wanted: number[];
  backups: number[];
  originalLang: string | null;
  studios: { id: number; name: string; aliases: string[] }[];
  external: External[];
  episodesInFile?: number;
  /** фильм: длительность сверяется с фильмом */
  movie?: boolean;
  /** false — пересборку в этот проход не делать (отложить) */
  allowRemux?: boolean;
}): Promise<ProcessResult> {
  const avail = await o.runner.available();
  if (!avail.ffprobe) return { kind: 'link', probe: null };
  const probe = parseProbe(await o.runner.probe(o.src));
  const wrong = o.movie ? wrongMovie(probe.duration, o.runtime) : wrongEpisode(probe.duration, o.runtime, o.episodesInFile ?? 1);
  if (wrong) throw new WrongEpisodeError(wrong);
  const plan = planTracks(probe, { wanted: o.wanted, backups: o.backups, originalLang: o.originalLang, studios: o.studios, settings: o.settings, external: o.external });
  // пока пересобираем только mkv: номера дорожек mkvmerge для других контейнеров не проверены
  if (!avail.mkvmerge || !plan.changed || probe.container !== 'matroska') return { kind: 'link', probe };
  if (o.allowRemux === false) throw new RemuxDeferred('пересборка в следующий проход');
  await mkdir(path.join(o.targetDir, TMP_DIR), { recursive: true });
  const tmp = path.join(o.targetDir, TMP_DIR, `.dy-${randomBytes(4).toString('hex')}.tmp.mkv`);
  const r = await o.runner.mkvmerge(mkvmergeArgs(o.src, tmp, plan));
  if (r.code >= 2) {
    await rm(tmp, { force: true });
    const last = r.output.split('\n').filter(Boolean).at(-1) ?? 'ошибка';
    throw new Error(`mkvmerge: ${last}`);
  }
  return { kind: 'remux', tmp, plan, probe };
}
