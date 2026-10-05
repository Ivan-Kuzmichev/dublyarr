'use client';

import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { SubscribeDialog } from '@/components/subscribe/SubscribeDialog';
import type { StudioOption } from '@/components/subscribe/ProfileEditor';
import { useFound } from '@/components/subscribe/useFound';
import type { Profile } from '@/lib/profile-core';
import { saveSubscriptionAction } from './subscribe-actions';

type Props = { tmdbId: number; subscribed: boolean; title: string; subtitle: string; studios: StudioOption[]; names: Record<number, string>; profile: Profile; delays?: Record<number, string> };

export function SubscribeButton(p: Props) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0); // новый экземпляр окна — свежее состояние формы
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button
        variant={p.subscribed ? 'secondary' : 'primary'}
        onClick={() => {
          setSession((n) => n + 1);
          setOpen(true);
        }}
      >
        {p.subscribed ? 'Подписка' : 'Подписаться'}
      </Button>
      {open && <Dialog key={session} {...p} onClose={close} />}
    </>
  );
}

/** Окно с подсказкой «что нашлось на трекерах» (опрос, пока идёт поиск). */
function Dialog({ tmdbId, subscribed, title, subtitle, studios, names, profile, delays, onClose }: Props & { onClose: () => void }) {
  const found = useFound(tmdbId, 'tv');
  return (
    <SubscribeDialog
      delays={delays}
      open
      onClose={onClose}
      mode={subscribed ? 'edit' : 'subscribe'}
      title={title}
      subtitle={subtitle}
      studios={studios}
      names={names}
      initial={profile}
      hidden={{ tmdbId: String(tmdbId) }}
      action={saveSubscriptionAction}
      found={found}
    />
  );
}
