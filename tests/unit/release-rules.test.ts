import { expect, test } from 'vitest';
import { testDb } from './helpers';
import { addRule, ruleFor } from '@/lib/release-rules';
import { releaseRules, titles } from '@/lib/db/schema';

test('правила: без дублей; правило без трекера действует везде, конкретное — важнее', () => {
  const db = testDb();
  const t = db.insert(titles).values({ tmdbId: 1, kind: 'series', nameRu: 'A', nameOriginal: 'A', originalLanguage: 'en', status: 'returning', createdAt: 1, refreshedAt: 1 }).returning().get();
  addRule(db, t.id, 'Kinozal', 'Game of Thrones - S1E1-10 - 2011  MVO', 'reject');
  addRule(db, t.id, 'Kinozal', 'Game of Thrones - S2E1-10 - 2012  MVO', 'reject'); // та же основа
  expect(db.select().from(releaseRules).all()).toHaveLength(1);
  expect(ruleFor(db, t.id, 'Kinozal', 'Game of Thrones / S3E1-10 of 10 [2013]')).toBe('reject');
  expect(ruleFor(db, t.id, 'RuTracker.org', 'Game of Thrones / S3E1-10 of 10 [2013]')).toBeUndefined();
  addRule(db, t.id, null, 'Game of Thrones S01', 'match');
  expect(ruleFor(db, t.id, 'RuTracker.org', 'Game of Thrones / S3')).toBe('match');
  expect(ruleFor(db, t.id, 'Kinozal', 'Game of Thrones / S3')).toBe('reject');
  addRule(db, t.id, 'Kinozal', 'Game of Thrones - S1', 'match'); // передумали
  expect(ruleFor(db, t.id, 'Kinozal', 'Game of Thrones / S3')).toBe('match');
});
