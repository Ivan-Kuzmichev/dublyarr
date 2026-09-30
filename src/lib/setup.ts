import type { Db } from './db/client';
import { getSetting, setSetting } from './settings';
import { hasAnyUser } from './auth/users';

export type SetupStep = 'account' | 'tmdb' | 'qbittorrent' | 'sources' | 'folders' | 'done';
export const SETUP_ORDER = ['account', 'tmdb', 'qbittorrent', 'sources', 'folders'] as const;
type OptionalStep = 'tmdb' | 'qbittorrent' | 'sources' | 'folders';

export function getSetupState(db: Db): { step: SetupStep; completed: SetupStep[] } {
  const completed: SetupStep[] = [];
  if (!hasAnyUser(db)) return { step: 'account', completed };
  completed.push('account');
  for (const s of ['tmdb', 'qbittorrent', 'sources', 'folders'] as const) {
    if (!getSetting<string>(db, `setup.${s}`)) return { step: s, completed };
    completed.push(s);
  }
  return { step: getSetting<boolean>(db, 'setup.completed') ? 'done' : 'folders', completed };
}

export const markStep = (db: Db, step: OptionalStep, how: 'done' | 'skipped') => setSetting(db, `setup.${step}`, how);
export const completeSetup = (db: Db) => setSetting(db, 'setup.completed', true);
