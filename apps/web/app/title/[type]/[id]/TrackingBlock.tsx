"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./tracking.module.css";

export interface PresetOption {
  id: number;
  name: string;
}

export interface TrackedState {
  id: number;
  voiceover: string;
  qualityPresetId: number;
  monitorRule: "all" | "future_only" | "manual";
}

const RULES: { value: TrackedState["monitorRule"]; label: string }[] = [
  { value: "all", label: "Все серии" },
  { value: "future_only", label: "Только новые" },
  { value: "manual", label: "Вручную" },
];

export function TrackingBlock({
  type,
  tmdbId,
  tracked,
  presets,
  searchQuery,
}: {
  type: "movie" | "tv";
  tmdbId: number;
  tracked: TrackedState | null;
  presets: PresetOption[];
  searchQuery: string;
}) {
  const router = useRouter();
  const [studios, setStudios] = useState<string[]>([]);
  const [voiceover, setVoiceover] = useState(tracked?.voiceover ?? "any");
  const [presetId, setPresetId] = useState(tracked?.qualityPresetId ?? presets[0]?.id ?? 0);
  const [rule, setRule] = useState<TrackedState["monitorRule"]>(tracked?.monitorRule ?? "all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/studios?query=${encodeURIComponent(searchQuery)}`)
      .then((r) => r.json())
      .then((d: { studios: string[] }) => setStudios(d.studios))
      .catch(() => {});
  }, [searchQuery]);

  async function call(input: RequestInfo, init: RequestInit) {
    setBusy(true);
    setError(null);
    const res = await fetch(input, {
      ...init,
      headers: { "Content-Type": "application/json" },
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? `Ошибка ${res.status}`);
      return false;
    }
    router.refresh();
    return true;
  }

  function add() {
    void call("/api/titles", {
      method: "POST",
      body: JSON.stringify({ type, tmdbId, voiceover, qualityPresetId: presetId, monitorRule: rule }),
    });
  }

  function patch(body: Record<string, unknown>) {
    if (!tracked) return;
    void call(`/api/titles/${tracked.id}`, { method: "PATCH", body: JSON.stringify(body) });
  }

  function remove() {
    if (!tracked) return;
    if (!window.confirm("Убрать из отслеживания? Список серий будет удалён.")) return;
    void call(`/api/titles/${tracked.id}`, { method: "DELETE" });
  }

  // выбранная ранее озвучка может отсутствовать в текущей выдаче Jackett
  const options = [...new Set([...studios, ...(voiceover !== "any" ? [voiceover] : [])])];

  return (
    <div className={styles.block} data-testid="tracking-block">
      {tracked && <span className={styles.trackedBadge}>✓ отслеживается</span>}
      <div className={styles.row}>
        <label className={styles.field}>
          <span>Озвучка</span>
          <select
            data-testid="tracking-voiceover"
            value={voiceover}
            disabled={busy}
            onChange={(e) => {
              setVoiceover(e.target.value);
              if (tracked) patch({ voiceover: e.target.value });
            }}
          >
            <option value="any">Любая русская</option>
            {options.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Качество</span>
          <select
            data-testid="tracking-preset"
            value={presetId}
            disabled={busy}
            onChange={(e) => {
              setPresetId(Number(e.target.value));
              if (tracked) patch({ qualityPresetId: Number(e.target.value) });
            }}
          >
            {presets.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        {type === "tv" && (
          <label className={styles.field}>
            <span>Мониторинг</span>
            <select
              data-testid="tracking-monitor"
              value={rule}
              disabled={busy}
              onChange={(e) => {
                const v = e.target.value as TrackedState["monitorRule"];
                setRule(v);
                if (tracked) patch({ monitorRule: v });
              }}
            >
              {RULES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className={styles.row}>
        {!tracked ? (
          <button className={styles.primary} data-testid="tracking-add" disabled={busy || !presetId} onClick={add}>
            {busy ? "Добавляю…" : "Добавить в отслеживание"}
          </button>
        ) : (
          <button className={styles.danger} data-testid="tracking-remove" disabled={busy} onClick={remove}>
            Убрать из отслеживания
          </button>
        )}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
