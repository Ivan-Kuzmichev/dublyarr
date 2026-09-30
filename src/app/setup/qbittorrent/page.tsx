import { getDb } from '@/lib/db/client';
import { tryGetSecretSetting } from '@/lib/settings';
import type { QbitConfig } from '@/lib/integrations/qbittorrent';
import { Steps, StepHeading } from '../Steps';
import { requireSetupSession } from '../guard';
import { QbitForm } from './QbitForm';

export default async function SetupQbitPage() {
  await requireSetupSession();
  const saved = tryGetSecretSetting<QbitConfig>(getDb(), 'qbittorrent');
  return (
    <>
      <Steps current="qbittorrent" />
      <StepHeading title="qBittorrent">
        Dublyarr добавляет раздачи в qBittorrent через WebAPI. Адрес — как в браузере, с портом веб-интерфейса.
      </StepHeading>
      <QbitForm url={saved?.url ?? ''} username={saved?.username ?? 'admin'} hasPassword={!!saved?.password} />
    </>
  );
}
