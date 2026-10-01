import readline from 'node:readline';
import { Writable } from 'node:stream';
import { getDb } from '../lib/db/client';
import { resetPassword } from './reset-password';
import { runBench } from './laya-bench';
import { loadConfig } from '../lib/config';

const HELP = `Dublyarr CLI

  dublyarr reset-password [--disable-2fa]   задать новый пароль (все сеансы завершатся);
                                            --disable-2fa — ещё и выключить код из приложения
  dublyarr laya-bench                       замерить скорость Laya на этом железе
  dublyarr help                             эта справка
`;

/** Скрытый ввод в терминале; без терминала (echo pw | dublyarr ...) — читаем строки из stdin. */
function prompter() {
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: !!process.stdin.isTTY });
  const lines: string[] = [];
  const waiters: ((s: string) => void)[] = [];
  rl.on('line', (l) => {
    const w = waiters.shift();
    if (w) w(l);
    else lines.push(l);
  });
  return {
    ask(q: string) {
      process.stdout.write(q);
      muted = true;
      return new Promise<string>((resolve) => {
        const done = (s: string) => {
          muted = false;
          process.stdout.write('\n');
          resolve(s);
        };
        const l = lines.shift();
        if (l !== undefined) done(l);
        else waiters.push(done);
      });
    },
    close: () => rl.close(),
  };
}

async function main(argv: string[]) {
  const [cmd, ...rest] = argv;
  if (cmd === 'laya-bench') {
    try {
      const r = await runBench(getDb(), { port: loadConfig().layaPort });
      console.log(`Laya (${r.runtime}): в среднем ${r.mean} мс, p95 ${r.p95} мс на вопрос`);
      return 0;
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      return 1;
    }
  }
  if (cmd !== 'reset-password') {
    process.stdout.write(HELP);
    return cmd === 'help' || cmd === undefined ? 0 : 1;
  }
  const p = prompter();
  try {
    const a = await p.ask('Новый пароль: ');
    const b = await p.ask('Повторите пароль: ');
    if (a !== b) {
      console.error('Пароли не совпадают');
      return 1;
    }
    const disable2fa = rest.includes('--disable-2fa');
    const { username } = await resetPassword(getDb(), { password: a, disable2fa });
    console.log(`Пароль для ${username} изменён. Все сеансы завершены.`);
    if (disable2fa) console.log('Двухфакторная защита выключена.');
    return 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  } finally {
    p.close();
  }
}

void main(process.argv.slice(2)).then((code) => process.exit(code));
