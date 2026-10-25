import { expect, test } from 'vitest';
import { startSupervisor } from '@/entry/supervisor';

test('упавший процесс перезапускается, stop гасит всех', async () => {
  const starts: string[] = [];
  const sup = startSupervisor({
    children: [
      { name: 'crashy', command: process.execPath, args: ['-e', 'process.exit(1)'] },
      { name: 'steady', command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'] },
    ],
    onStart: (name) => starts.push(name),
    delayFor: () => 50, // ускоряем backoff в тесте
    logger: { info: () => {}, error: () => {} },
  });
  // Ждём условие, а не фиксированное время: под параллельной нагрузкой vitest старт node бывает медленным.
  const deadline = Date.now() + 8000;
  while (starts.filter((n) => n === 'crashy').length < 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  expect(starts.filter((n) => n === 'crashy').length).toBeGreaterThanOrEqual(3);
  expect(starts.filter((n) => n === 'steady')).toHaveLength(1);
  await sup.stop();
}, 15_000);

test('с журналом: строки детей идут в sink, не-JSON оборачивается', async () => {
  const lines: string[] = [];
  const sup = startSupervisor({
    children: [{ name: 'laya', command: process.execPath, args: ['-e', 'console.log("Downloading"); console.log(JSON.stringify({msg:"json"})); setInterval(()=>{},1000)'] }],
    sink: { write: (l) => void lines.push(l) },
    logger: { info: () => {}, error: () => {} },
  });
  const deadline = Date.now() + 8000;
  while (lines.length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  await sup.stop();
  expect(JSON.parse(lines[0])).toMatchObject({ area: 'laya', name: 'laya', msg: 'Downloading' });
  expect(lines[1]).toBe('{"msg":"json"}');
}, 15_000);

test('с журналом: падение ребёнка — запись уровня «ошибка»', async () => {
  const lines: string[] = [];
  const sup = startSupervisor({
    children: [{ name: 'crashy', command: process.execPath, args: ['-e', 'process.exit(3)'] }],
    sink: { write: (l) => void lines.push(l) },
    delayFor: () => 60_000,
  });
  const deadline = Date.now() + 8000;
  while (!lines.some((l) => l.includes('завершился')) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  await sup.stop();
  expect(JSON.parse(lines.find((l) => l.includes('завершился'))!)).toMatchObject({ level: 50 });
}, 15_000);

test('выключенный процесс не стартует, при выключении останавливается и не перезапускается, при включении — запускается', async () => {
  const starts: string[] = [];
  const logs: string[] = [];
  let on = false;
  const sup = startSupervisor({
    children: [{ name: 'laya', command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'] }],
    onStart: (name) => starts.push(name),
    wanted: () => on,
    watchMs: 30,
    delayFor: () => 30,
    logger: { info: (m) => void logs.push(m), error: (m) => void logs.push(m) },
  });
  const until = async (f: () => boolean) => {
    const deadline = Date.now() + 8000;
    while (!f() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 30));
  };
  await new Promise((r) => setTimeout(r, 150));
  expect(starts).toHaveLength(0);
  on = true;
  await until(() => starts.length === 1);
  expect(starts).toHaveLength(1);
  on = false;
  await until(() => logs.some((l) => l.includes('laya остановлен')));
  await new Promise((r) => setTimeout(r, 200));
  expect(starts).toHaveLength(1); // не перезапущен
  on = true;
  await until(() => starts.length === 2);
  expect(starts).toHaveLength(2);
  await sup.stop();
}, 15_000);
