import { SectionHeader, Card } from '@/components/ui/Card';
import { getDb } from '@/lib/db/client';
import { getTmdbSettings } from '@/lib/tmdb';
import { TmdbCard } from './TmdbCard';

export const metadata = { title: 'Источники · Dublyarr' };

export default function SourcesSettingsPage() {
  const saved = getTmdbSettings(getDb());
  return (
    <>
      <SectionHeader title="Источники" description="Откуда Dublyarr берёт данные о сериалах и раздачи." />
      <TmdbCard hasKey={!!saved} proxy={saved?.proxy ?? ''} />
      <Card>
        <p className="m-0 text-[15px] leading-normal text-muted">Torznab-источники (Jackett, Prowlarr) — в следующем обновлении.</p>
      </Card>
    </>
  );
}
