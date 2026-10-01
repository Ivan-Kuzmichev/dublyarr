'use client';

import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { SubscribeDialog } from '@/components/subscribe/SubscribeDialog';
import type { StudioOption } from '@/components/subscribe/ProfileEditor';
import { describeProfile, dubLabel, type Profile } from '@/lib/profile-core';
import { saveDefaultProfileAction } from './actions';

type Props = { kind: 'series' | 'anime'; profile: Profile; studios: StudioOption[]; studioNames: Record<number, string> };

export function DefaultProfileCard({ kind, profile, studios, studioNames }: Props) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const close = useCallback(() => setOpen(false), []);
  const name = (id: number) => studioNames[id];
  const title = kind === 'series' ? 'Сериалы' : 'Аниме';
  const d = describeProfile(profile, name);
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-[18px]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-base font-semibold">{title}</span>
        <span className="text-[13px] text-muted">{d.quality}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {profile.dubs.map((p, i) => (
          <span key={i} className="flex h-[30px] items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 text-[13px]">
            <span className="font-mono text-[11px] text-accent">{i + 1}</span>
            {dubLabel(p, name)}
          </span>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-faint">{d.scope}</span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setSession((n) => n + 1);
            setOpen(true);
          }}
        >
          Изменить
        </Button>
      </div>
      {open && (
        <SubscribeDialog
          key={session}
          open
          onClose={close}
          mode="default"
          title={`Профиль по умолчанию: ${title.toLowerCase()}`}
          subtitle="Подставляется в новую подписку по типу сериала"
          studios={studios}
          names={studioNames}
          initial={profile}
          hidden={{ kind }}
          action={saveDefaultProfileAction}
        />
      )}
    </article>
  );
}
