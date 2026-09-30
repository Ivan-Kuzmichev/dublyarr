import { getDb } from '@/lib/db/client';
import { getTmdbSettings } from '@/lib/tmdb';
import { Steps, StepHeading } from '../Steps';
import { requireSetupSession } from '../guard';
import { TmdbForm } from './TmdbForm';

export default async function SetupTmdbPage() {
  await requireSetupSession();
  const saved = getTmdbSettings(getDb());
  return (
    <>
      <Steps current="tmdb" />
      <StepHeading title="TMDB">
        Отсюда Dublyarr берёт названия, сезоны, даты выхода серий и постеры. Ключ — в настройках аккаунта на themoviedb.org: API Key или API Read
        Access Token.
      </StepHeading>
      <TmdbForm hasKey={!!saved} proxy={saved?.proxy ?? ''} />
    </>
  );
}
