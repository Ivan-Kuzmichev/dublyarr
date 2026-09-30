// Профиль подписки: порядок озвучек, качество, что скачивать. Он же — профиль по умолчанию.

export type DubPosition =
  | { kind: 'studio'; studioId: number; waitDays: number }
  | { kind: 'any'; waitDays: number } // «Любая»
  | { kind: 'original'; waitDays: number }; // «Оригинал с субтитрами»

export type Quality = { target: 720 | 1080 | 2160; allowLower: boolean; preferHdr: boolean; maxSizeGb: number | null };

export type Scope =
  | { mode: 'all' }
  | { mode: 'new' }
  | { mode: 'from'; season: number; episode: number; until: 'season_end' | 'onward' };

export type Profile = {
  dubs: DubPosition[]; // порядок = приоритет; waitDays — сколько ждать предыдущую позицию
  quality: Quality;
  scope: Scope;
  wholeSeasonAfterFinale: boolean;
  replaceWithHigher: boolean;
  autoNextSeason: boolean;
};
