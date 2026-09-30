import { expect, test } from 'vitest';
import { parseSubscriptionForm } from '@/lib/subscription-form';

const f = (o: Record<string, string>) => {
  const d = new FormData();
  for (const [k, v] of Object.entries(o)) d.set(k, v);
  return d;
};
const profile = JSON.stringify({
  dubs: [{ kind: 'any', waitDays: 0 }],
  quality: { target: 1080, allowLower: true, preferHdr: false, maxSizeGb: null },
  scope: { mode: 'all' },
  wholeSeasonAfterFinale: false,
  replaceWithHigher: true,
  autoNextSeason: true,
});

test('разбор формы подписки', () => {
  expect(parseSubscriptionForm(f({ tmdbId: '1399', intent: 'subscribe', profile }), new Set())).toMatchObject({
    tmdbId: 1399,
    intent: 'subscribe',
    profile: { scope: { mode: 'all' } },
  });
  expect(parseSubscriptionForm(f({ tmdbId: '1399', intent: 'unsubscribe' }), new Set())).toEqual({ tmdbId: 1399, intent: 'unsubscribe' });
  expect(parseSubscriptionForm(f({ tmdbId: 'abc', intent: 'subscribe', profile }), new Set())).toEqual({ error: 'Сериал не найден' });
  expect(parseSubscriptionForm(f({ tmdbId: '-1', intent: 'subscribe', profile }), new Set())).toEqual({ error: 'Сериал не найден' });
  expect(parseSubscriptionForm(f({ tmdbId: '1', intent: 'drop', profile }), new Set())).toEqual({ error: 'Неверное действие' });
  expect(parseSubscriptionForm(f({ tmdbId: '1', intent: 'save', profile: '{' }), new Set())).toEqual({ error: 'Неверные данные профиля' });
});
