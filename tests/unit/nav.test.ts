import { expect, test } from 'vitest';
import { activeNavId, DESKTOP_NAV, MOBILE_TABS, SETTINGS_SECTIONS, settingsSectionsFor } from '@/components/shell/nav';

test('активный пункт по пути', () => {
  expect(activeNavId('/')).toBe('today');
  expect(activeNavId('/library')).toBe('library');
  expect(activeNavId('/settings/security')).toBe('settings');
  expect(activeNavId('/activity/search')).toBe('activity');
  expect(activeNavId('/series/1399')).toBe('library');
  expect(activeNavId('/search/1399')).toBe('activity');
});

test('состав навигации как в макетах', () => {
  expect(DESKTOP_NAV.map((n) => n.label)).toEqual(['Сегодня', 'Библиотека', 'Календарь', 'Поиск и тренды', 'Активность', 'Хранилище', 'Настройки']);
  expect(MOBILE_TABS.map((n) => n.label)).toEqual(['Сегодня', 'Библиотека', 'Календарь', 'Загрузки', 'Ещё']);
  expect(SETTINGS_SECTIONS.at(-1)).toEqual({ id: 'security', label: 'Безопасность', phase: 0, forUsers: true });
});

test('«Диагностика» — перед «Безопасностью»', () => {
  expect(SETTINGS_SECTIONS.at(-2)).toMatchObject({ id: 'diagnostics', label: 'Диагностика' });
});

test('разделы настроек: админ — все, пользователь — только «Уведомления» и «Безопасность»', () => {
  expect(settingsSectionsFor(true).map((s) => s.id)).toContain('users');
  expect(settingsSectionsFor(false).map((s) => s.id)).toEqual(['notify', 'security']);
});
