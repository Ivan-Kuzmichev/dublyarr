import type { Db } from '../db/client';
import { getSetting } from '../settings';

// «Настройки → Файлы → Заставки и титры»: включено и названия глав (VidHub ищет заставку и титры по главам).

export type IntroSettings = { on: boolean; introName: string; creditsName: string };
export const DEFAULT_INTROS: IntroSettings = { on: true, introName: 'Intro', creditsName: 'Credits' };

export const getIntroSettings = (db: Db): IntroSettings => ({ ...DEFAULT_INTROS, ...getSetting<Partial<IntroSettings>>(db, 'intros') });

export function parseIntroForm(form: FormData): IntroSettings | { error: string } {
  const introName = String(form.get('introName') ?? '').trim();
  const creditsName = String(form.get('creditsName') ?? '').trim();
  if (!introName || !creditsName) return { error: 'Укажите названия глав' };
  return { on: form.get('on') === 'on', introName, creditsName };
}
