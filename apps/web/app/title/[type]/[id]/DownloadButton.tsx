"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./tracking.module.css";

export interface GrabPayload {
  titleId: number;
  guid: string;
  link: string;
  title: string;
  voiceoverStudio: string | null;
  qualitySource: string | null;
  qualityResolution: string | null;
  seasons: number[];
}

export function DownloadButton({ payload }: { payload: GrabPayload }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function grab() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/downloads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Ошибка ${res.status}`);
        return;
      }
      router.refresh();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={styles.grab}>
      <button
        type="button"
        className={styles.primary}
        disabled={busy}
        onClick={grab}
        data-testid="release-download"
      >
        {busy ? "Добавляю…" : "Скачать"}
      </button>
      {error && <span className={styles.error}>{error}</span>}
    </span>
  );
}
