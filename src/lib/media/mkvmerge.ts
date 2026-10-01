import type { TrackPlan } from './tracks';

// Аргументы mkvmerge: без перекодирования — только выбор, порядок и флаги дорожек; внешние файлы — отдельными входами.
// Номера дорожек mkvmerge — ffprobe-индексы видео/аудио/субтитров (вложения в mkvmerge идут отдельно).

export function mkvmergeArgs(src: string, out: string, plan: TrackPlan): string[] {
  const args = ['-o', out, '--audio-tracks', plan.audio.join(',')];
  args.push(...(plan.subs.length ? ['--subtitle-tracks', plan.subs.join(',')] : ['--no-subtitles']));
  if (!plan.untouchedAudio) for (const a of plan.audio) args.push('--default-track-flag', `${a}:${a === plan.defaults.audio ? 1 : 0}`);
  for (const s of plan.subs) args.push('--default-track-flag', `${s}:${s === plan.defaults.sub ? 1 : 0}`);
  args.push('--track-order', [...plan.order.map((t) => `0:${t}`), ...plan.external.map((_, i) => `${i + 1}:0`)].join(','));
  args.push(src);
  for (const e of plan.external) {
    if (e.language) args.push('--language', `0:${e.language}`);
    if (e.title) args.push('--track-name', `0:${e.title}`);
    args.push('--default-track-flag', '0:0', e.path);
  }
  return args;
}
