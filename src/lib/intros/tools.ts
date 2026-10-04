import { execFile } from 'node:child_process';
import { logger } from '../log';

// Внешние программы разметки: ffmpeg (chromaprint), ffprobe, mkvpropedit. В тестах подменяется.

export type IntroTools = {
  available(): Promise<boolean>;
  fingerprint(file: string, start: number, dur: number): Promise<Uint32Array>;
  duration(file: string): Promise<number | null>;
  chapterCount(file: string): Promise<number>;
  setChapters(file: string, chaptersFile: string): Promise<void>;
};

const log = logger('import');

function run(cmd: string, args: string[], timeout: number) {
  return new Promise<{ code: number; stdout: Buffer; stderr: string }>((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? Number((err as { code: number }).code) : -1) : 0;
      if (code !== 0) log.warn({ cmd, args: args.filter((a) => !a.startsWith('/')), code, stderr: String(stderr).slice(0, 300) }, 'intro tool failed');
      resolve({ code, stdout: stdout as Buffer, stderr: String(stderr) });
    });
  });
}

let avail: Promise<boolean> | null = null;

export const systemIntroTools: IntroTools = {
  available() {
    avail ??= Promise.all([run('ffmpeg', ['-hide_banner', '-muxers'], 10_000), run('mkvpropedit', ['--version'], 10_000)]).then(
      ([f, m]) => f.code === 0 && f.stdout.toString().includes('chromaprint') && m.code === 0,
    );
    return avail;
  },
  async fingerprint(file, start, dur) {
    const r = await run('ffmpeg', ['-v', 'error', '-ss', String(start), '-t', String(dur), '-i', file, '-vn', '-ac', '1', '-f', 'chromaprint', '-fp_format', 'raw', '-'], 10 * 60_000);
    if (r.code !== 0) throw new Error('ffmpeg: не удалось снять отпечаток');
    const b = r.stdout;
    return new Uint32Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.byteLength - (b.byteLength % 4))));
  },
  async duration(file) {
    const r = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], 60_000);
    const d = Number(r.stdout.toString().trim());
    return r.code === 0 && Number.isFinite(d) && d > 0 ? d : null;
  },
  async chapterCount(file) {
    const r = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_chapters', file], 60_000);
    if (r.code !== 0) throw new Error('ffprobe: файл не читается');
    return (JSON.parse(r.stdout.toString()) as { chapters?: unknown[] }).chapters?.length ?? 0;
  },
  async setChapters(file, chaptersFile) {
    const r = await run('mkvpropedit', [file, '--chapters', chaptersFile], 5 * 60_000);
    if (r.code >= 2 || r.code < 0) throw new Error(`mkvpropedit: ${r.stdout.toString().split('\n').filter(Boolean).at(-1) ?? 'ошибка'}`);
  },
};
