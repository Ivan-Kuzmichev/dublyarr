import { getDb } from '@/lib/db/client';
import { getSetting } from '@/lib/settings';
import { Steps, StepHeading } from '../Steps';
import { requireSetupSession } from '../guard';
import { FoldersForm } from './FoldersForm';

export default async function SetupFoldersPage() {
  await requireSetupSession();
  const paths = getSetting<{ downloads: string; media: string }>(getDb(), 'paths');
  return (
    <>
      <Steps current="folders" />
      <StepHeading title="Папки">
        Пути внутри контейнера — те, что смонтированы томами. Dublyarr проверит, что в них можно писать.
      </StepHeading>
      <FoldersForm downloads={paths?.downloads ?? '/downloads'} media={paths?.media ?? '/media'} />
    </>
  );
}
