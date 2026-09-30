import { expect, test } from 'vitest';
import { parseStudioForm } from '@/lib/studio-form';

const f = (o: Record<string, string>) => {
  const d = new FormData();
  for (const [k, v] of Object.entries(o)) d.set(k, v);
  return d;
};

test('разбор формы студии', () => {
  expect(parseStudioForm(f({ name: 'Paravozik', aliases: 'Паровозик, Paravozik Studio,', kind: 'series', trackers: '' }))).toEqual({
    name: 'Paravozik',
    aliases: ['Паровозик', 'Paravozik Studio'],
    kind: 'series',
    trackers: [],
  });
  expect(parseStudioForm(f({ name: 'X', aliases: '', kind: 'movie', trackers: '' }))).toEqual({ error: 'Выберите тип' });
});
