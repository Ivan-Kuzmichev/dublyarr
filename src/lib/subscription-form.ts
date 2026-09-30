import { parseProfileJson, type Profile } from './profile';

export type SubscriptionIntent = 'subscribe' | 'save' | 'unsubscribe';
export type ParsedSubscriptionForm =
  | { tmdbId: number; intent: 'unsubscribe' }
  | { tmdbId: number; intent: 'subscribe' | 'save'; profile: Profile }
  | { error: string };

/** Разбор и проверка формы окна подписки на сервере: клиенту не доверяем. */
export function parseSubscriptionForm(form: FormData, knownStudioIds: Set<number>): ParsedSubscriptionForm {
  const tmdbId = Number(form.get('tmdbId'));
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return { error: 'Сериал не найден' };
  const intent = form.get('intent');
  if (intent === 'unsubscribe') return { tmdbId, intent };
  if (intent !== 'subscribe' && intent !== 'save') return { error: 'Неверное действие' };
  const r = parseProfileJson(String(form.get('profile') ?? ''), knownStudioIds);
  return r.ok ? { tmdbId, intent, profile: r.profile } : { error: r.error };
}
