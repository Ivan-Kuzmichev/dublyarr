import { expect, test } from 'vitest';
import { toggleDub, type DubPosition } from '@/lib/profile-core';

const lf: DubPosition = { kind: 'studio', studioId: 1, waitDays: 2 };
const hd: DubPosition = { kind: 'studio', studioId: 2, waitDays: 2 };
const any: DubPosition = { kind: 'any', waitDays: 5 };

test('новая позиция встаёт перед «Любой»; первая — без ожидания', () => {
  expect(toggleDub([{ ...lf, waitDays: 0 }, any], hd)).toEqual([{ ...lf, waitDays: 0 }, hd, any]);
  expect(toggleDub([], lf)).toEqual([{ ...lf, waitDays: 0 }]);
});

test('позиция, переставшая быть первой, получает ожидание по умолчанию', () => {
  // остался только «Любая» с ожиданием 0 — добавили студию: «Любая» не должна брать сразу
  expect(toggleDub([{ kind: 'any', waitDays: 0 }], hd)).toEqual([{ ...hd, waitDays: 0 }, { kind: 'any', waitDays: 5 }]);
});

test('удаление первой: новая первая — без ожидания', () => {
  expect(toggleDub([{ ...lf, waitDays: 0 }, hd, any], lf)).toEqual([{ ...hd, waitDays: 0 }, any]);
});

test('новая позиция ждёт не меньше предыдущей; «Любая» — не меньше новой', () => {
  const s3: DubPosition = { kind: 'studio', studioId: 3, waitDays: 2 };
  expect(toggleDub([{ ...lf, waitDays: 0 }, { ...hd, waitDays: 7 }, any], s3)).toEqual([
    { ...lf, waitDays: 0 },
    { ...hd, waitDays: 7 },
    { ...s3, waitDays: 7 },
    { kind: 'any', waitDays: 7 },
  ]);
});

test('setWait поднимает позиции ниже, если они стали меньше', async () => {
  const { setWait } = await import('@/lib/profile-core');
  const dubs: DubPosition[] = [{ ...lf, waitDays: 0 }, { ...hd, waitDays: 2 }, { kind: 'any', waitDays: 5 }];
  expect(setWait(dubs, 1, 7).map((d) => d.waitDays)).toEqual([0, 7, 7]);
  expect(setWait(dubs, 2, 3).map((d) => d.waitDays)).toEqual([0, 2, 3]);
  expect(setWait(dubs, 2, 1).map((d) => d.waitDays)).toEqual([0, 2, 2]); // не ниже позиции выше
});
