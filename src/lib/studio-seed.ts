import type { Studio } from './db/schema';

type Seed = { name: string; aliases: string[]; kind: Studio['kind']; trackers: string[] };

// Начальный словарь. trackers — «свой трекер»: раздачи с него всегда этой студии (имя трекера из Jackett).
export const STUDIO_SEED: Seed[] = [
  { name: 'LostFilm', aliases: ['LostFilm.TV', 'LF'], kind: 'series', trackers: ['lostfilm'] },
  { name: 'HDrezka Studio', aliases: ['HDrezka', 'Rezka'], kind: 'series', trackers: [] },
  { name: 'TVShows', aliases: ['TV Shows'], kind: 'series', trackers: [] },
  { name: 'NewStudio', aliases: ['New Studio'], kind: 'series', trackers: [] },
  { name: 'Кубик в Кубе', aliases: ['Kubik v Kube', 'KvK'], kind: 'series', trackers: [] },
  { name: 'AlexFilm', aliases: ['Alex Film'], kind: 'series', trackers: [] },
  { name: 'BaibaKo', aliases: [], kind: 'series', trackers: [] },
  { name: 'Jaskier', aliases: ['Jaskier Studio'], kind: 'series', trackers: [] },
  { name: 'Red Head Sound', aliases: ['RHS'], kind: 'series', trackers: [] },
  { name: 'RuDub', aliases: [], kind: 'series', trackers: ['rudub'] },
  { name: 'Сыендук', aliases: ['Syenduk'], kind: 'series', trackers: [] },
  { name: 'OMSKBIRD', aliases: ['Omskbird Records'], kind: 'series', trackers: [] },
  { name: 'Кураж-Бамбей', aliases: ['Kuraj-Bambey'], kind: 'series', trackers: [] },
  { name: 'Пифагор', aliases: ['Pifagor'], kind: 'series', trackers: [] },
  { name: 'IdeaFilm', aliases: [], kind: 'series', trackers: [] },
  { name: 'GoLTFilm', aliases: [], kind: 'series', trackers: [] },
  { name: 'ColdFilm', aliases: [], kind: 'series', trackers: [] },
  { name: 'Amedia', aliases: ['Амедиа'], kind: 'series', trackers: [] },
  { name: 'Novamedia', aliases: ['Нова Медиа'], kind: 'series', trackers: [] },
  { name: 'SDI Media', aliases: ['SDI'], kind: 'series', trackers: [] },
  { name: 'Paramount Comedy', aliases: ['Paramount'], kind: 'series', trackers: [] },
  { name: 'LE-Production', aliases: [], kind: 'series', trackers: [] },
  { name: 'Дубляж', aliases: ['Полное дублирование'], kind: 'both', trackers: [] },
  { name: 'AniDUB', aliases: [], kind: 'anime', trackers: ['anidub'] },
  { name: 'AniLibria', aliases: ['AniLiberty', 'Анилибрия'], kind: 'anime', trackers: ['anilibria'] },
  { name: 'SHIZA Project', aliases: ['SHIZA'], kind: 'anime', trackers: [] },
  { name: 'Studio Band', aliases: [], kind: 'anime', trackers: [] },
  { name: 'Dream Cast', aliases: [], kind: 'anime', trackers: [] },
  { name: 'AnimeVost', aliases: [], kind: 'anime', trackers: [] },
  { name: 'JAM Club', aliases: ['JAM'], kind: 'anime', trackers: [] },
  { name: 'AniMedia', aliases: [], kind: 'anime', trackers: [] },
];
