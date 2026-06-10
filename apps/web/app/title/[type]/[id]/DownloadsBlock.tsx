"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./tracking.module.css";

export interface DownloadView {
  id: number;
  releaseTitle: string;
  status: "queued" | "downloading" | "completed" | "failed" | "imported";
  progress: number;
  error: string | null;
}

const STATUS_RU: Record<DownloadView["status"], string> = {
  queued: "в очереди",
  downloading: "качается",
  completed: "скачано, импортирую…",
  failed: "ошибка",
  imported: "импортировано",
};

const ACTIVE = new Set(["queued", "downloading", "completed"]);

export function DownloadsBlock({
  titleId,
  initial,
}: {
  titleId: number;
  initial: DownloadView[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [qbtError, setQbtError] = useState<string | null>(null);
  const importedIds = useRef(new Set(initial.filter((d) => d.status === "imported").map((d) => d.id)));

  useEffect(() => {
    if (!rows.some((d) => ACTIVE.has(d.status))) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/downloads?titleId=${titleId}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          downloads: DownloadView[];
          qbtError: string | null;
        };
        setRows(data.downloads);
        setQbtError(data.qbtError);
        const newlyImported = data.downloads.some(
          (d) => d.status === "imported" && !importedIds.current.has(d.id),
        );
        for (const d of data.downloads) {
          if (d.status === "imported") importedIds.current.add(d.id);
        }
        if (newlyImported) router.refresh();
      } catch {
        setQbtError("Сеть недоступна");
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [rows, titleId, router]);

  async function remove(id: number) {
    if (!window.confirm("Удалить загрузку? Раздача будет удалена из qBittorrent.")) return;
    try {
      const res = await fetch(`/api/downloads/${id}`, { method: "DELETE" });
      if (res.ok) {
        setRows((prev) => prev.filter((d) => d.id !== id));
        router.refresh();
      }
    } catch {
      setQbtError("Сеть недоступна");
    }
  }

  if (rows.length === 0) return null;

  return (
    <section className={styles.block} data-testid="downloads-block">
      <h2>Загрузки</h2>
      {qbtError && <p className={styles.error}>{qbtError}</p>}
      <ul className={styles.downloadList}>
        {rows.map((d) => (
          <li key={d.id} className={styles.downloadRow}>
            <span className={styles.downloadTitle}>{d.releaseTitle || `Загрузка #${d.id}`}</span>
            <span>
              {STATUS_RU[d.status]}
              {d.status === "downloading" && ` ${Math.round(d.progress * 100)}%`}
            </span>
            {d.status === "downloading" && (
              <span className={styles.progressTrack}>
                <span
                  className={styles.progressFill}
                  style={{ width: `${Math.round(d.progress * 100)}%` }}
                />
              </span>
            )}
            {d.error && <span className={styles.error}>{d.error}</span>}
            <button type="button" className={styles.danger} onClick={() => remove(d.id)}>
              Удалить
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
