import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { episodeFiles } from '../db/schema';

// Разметка заставок по сезону: выбор сезона, отпечатки, согласие соседей, запись глав.

/** Поля разметки — в null: импорт (новый файл или замена) пишет их вместе с остальными. */
export const INTRO_FIELDS_RESET = { introState: null, introNote: null, introStart: null, introEnd: null, creditsStart: null, creditsEnd: null, introCheckedAt: null } as const;

/** Новая серия в сезоне — новый сосед: «не нашлось» проверяется заново. */
export function resetIntroMarks(db: Db, titleId: number, season: number) {
  db.update(episodeFiles)
    .set({ introState: null, introNote: null })
    .where(and(eq(episodeFiles.titleId, titleId), eq(episodeFiles.season, season), eq(episodeFiles.introState, 'none')))
    .run();
}
