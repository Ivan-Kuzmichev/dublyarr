"use client";

import { useState } from "react";
import styles from "./settings.module.css";

type Values = Record<
  | "tmdb_api_key"
  | "jackett_url"
  | "jackett_api_key"
  | "qbit_url"
  | "qbit_username"
  | "qbit_password",
  string | null
>;

const FIELDS = [
  { key: "tmdb_api_key", label: "TMDb API ключ", type: "password" },
  { key: "jackett_url", label: "Jackett URL", type: "text" },
  { key: "jackett_api_key", label: "Jackett API ключ", type: "password" },
  { key: "qbit_url", label: "qBittorrent URL", type: "text" },
  { key: "qbit_username", label: "qBittorrent логин", type: "text" },
  { key: "qbit_password", label: "qBittorrent пароль", type: "password" },
] as const;

export function SettingsForm({ initial }: { initial: Values }) {
  const [values, setValues] = useState<Values>(initial);
  const [status, setStatus] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  async function save() {
    setStatus(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    setStatus(res.ok ? "Сохранено" : "Ошибка сохранения");
  }

  async function testConnection(service: "tmdb" | "jackett" | "qbit") {
    setTestResult(`${service}: проверяю…`);
    const res = await fetch("/api/settings/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service }),
    });
    const data = await res.json();
    setTestResult(data.ok ? `${service}: ✓ работает` : `${service}: ✗ ${data.error}`);
  }

  return (
    <div className={styles.card}>
      {FIELDS.map((f) => (
        <label key={f.key} className={styles.field}>
          <span>{f.label}</span>
          <input
            type={f.type}
            value={values[f.key] ?? ""}
            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
          />
        </label>
      ))}
      <div className={styles.actions}>
        <button onClick={save}>Сохранить</button>
        <button onClick={() => testConnection("tmdb")}>Проверить TMDb</button>
        <button onClick={() => testConnection("jackett")}>Проверить Jackett</button>
        <button onClick={() => testConnection("qbit")}>Проверить qBittorrent</button>
      </div>
      {status && <p className={styles.ok}>{status}</p>}
      {testResult && <p className={styles.muted}>{testResult}</p>}
    </div>
  );
}
