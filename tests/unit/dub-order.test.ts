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
