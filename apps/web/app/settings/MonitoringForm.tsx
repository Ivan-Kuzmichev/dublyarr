"use client";

import { useState } from "react";
import styles from "./settings.module.css";

type Values = Record<
  "monitor_interval_min" | "monitor_min_seeders" | "monitor_stall_hours",
  string | null
>;

const FIELDS = [
  { key: "monitor_interval_min", label: "Интервал проверки (мин)", placeholder: "15" },
  { key: "monitor_min_seeders", label: "Минимум сидов", placeholder: "1" },
  { key: "monitor_stall_hours", label: "Таймаут зависания (ч)", placeholder: "6" },
] as const;

export function MonitoringForm({ initial }: { initial: Values }) {
  const [values, setValues] = useState<Values>(initial);
  const [status, setStatus] = useState<string | null>(null);

  async function save() {
    setStatus(null);
    try {
      const payload = Object.fromEntries(FIELDS.map((f) => [f.key, values[f.key]]));
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setStatus(res.ok ? "Сохранено" : "Ошибка сохранения");
    } catch {
      setStatus("Сеть недоступна");
    }
  }

  return (
    <div className={styles.card} data-testid="monitoring-form">
      {FIELDS.map((f) => (
        <label key={f.key} className={styles.field}>
          <span>{f.label}</span>
          <input
            type="number"
            min="0"
            placeholder={f.placeholder}
            value={values[f.key] ?? ""}
            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
          />
        </label>
      ))}
      <p className={styles.muted}>
        Воркер проверяет отслеживаемое каждые N минут: ищет недостающее в нужной озвучке и
        качестве, скачивает и импортирует. Зависшие дольше таймаута — в чёрный список.
      </p>
      <div className={styles.actions}>
        <button onClick={save}>Сохранить</button>
      </div>
      {status && <p className={status === "Сохранено" ? styles.ok : styles.err}>{status}</p>}
    </div>
  );
}
