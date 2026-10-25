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
  /** Нужен ли процесс сейчас (выключатель Laya): спрашивается при старте и раз в watchMs; выключенный останавливается и не перезапускается. */
  wanted?: (name: string) => boolean;
  watchMs?: number;
};

/** Держит дочерние процессы живыми: упавший перезапускается с растущей задержкой. */
export function startSupervisor(o: Opts) {
  const procs = new Map<string, ChildProcess>();
  const timers = new Map<string, NodeJS.Timeout>();
  const off = new Set<string>();
  let stopping = false;
  const delayFor = o.delayFor ?? restartDelay;
  const sink = o.sink;
  const toSink = (stream: 'stdout' | 'stderr') => (msg: string) => sink?.write(toJsonLine(msg, 'supervisor', stream));
  const logger = o.logger ?? (sink ? { info: toSink('stdout'), error: toSink('stderr') } : console);

  function run(spec: ChildSpec, failures: number) {
    if (stopping || off.has(spec.name)) return;
    const startedAt = Date.now();
    const p = spawn(spec.command, spec.args, { stdio: sink ? ['ignore', 'pipe', 'pipe'] : 'inherit', env: { ...process.env, ...spec.env, DUBLYARR_PROCESS: spec.name } });
    if (sink)
      for (const [stream, kind] of [[p.stdout, 'stdout'], [p.stderr, 'stderr']] as const)
        if (stream) createInterface({ input: stream }).on('line', (line) => line.trim() && sink.write(toJsonLine(line, spec.name, kind)));
    procs.set(spec.name, p);
    o.onStart?.(spec.name);
    logger.info(`[supervisor] ${spec.name} запущен (pid ${p.pid})`);
    p.on('error', (e) => logger.error(`[supervisor] ${spec.name}: ${e.message}`));
    p.on('exit', (code, signal) => {
      if (procs.get(spec.name) === p) procs.delete(spec.name);
      if (stopping) return;
      if (off.has(spec.name)) {
        logger.info(`[supervisor] ${spec.name} остановлен`);
        return;
      }
      const f = shouldResetFailures(Date.now() - startedAt) ? 0 : failures;
      const delay = delayFor(f);
      logger.error(`[supervisor] ${spec.name} завершился (code=${code}, signal=${signal}), перезапуск через ${delay} мс`);
      timers.set(
        spec.name,
        setTimeout(() => {
          timers.delete(spec.name);
          run(spec, f + 1);
        }, delay),
      );
    });
  }

  /** SIGTERM, через 10 с — SIGKILL; ждём выхода. */
  const terminate = (p: ChildProcess) =>
    new Promise<void>((resolve) => {
      if (p.exitCode !== null || p.signalCode !== null) return resolve();
      const kill = setTimeout(() => p.kill('SIGKILL'), 10_000);
      p.once('exit', () => {
        clearTimeout(kill);
        resolve();
      });
      p.kill('SIGTERM');
    });

  function apply(spec: ChildSpec) {
    const want = o.wanted?.(spec.name) ?? true;
    if (!want && !off.has(spec.name)) {
      off.add(spec.name);
      clearTimeout(timers.get(spec.name));
      timers.delete(spec.name);
      const p = procs.get(spec.name);
      if (p) {
        logger.info(`[supervisor] ${spec.name} выключен — останавливаю`);
        void terminate(p);
      }
    } else if (want && off.has(spec.name)) {
      off.delete(spec.name);
      // ещё не вышел после выключения — его обработчик выхода сам перезапустит
      if (!procs.has(spec.name)) run(spec, 0);
    }
  }

  for (const c of o.children) {
    if (o.wanted && !o.wanted(c.name)) off.add(c.name);
    else run(c, 0);
  }
  const watch = o.wanted ? setInterval(() => o.children.forEach(apply), o.watchMs ?? 5000) : null;

  return {
    async stop() {
      stopping = true;
      if (watch) clearInterval(watch);
      for (const t of timers.values()) clearTimeout(t);
      await Promise.all([...procs.values()].map(terminate));
    },
  };
}
