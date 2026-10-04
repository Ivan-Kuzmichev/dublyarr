import { execFile } from 'node:child_process';
import { logger } from '../log';

// Запуск ffprobe и mkvmerge. В тестах подменяется.

export type Runner = {
  available(): Promise<{ ffprobe: boolean; mkvmerge: boolean }>;
  probe(file: string): Promise<unknown>;
  /** `mkvmerge -J`: контейнер и номера дорожек; null — не прочитал */
  identify(file: string): Promise<unknown>;
  mkvmerge(args: string[]): Promise<{ code: number; output: string }>;
};

const ilog = logger('import');

const run = (cmd: string, args: string[], timeout: number) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const started = Date.now();
    execFile(cmd, args, { timeout, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? Number((err as { code: number }).code) : -1) : 0;
      // проверки «-version» — только в подробном журнале
      ilog[cmd === 'mkvmerge' && args[0] !== '--version' ? 'info' : 'debug']({ cmd, args, code, ms: Date.now() - started, ...(code > 1 || code < 0 ? { stderr: String(stderr).slice(0, 500) } : {}) }, 'run');
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });

let cached: Promise<{ ffprobe: boolean; mkvmerge: boolean }> | null = null;

export const systemRunner: Runner = {
  available() {
    cached ??= Promise.all([run('ffprobe', ['-version'], 10_000), run('mkvmerge', ['--version'], 10_000)]).then(([a, b]) => ({ ffprobe: a.code === 0, mkvmerge: b.code === 0 }));
    return cached;
  },
  async probe(file) {
    const r = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], 120_000);
    if (r.code !== 0) throw new Error('Файл не читается');
    return JSON.parse(r.stdout);
  },
  async identify(file) {
    const r = await run('mkvmerge', ['-J', file], 120_000);
    try {
      return JSON.parse(r.stdout);
    } catch {
      return null;
    }
  },
  async mkvmerge(args) {
    // mkvmerge: 0 — успех, 1 — предупреждения, 2 — ошибка
    const r = await run('mkvmerge', args, 30 * 60_000);
    return { code: r.code < 0 ? 2 : r.code, output: `${r.stdout}\n${r.stderr}`.trim() };
  },
};
