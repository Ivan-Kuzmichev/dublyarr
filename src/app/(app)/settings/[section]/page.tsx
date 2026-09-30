import { notFound } from 'next/navigation';
import { Placeholder } from '@/components/shell/Placeholder';
import { SETTINGS_SECTIONS } from '@/components/shell/nav';

export default async function SettingsSection({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const s = SETTINGS_SECTIONS.find((x) => x.id === section);
  if (!s || s.id === 'security') notFound();
  return <Placeholder title={s.label} phase={s.phase} heading={false} />;
}
