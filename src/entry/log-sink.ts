import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

// Журнал контейнера: пишет только супервизор (один писатель — простая ротация без гонок).

const MB = 1024 * 1024;

/** Строки детей — JSON pino; остальное (laya-serve, падения Node) оборачивается, чтобы журнал читался одинаково. */
export function toJsonLine(line: string, proc: string): string {
  const t = line.trim();
  if (t.startsWith('{') && t.endsWith('}')) return t;
  return JSON.stringify({ level: 30, time: Date.now(), name: proc, area: proc === 'laya' ? 'laya' : 'system', msg: t });
}

export type LogSink = { write(line: string): void; error: string | null };

/** `dir/dublyarr.log` с ротацией по размеру (`.1` … `.{keep-1}`); нет прав — только в stdout (`echo`). */
export function createLogSink(dir: string, opts: { maxBytes?: number; keep?: number; echo?: (line: string) => void } = {}): LogSink {
  const maxBytes = opts.maxBytes ?? 10 * MB;
  const keep = opts.keep ?? 5;
  const echo = opts.echo ?? ((l: string) => void process.stdout.write(`${l}\n`));
  const file = path.join(dir, 'dublyarr.log');
  let size = 0;
  const sink: LogSink = { error: null, write };
  const fail = (e: unknown) => {
    sink.error = `Журнал недоступен: ${e instanceof Error ? e.message : String(e)}`;
  };
  try {
    mkdirSync(dir, { recursive: true });
    size = existsSync(file) ? statSync(file).size : 0;
  } catch (e) {
    fail(e);
  }
  function rotate() {
    rmSync(`${file}.${keep - 1}`, { force: true });
    for (let i = keep - 2; i >= 1; i--) if (existsSync(`${file}.${i}`)) renameSync(`${file}.${i}`, `${file}.${i + 1}`);
    renameSync(file, `${file}.1`);
    size = 0;
  }
  function write(line: string) {
    echo(line);
    if (sink.error) return;
    try {
      const bytes = Buffer.byteLength(line) + 1;
      if (size > 0 && size + bytes > maxBytes) rotate();
      appendFileSync(file, `${line}\n`);
      size += bytes;
    } catch (e) {
      fail(e);
    }
  }
  return sink;
}
