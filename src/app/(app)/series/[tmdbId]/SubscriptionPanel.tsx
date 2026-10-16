import { describeProfile, dubLabel, type Profile } from '@/lib/profile-core';

const Rule = ({ on, children }: { on: boolean; children: React.ReactNode }) => (
  <li className={`flex items-start gap-2.5 text-sm ${on ? 'text-text-2' : 'text-faint'}`}>
    <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${on ? 'bg-accent' : 'bg-dim'}`} />
    {children}
  </li>
);

/** Блок «Подписка» в карточке сериала (Series.dc.html, правая колонка). */
export function SubscriptionPanel({ profile, studioNames, author, filesOnly = false }: { profile: Profile; studioNames: Record<number, string>; author?: string | null; filesOnly?: boolean }) {
  const name = (id: number) => studioNames[id];
  const d = describeProfile(profile, name);
  return (
    <section aria-label="Подписка" className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="m-0 text-lg font-semibold">Подписка</h2>
        {filesOnly ? <span className="text-[13px] text-muted">только файлы</span> : <span className="text-[13px] text-accent">активна{author ? ` · добавил ${author}` : ''}</span>}
      </div>
      {filesOnly && (
        <p className="m-0 text-[13px] text-muted">
          Взят из медиатеки: Dublyarr учитывает файлы в «Хранилище», но ничего не ищет и не качает. После «Включить подписку» — по этому профилю:
        </p>
      )}
      <ol className={`m-0 flex list-none flex-col gap-2 p-0 ${filesOnly ? 'opacity-60' : ''}`}>
        {profile.dubs.map((p, i) => (
          <li key={i} className="flex items-start gap-3 text-sm">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono text-xs text-accent">{i + 1}</span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium">{dubLabel(p, name)}</span>
              <span className="text-[13px] text-faint">{i === 0 ? 'сразу' : `если нет — через ${p.waitDays} дн после эфира`}</span>
            </span>
          </li>
        ))}
      </ol>
      <ul className={`m-0 flex list-none flex-col gap-2 border-t border-line-soft p-0 pt-4 ${filesOnly ? 'opacity-60' : ''}`}>
        <Rule on>{d.quality}</Rule>
        <Rule on>{d.scope}</Rule>
        <Rule on={profile.wholeSeasonAfterFinale}>Качать сезон целиком после финала</Rule>
        <Rule on={profile.replaceWithHigher}>Заменить, когда выйдет озвучка выше по приоритету</Rule>
        <Rule on={profile.autoNextSeason}>Подписаться на новый сезон, когда его объявят</Rule>
      </ul>
    </section>
  );
}
