'use client';

import { setExceptionsAction } from '@/app/(app)/storage/actions';

/** Исключения правил хранения для сериала; сохраняются сразу при переключении. */
export function RetentionToggles({ tmdbId, keepAll, autoDelete, days, movie = false }: { tmdbId: number; keepAll: boolean; autoDelete: boolean; days: number; movie?: boolean }) {
  return (
    <form action={setExceptionsAction} className="flex flex-col gap-1">
      <input type="hidden" name="tmdbId" value={tmdbId} />
      {movie && <input type="hidden" name="type" value="movie" />}
      {[
        ...(movie ? [] : [{ name: 'keepAll', on: keepAll, label: 'Хранить все сезоны', sub: 'Правило «последний + выходящий» не трогает этот сериал' }]),
        { name: 'autoDelete', on: autoDelete, label: `Удалять через ${days} дн после скачивания`, sub: movie ? 'Посмотреть и забыть' : 'Для сериалов «посмотреть и забыть»' },
      ].map((t) => (
        <label key={t.name} className="flex min-h-11 cursor-pointer items-start gap-3 py-1">
          <input type="checkbox" name={t.name} defaultChecked={t.on} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="mt-px h-[18px] w-[18px] accent-accent" />
          <span className="flex flex-col gap-[3px]">
            <span className="text-sm text-text-2">{t.label}</span>
            <span className="text-[13px] text-faint">{t.sub}</span>
          </span>
        </label>
      ))}
    </form>
  );
}
