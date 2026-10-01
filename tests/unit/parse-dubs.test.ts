import { expect, test } from 'vitest';
import { studioMatcher, parseDubs, parseRelease, type StudioRef } from '@/lib/parse/dubs';
import { STUDIO_SEED } from '@/lib/studio-seed';

const studios: StudioRef[] = STUDIO_SEED.map((s, i) => ({ id: i + 1, name: s.name, aliases: s.aliases, trackers: s.trackers }));
const nameOf = (id: number | null) => (id === null ? null : studios.find((s) => s.id === id)!.name);
const find = studioMatcher(studios);
const tracker = (name: string, id = name.toLowerCase().replace(/\.tv$|\.org$/, '')) => ({ id, name });

test.each([
  [
    'Severance / S2E1-10 of 10 [2025, WEB-DL 1080p] Dub (Red Head Sound) + 6 x MVO (HDrezka Studio, LostFilm) + Original + Sub (Rus, Eng)',
    tracker('RuTracker.org', 'rutracker'),
    [
      { kind: 'dub', name: 'Red Head Sound', by: 'title' },
      { kind: 'mvo', name: 'HDrezka Studio', by: 'title' },
      { kind: 'mvo', name: 'LostFilm', by: 'title' },
    ],
  ],
  [
    'Severance - S2E1-10 - 2025  DUB, 5 x MVO, MVO (LE-Production), Sub 4K',
    tracker('Kinozal'),
    [
      { kind: 'dub', name: null, by: 'none' },
      { kind: 'mvo', name: null, by: 'none' },
      { kind: 'mvo', name: 'LE-Production', by: 'title' },
    ],
  ],
  ['The Bear - S5E8 - Beef - rus 1080p WEBDL (LostFilm)', tracker('LostFilm.tv', 'lostfilm'), [{ kind: 'mvo', name: 'LostFilm', by: 'tracker' }]],
  [
    'Фрирен 2 / E01-E10 Sousou no Frieren 2nd Season - AniLiberty.TOP [WEB-DL 1080p]',
    tracker('Anilibria'),
    [{ kind: 'mvo', name: 'AniLibria', by: 'tracker' }],
  ],
  ['Sousou no Frieren  S02E01-E10 [RUS] [HDTV 1080p]', tracker('AniDUB'), [{ kind: 'mvo', name: 'AniDUB', by: 'tracker' }]],
  [
    'Sousou no Frieren - S1E1-28 - 2023-2024  DUB (StudioBand), MVO, Sub HEVC',
    tracker('Kinozal'),
    [
      { kind: 'dub', name: 'Studio Band', by: 'title' },
      { kind: 'mvo', name: null, by: 'none' },
    ],
  ],
  ['Sousou no Frieren - S2E1-10 - 2026  MVO (AniLiberty), Sub WEBDL 1080p', tracker('Kinozal'), [{ kind: 'mvo', name: 'AniLibria', by: 'title' }]],
  ['Severance - S1E1-9 - 2022  MVO (LostFilm, HDRezka Studio), Sub HEVC', tracker('Kinozal'), [
    { kind: 'mvo', name: 'LostFilm', by: 'title' },
    { kind: 'mvo', name: 'HDrezka Studio', by: 'title' },
  ]],
  ['The Last of Us / S2E1-7 of 7 [2025, WEB-DL 1080p] MVO (Sunnysiders) + MVO (Ukr) + Original', tracker('RuTracker.org', 'rutracker'), [
    { kind: 'mvo', name: null, label: 'Sunnysiders', by: 'title' },
  ]],
])('%s', (title, tr, exp) => {
  const r = parseDubs(title, [], tr, find, studios);
  expect(r.dubs.map((d) => ({ kind: d.kind, name: nameOf(d.studioId), by: d.by }))).toEqual(
    exp.map((e) => ({ kind: e.kind, name: e.name, by: e.by })),
  );
  for (const [i, e] of exp.entries()) if ('label' in e) expect(r.dubs[i].label).toBe(e.label);
});

test('нераспознанная студия после MVO без скобок', () => {
  const r = parseDubs('Криминальное прошлое S02E03 [WEB-DL 1080p] MVO Paravozik', [], tracker('Kinozal'), find, studios);
  expect(r.dubs).toEqual([{ kind: 'mvo', studioId: null, label: 'Paravozik', by: 'none' }]);
});

test('студия в перечне, которой нет в словаре', () => {
  const r = parseDubs('Rick and Morty - S6E1-10 - 2022  MVO (NewComers) WEBRip 720p', [], tracker('Kinozal'), find, studios);
  expect(r.dubs).toEqual([{ kind: 'mvo', studioId: null, label: 'NewComers', by: 'title' }]);
});

test('короткие варианты — только целым словом', () => {
  expect(find('LF')?.name).toBe('LostFilm');
  expect(find('WOLF')).toBeNull();
  expect(find('JAMES')).toBeNull();
  const r = parseDubs('Wolf Hall S01E01 1080p WEB-DL MVO (James Studio)', [], tracker('Kinozal'), find, studios);
  expect(r.dubs.map((d) => nameOf(d.studioId))).toEqual([null]);
});

test('оригинал и субтитры', () => {
  expect(parseDubs('Show / S1E1-21 of 21 [2013, BDRip] VO + Original + Sub (Rus, Eng)', [], tracker('RuTracker.org', 'rutracker'), find, studios)).toMatchObject({
    original: true,
    subs: true,
  });
  expect(parseDubs('(S1) / Show [TV] [E12 of 12] [RUS(ext), JAP+Sub]', [], tracker('RuTracker.org', 'rutracker'), find, studios)).toMatchObject({ subs: true });
});

test('теги Jackett дают тип, если в заголовке его нет', () => {
  expect(parseDubs('Show S01 WEB-DL', ['дубляж'], tracker('Kinozal'), find, studios).dubs).toEqual([{ kind: 'dub', studioId: null, label: 'дубляж', by: 'tag' }]);
  expect(parseDubs('Show S01 MVO (LostFilm)', ['многоголосый'], tracker('Kinozal'), find, studios).dubs).toHaveLength(1);
});

test('parseRelease собирает всё вместе', () => {
  const r = parseRelease('Game of Thrones - S1E3 - Lord Snow - rus 1080p WEBDL (LostFilm)', { category: '5000' }, tracker('LostFilm.tv', 'lostfilm'), studios);
  expect(r).toMatchObject({
    base: 'game of thrones',
    names: ['Game of Thrones'],
    seasons: [1],
    episodes: { from: 3, to: 3 },
    pack: false,
    resolution: 1080,
    source: 'webdl',
    dubs: [{ kind: 'mvo', studioId: 1, by: 'tracker' }],
  });
});

test('студия кириллицей без скобок', () => {
  const r = parseDubs('Show S01E01 [WEB-DL 1080p] MVO Кураж-Бамбей', [], tracker('Kinozal'), find, studios);
  expect(r.dubs.map((d) => nameOf(d.studioId))).toEqual(['Кураж-Бамбей']);
  const u = parseDubs('Show S01E01 MVO Паравозик', [], tracker('Kinozal'), find, studios);
  expect(u.dubs).toEqual([{ kind: 'mvo', studioId: null, label: 'Паравозик', by: 'none' }]);
});
