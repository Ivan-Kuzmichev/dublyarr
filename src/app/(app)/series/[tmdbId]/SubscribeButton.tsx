'use client';

import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { SubscribeDialog } from '@/components/subscribe/SubscribeDialog';
import type { StudioOption } from '@/components/subscribe/ProfileEditor';
import type { Profile } from '@/lib/profile-core';
import { saveSubscriptionAction } from './subscribe-actions';

type Props = { tmdbId: number; subscribed: boolean; title: string; subtitle: string; studios: StudioOption[]; profile: Profile };

export function SubscribeButton({ tmdbId, subscribed, title, subtitle, studios, profile }: Props) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0); // новый экземпляр окна — свежее состояние формы
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button
        variant={subscribed ? 'secondary' : 'primary'}
        onClick={() => {
          setSession((n) => n + 1);
          setOpen(true);
        }}
      >
        {subscribed ? 'Подписка' : 'Подписаться'}
      </Button>
      {open && (
        <SubscribeDialog
          key={session}
          open
          onClose={close}
          mode={subscribed ? 'edit' : 'subscribe'}
          title={title}
          subtitle={subtitle}
          studios={studios}
          initial={profile}
          hidden={{ tmdbId: String(tmdbId) }}
          action={saveSubscriptionAction}
        />
      )}
    </>
  );
}
