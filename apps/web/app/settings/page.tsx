import Link from "next/link";
import { getAllSettings, listPresets } from "@dublyarr/core/db";
import { getDb } from "@/server/db";
import { PresetsEditor } from "./PresetsEditor";
import { SettingsForm } from "./SettingsForm";
import { FoldersForm } from "./FoldersForm";
import styles from "./settings.module.css";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "quality", label: "Качество" },
  { key: "integrations", label: "Интеграции" },
  { key: "folders", label: "Папки и имена" },
] as const;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const active =
    tab === "integrations" ? "integrations" : tab === "folders" ? "folders" : "quality";
  const db = getDb();

  return (
    <>
      <h1>Настройки</h1>
      <nav className={styles.tabs} data-testid="settings-tabs">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/settings?tab=${t.key}`}
            className={t.key === active ? styles.tabActive : styles.tab}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {active === "quality" ? (
        <PresetsEditor initial={listPresets(db)} />
      ) : active === "folders" ? (
        <FoldersForm initial={getAllSettings(db)} />
      ) : (
        <SettingsForm initial={getAllSettings(db)} />
      )}
    </>
  );
}
