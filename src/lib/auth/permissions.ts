// Роли и права (2.3): админ — всё; пользователь — флаги, заданные админом. Проверка — на сервере в каждом действии.

export const PERMISSIONS = ['subscribe', 'search', 'answer', 'downloads', 'storage'] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABEL: Record<Permission, { title: string; sub: string }> = {
  subscribe: { title: 'Подписки', sub: 'Подписаться, изменить подписку, отписаться' },
  search: { title: 'Ручной поиск и «Скачать»', sub: 'Ручной поиск, загрузка раздачи, обновление из TMDB' },
  answer: { title: 'Ответы на вопросы', sub: '«Это он / Не тот сериал», студии, нумерация аниме' },
  downloads: { title: 'Загрузки', sub: 'Пауза, продолжить, убрать в «Активности», «Искать сейчас»' },
  storage: { title: 'Хранилище и удаление', sub: 'Удалить сериал или файлы, подтвердить уборку и старые копии' },
};

export const DEFAULT_PERMISSIONS: Record<Permission, boolean> = { subscribe: true, search: true, answer: true, downloads: false, storage: false };

// без node-модулей: используется и в клиентских компонентах
type Who = { role: 'admin' | 'user'; permissions: Partial<Record<Permission, boolean>>; disabled: boolean };

export const isAdmin = (u: Who) => !u.disabled && u.role === 'admin';

export function can(u: Who, p: Permission): boolean {
  if (u.disabled) return false;
  if (u.role === 'admin') return true;
  return u.permissions[p] === true;
}
