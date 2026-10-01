import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { restartDelay, shouldResetFailures } from './backoff';
import { toJsonLine, type LogSink } from './log-sink';

export type ChildSpec = { name: string; command: string; args: string[]; env?: Record<string, string> };

type Opts = {
  children: ChildSpec[];
  onStart?: (name: string) => void;
  delayFor?: (failures: number) => number;
  logger?: Pick<Console, 'info' | 'error'>;
  /** Журнал: stdout/stderr детей построчно (JSON) — в файл и в свой stdout. */
  sink?: Pick<LogSink, 'write'>;
};

/** Держит дочерние процессы живыми: упавший перезапускается с растущей задержкой. */
export function startSupervisor(o: Opts) {
  const procs = new Map<string, ChildProcess>();
  const timers = new Set<NodeJS.Timeout>();
  let stopping = false;
  const delayFor = o.delayFor ?? restartDelay;
  const sink = o.sink;
  const toSink = (msg: string) => sink?.write(toJsonLine(msg, 'supervisor'));
  const logger = o.logger ?? (sink ? { info: toSink, error: toSink } : console);

  function run(spec: ChildSpec, failures: number) {
    if (stopping) return;
    const startedAt = Date.now();
    const p = spawn(spec.command, spec.args, { stdio: sink ? ['ignore', 'pipe', 'pipe'] : 'inherit', env: { ...process.env, ...spec.env, DUBLYARR_PROCESS: spec.name } });
    if (sink)
      for (const stream of [p.stdout, p.stderr])
        if (stream) createInterface({ input: stream }).on('line', (line) => line.trim() && sink.write(toJsonLine(line, spec.name)));
    procs.set(spec.name, p);
    o.onStart?.(spec.name);
    logger.info(`[supervisor] ${spec.name} запущен (pid ${p.pid})`);
    p.on('error', (e) => logger.error(`[supervisor] ${spec.name}: ${e.message}`));
    p.on('exit', (code, signal) => {
      procs.delete(spec.name);
      if (stopping) return;
      const f = shouldResetFailures(Date.now() - startedAt) ? 0 : failures;
      const delay = delayFor(f);
      logger.error(`[supervisor] ${spec.name} завершился (code=${code}, signal=${signal}), перезапуск через ${delay} мс`);
      const t = setTimeout(() => {
        timers.delete(t);
        run(spec, f + 1);
      }, delay);
      timers.add(t);
    });
  }

  for (const c of o.children) run(c, 0);

  return {
    async stop() {
      stopping = true;
      for (const t of timers) clearTimeout(t);
      await Promise.all(
        [...procs.values()].map(
          (p) =>
            new Promise<void>((resolve) => {
              if (p.exitCode !== null || p.signalCode !== null) return resolve();
              const kill = setTimeout(() => p.kill('SIGKILL'), 10_000);
              p.once('exit', () => {
                clearTimeout(kill);
                resolve();
              });
              p.kill('SIGTERM');
            }),
        ),
      );
    },
  };
}
