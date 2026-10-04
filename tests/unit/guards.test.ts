import { describe, expect, test, vi } from 'vitest';

// Каждое защищённое действие без права: «Недостаточно прав», и база не тронута (getDb бросает).
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({
  redirect: (u: string) => {
    throw new Error(`REDIRECT:${u}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
const user = { id: 2, username: 'anya', role: 'user', permissions: {}, disabled: false };
vi.mock('@/lib/auth/current', () => ({
  DENIED: 'Недостаточно прав',
  requireSession: async () => ({ user, session: { id: 's' } }),
  guard: async () => null,
  requireAdmin: async () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('@/lib/db/client', () => ({
  getDb: () => {
    throw new Error('DB touched');
  },
}));

const f = (o: Record<string, string> = {}) => {
  const d = new FormData();
  for (const [k, v] of Object.entries({ tmdbId: '1', id: '1', releaseId: '1', season: '1', ...o })) d.set(k, v);
  return d;
};
const DENIED = { error: 'Недостаточно прав' };

describe('действия без права', () => {
  test('подписки', async () => {
    const sub = await import('@/app/(app)/series/[tmdbId]/subscribe-actions');
    expect(await sub.saveSubscriptionAction({}, f({ intent: 'subscribe' }))).toMatchObject(DENIED);
    const movie = await import('@/app/(app)/movie/[tmdbId]/actions');
    expect(await movie.saveMovieSubscriptionAction({}, f({ intent: 'subscribe' }))).toMatchObject(DENIED);
  });
  test('ручной поиск, «Скачать», обновление', async () => {
    const s = await import('@/app/(app)/search/[tmdbId]/actions');
    expect(await s.downloadAction({}, f())).toMatchObject(DENIED);
    const series = await import('@/app/(app)/series/[tmdbId]/actions');
    expect(await series.refreshTitleAction({}, f())).toMatchObject(DENIED);
    await expect(series.setKindAction(1, 'anime')).resolves.toBeUndefined();
    const movie = await import('@/app/(app)/movie/[tmdbId]/actions');
    expect(await movie.refreshMovieAction({}, f())).toMatchObject(DENIED);
    const found = await import('@/app/(app)/_found/found-action');
    expect(await found.titleSearchAction(1, 'tv', true)).toEqual({ pending: false });
  });
  test('ответы на вопросы', async () => {
    const s = await import('@/app/(app)/search/[tmdbId]/actions');
    expect(await s.assignStudioAction({}, f({ label: 'X', studio: 'new' }))).toMatchObject(DENIED);
    await expect(s.answerMatchAction(f({ verdict: 'match' }))).resolves.toBeUndefined();
    await expect(s.correctAnimeAction(f({ label: 'x' }))).resolves.toBeUndefined();
  });
  test('загрузки', async () => {
    const a = await import('@/app/(app)/activity/actions');
    await expect(a.pauseAction(f())).rejects.toThrow('REDIRECT:/activity?error=');
    await expect(a.searchNowAction()).resolves.toBeUndefined();
  });
  test('хранилище и удаление', async () => {
    const st = await import('@/app/(app)/storage/actions');
    expect(await st.deleteSeriesAction({}, f({ mode: 'all' }))).toMatchObject(DENIED);
    expect(await st.confirmRetentionAction({}, f({ key: 's:1:1' }))).toMatchObject(DENIED);
    await expect(st.setExceptionsAction(f())).resolves.toBeUndefined();
    const c = await import('@/app/(app)/cleanup/actions');
    expect(await c.confirmCleanupAction({}, f())).toMatchObject(DENIED);
    const o = await import('@/app/(app)/old-copies/actions');
    expect(await o.confirmAction({}, f())).toMatchObject(DENIED);
  });
  test('настройки администратора', async () => {
    const files = await import('@/app/(app)/settings/files/actions');
    expect(await files.saveProcessingAction({}, f())).toMatchObject(DENIED);
    expect(await files.saveIntrosAction({}, f({ introName: 'Intro', creditsName: 'Credits' }))).toMatchObject(DENIED);
    const sch = await import('@/app/(app)/settings/schedule/actions');
    expect(await sch.saveScheduleAction({}, f())).toMatchObject(DENIED);
    const src = await import('@/app/(app)/settings/sources/source-actions');
    expect(await src.saveSourceAction({}, f())).toMatchObject(DENIED);
    const dl = await import('@/app/(app)/settings/download/actions');
    expect(await dl.saveQbitAction({}, f())).toMatchObject(DENIED);
    const ai = await import('@/app/(app)/settings/ai/actions');
    expect(await ai.saveLayaAction({}, f())).toMatchObject(DENIED);
    const studios = await import('@/app/(app)/settings/studios/actions');
    expect(await studios.saveStudioAction({}, f())).toMatchObject(DENIED);
    const sec = await import('@/app/(app)/settings/security/actions');
    expect(await sec.createApiTokenAction({}, f({ name: 'x' }))).toMatchObject(DENIED);
    const diag = await import('@/app/(app)/settings/diagnostics/actions');
    expect(await diag.saveLogSettingsAction({}, f())).toMatchObject(DENIED);
  });
});
