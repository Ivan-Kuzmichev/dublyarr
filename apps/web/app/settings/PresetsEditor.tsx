"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { QUALITY_LADDER, highestAllowed } from "@dublyarr/core/quality";
import styles from "./settings.module.css";

interface Preset {
  id: number;
  name: string;
  allowed: string[];
  preferred: string;
  upgradeEnabled: boolean;
}

type Draft = Omit<Preset, "id"> & { id: number | null };

function PresetCard({
  draft,
  onDone,
}: {
  draft: Draft;
  onDone: () => void;
}) {
  const [p, setP] = useState<Draft>(draft);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(key: string, checked: boolean) {
    const allowed = checked ? [...p.allowed, key] : p.allowed.filter((k) => k !== key);
    let preferred = p.preferred;
    if (!allowed.includes(preferred)) preferred = highestAllowed(allowed) ?? "";
    setP({ ...p, allowed, preferred });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(p.id === null ? "/api/presets" : `/api/presets/${p.id}`, {
        method: p.id === null ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: p.name,
          allowed: p.allowed,
          preferred: p.preferred,
          upgradeEnabled: p.upgradeEnabled,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Ошибка ${res.status}`);
        return;
      }
      onDone();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (p.id === null) return onDone();
    if (!window.confirm(`Удалить пресет «${p.name}»?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/presets/${p.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Ошибка ${res.status}`);
        return;
      }
      onDone();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.card} data-testid="preset-card">
      <label className={styles.field}>
        <span>Название</span>
        <input
          value={p.name}
          onChange={(e) => setP({ ...p, name: e.target.value })}
        />
      </label>
      <div className={styles.qualityGrid}>
        {QUALITY_LADDER.map((q) => (
          <label key={q.key}>
            <input
              type="checkbox"
              checked={p.allowed.includes(q.key)}
              onChange={(e) => toggle(q.key, e.target.checked)}
            />
            {q.label}
          </label>
        ))}
      </div>
      <label className={styles.field}>
        <span>Предпочитаемое</span>
        <select
          value={p.preferred}
          onChange={(e) => setP({ ...p, preferred: e.target.value })}
        >
          {QUALITY_LADDER.filter((q) => p.allowed.includes(q.key)).map((q) => (
            <option key={q.key} value={q.key}>{q.label}</option>
          ))}
        </select>
      </label>
      <label className={styles.inline}>
        <input
          type="checkbox"
          checked={p.upgradeEnabled}
          onChange={(e) => setP({ ...p, upgradeEnabled: e.target.checked })}
        />
        Апгрейдить до предпочитаемого (старый файл удаляется)
      </label>
      <div className={styles.actions}>
        <button disabled={busy} onClick={save}>Сохранить</button>
        <button disabled={busy} onClick={remove}>
          {p.id === null ? "Отмена" : "Удалить"}
        </button>
      </div>
      {error && <p className={styles.err}>{error}</p>}
    </div>
  );
}

export function PresetsEditor({ initial }: { initial: Preset[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);

  function done() {
    setAdding(false);
    router.refresh();
  }

  return (
    <div className={styles.presetList}>
      <h2>Пресеты качества</h2>
      {initial.map((p) => (
        <PresetCard key={`${p.id}-${p.name}-${p.preferred}`} draft={p} onDone={done} />
      ))}
      {adding ? (
        <PresetCard
          draft={{ id: null, name: "", allowed: [], preferred: "", upgradeEnabled: false }}
          onDone={done}
        />
      ) : (
        <div className={styles.actions}>
          <button data-testid="preset-new" onClick={() => setAdding(true)}>
            Новый пресет
          </button>
        </div>
      )}
    </div>
  );
}
