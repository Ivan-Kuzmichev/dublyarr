import { getAllSettings } from "@dublyarr/core/db";
import { getDb } from "@/server/db";
import { SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const values = getAllSettings(getDb());
  return (
    <>
      <h1>Настройки</h1>
      <h2>Интеграции</h2>
      <SettingsForm initial={values} />
    </>
  );
}
