import Link from "next/link";
import { getAllSettings, getSetting, listPresets, type SettingKey } from "@dublyarr/core/db";
import { getDb } from "@/server/db";
import { PresetsEditor } from "./PresetsEditor";
import { SettingsForm } from "./SettingsForm";
import { FoldersForm } from "./FoldersForm";
import { MonitoringForm } from "./MonitoringForm";
import { SecurityForm } from "./SecurityForm";
import styles from "./settings.module.css";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "quality", label: "Качество" },
  { key: "integrations", label: "Интеграции" },
  { key: "folders", label: "Папки и имена" },
  { key: "monitoring", label: "Мониторинг" },
  { key: "security", label: "Безопасность" },
] as const;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const active =
    tab === "integrations"
      ? "integrations"
      : tab === "folders"
        ? "folders"
        : tab === "monitoring"
          ? "monitoring"
          : tab === "security"
            ? "security"
            : "quality";
  const db = getDb();

  // Хеш пароля — ключ подписи сессий: нельзя отдавать его в RSC-payload форм.
  // Остальные секреты (api-ключи/пароли интеграций) формы намеренно показывают.
  const formSettings = (): Record<SettingKey, string | null> => {
    const all = getAllSettings(db);
    return { ...all, auth_password_hash: null };
  };

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
        <FoldersForm initial={formSettings()} />
      ) : active === "monitoring" ? (
        <MonitoringForm initial={formSettings()} />
      ) : active === "security" ? (
        <SecurityForm
          initialHasPassword={Boolean(getSetting(db, "auth_password_hash"))}
          initialLanBypass={getSetting(db, "auth_lan_bypass") !== "0"}
        />
      ) : (
        <SettingsForm initial={formSettings()} />
      )}
    </>
  );
}
