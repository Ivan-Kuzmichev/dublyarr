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
  await new Promise((r) => setTimeout(r, 1500));
  expect(starts.filter((n) => n === 'crashy').length).toBeGreaterThanOrEqual(3);
  expect(starts.filter((n) => n === 'steady')).toHaveLength(1);
  await sup.stop();
}, 10_000);
