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
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setRows(initial);
  }
  const [qbtError, setQbtError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const importedIds = useRef(new Set(initial.filter((d) => d.status === "imported").map((d) => d.id)));
  const deletedIds = useRef(new Set<number>());

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
        setRows(data.downloads.filter((d) => !deletedIds.current.has(d.id)));
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

  async function remove(d: DownloadView) {
    const msg =
      d.status === "imported"
        ? "Удалить запись о загрузке?"
        : "Удалить загрузку? Раздача и её файлы будут удалены из qBittorrent.";
    if (!window.confirm(msg)) return;
    setQbtError(null);
    setRemovingId(d.id);
    try {
      const res = await fetch(`/api/downloads/${d.id}`, { method: "DELETE" });
      if (res.ok) {
        deletedIds.current.add(d.id);
        setRows((prev) => prev.filter((r) => r.id !== d.id));
        router.refresh();
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setQbtError(body.error ?? `Ошибка ${res.status}`);
      }
    } catch {
      setQbtError("Сеть недоступна");
    } finally {
      setRemovingId(null);
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
            <button type="button" className={styles.danger} disabled={removingId === d.id} onClick={() => remove(d)}>
              Удалить
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
