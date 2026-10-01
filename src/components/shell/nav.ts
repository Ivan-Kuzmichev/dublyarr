export type NavId = 'today' | 'library' | 'calendar' | 'discover' | 'activity' | 'storage' | 'settings';
export type NavItem = { id: NavId | 'more'; label: string; href: string; icon: string };

// Иконки — те же SVG-пути, что в design/screens/Sidebar.dc.html и MobileTabs.dc.html.
export const DESKTOP_NAV: NavItem[] = [
  { id: 'today', label: 'Сегодня', href: '/', icon: 'M3 11l9-7 9 7M5 10v10h14V10M10 20v-5h4v5' },
  { id: 'library', label: 'Библиотека', href: '/library', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { id: 'calendar', label: 'Календарь', href: '/calendar', icon: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4' },
  { id: 'discover', label: 'Поиск и тренды', href: '/discover', icon: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4' },
  { id: 'activity', label: 'Активность', href: '/activity', icon: 'M12 4v11M7 10l5 5 5-5M5 20h14' },
  { id: 'storage', label: 'Хранилище', href: '/storage', icon: 'M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01' },
  { id: 'settings', label: 'Настройки', href: '/settings', icon: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4' },
];

export const MOBILE_TABS: NavItem[] = [
  { id: 'today', label: 'Сегодня', href: '/', icon: 'M3 11l9-7 9 7M5 10v10h14V10' },
  { id: 'library', label: 'Библиотека', href: '/library', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { id: 'calendar', label: 'Календарь', href: '/calendar', icon: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4' },
  { id: 'activity', label: 'Загрузки', href: '/activity', icon: 'M12 4v11M7 10l5 5 5-5M5 20h14' },
  { id: 'more', label: 'Ещё', href: '/more', icon: 'M5 12h.01M12 12h.01M19 12h.01' },
];

export const SETTINGS_SECTIONS = [
  { id: 'sources', label: 'Источники', phase: 1 },
  { id: 'studios', label: 'Подписки и студии', phase: 1 },
  { id: 'download', label: 'Загрузка и папки', phase: 1 },
  { id: 'schedule', label: 'Расписание', phase: 2 },
  { id: 'files', label: 'Обработка файлов', phase: 3 },
  { id: 'movies', label: 'Фильмы', phase: 3 },
  { id: 'storage', label: 'Хранение', phase: 3 },
  { id: 'notify', label: 'Уведомления', phase: 2 },
  { id: 'ai', label: 'AI', phase: 4 },
  { id: 'security', label: 'Безопасность', phase: 0 },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id'];

export function activeNavId(pathname: string): NavId {
  const seg = pathname.split('/')[1] ?? '';
  if (seg === 'more') return 'settings';
  if (seg === 'series') return 'library';
  if (seg === 'search') return 'activity';
  const hit = DESKTOP_NAV.find((n) => n.href !== '/' && n.href === `/${seg}`);
  return (hit?.id as NavId | undefined) ?? 'today';
}
