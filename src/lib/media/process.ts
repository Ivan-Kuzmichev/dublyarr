import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { parseProbe, type Probe } from './probe';
import { planTracks, type External, type ProcessingSettings, type TrackPlan } from './tracks';
import { mkvmergeArgs } from './mkvmerge';
import { wrongEpisode } from './checks';
import type { Runner } from './runner';

// Обработка серии при импорте: ffprobe → «та ли серия» → выбор дорожек → mkvmerge во временный файл в медиатеке.

export class WrongEpisodeError extends Error {}

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
}): Promise<ProcessResult> {
  const avail = await o.runner.available();
  if (!avail.ffprobe) return { kind: 'link', probe: null };
  const probe = parseProbe(await o.runner.probe(o.src));
  const wrong = wrongEpisode(probe.duration, o.runtime);
  if (wrong) throw new WrongEpisodeError(wrong);
  const plan = planTracks(probe, { wanted: o.wanted, backups: o.backups, originalLang: o.originalLang, studios: o.studios, settings: o.settings, external: o.external });
  if (!avail.mkvmerge || !plan.changed) return { kind: 'link', probe };
  const tmp = path.join(o.targetDir, `.dy-${randomBytes(4).toString('hex')}.tmp.mkv`);
  const r = await o.runner.mkvmerge(mkvmergeArgs(o.src, tmp, plan));
  if (r.code >= 2) {
    await rm(tmp, { force: true });
    const last = r.output.split('\n').filter(Boolean).at(-1) ?? 'ошибка';
    throw new Error(`mkvmerge: ${last}`);
  }
  return { kind: 'remux', tmp, plan, probe };
}
