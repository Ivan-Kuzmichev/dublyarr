"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./activity.module.css";

export interface ActiveDownload {
  id: number;
  titleRu: string;
  releaseTitle: string;
  status: "queued" | "downloading" | "completed" | "failed" | "imported";
  progress: number;
  error: string | null;
}

export interface HistoryRow {
  id: number;
  kind: string;
  message: string;
  createdAt: string;
}

const STATUS_RU: Record<ActiveDownload["status"], string> = {
  queued: "в очереди",
  downloading: "качается",
  completed: "скачано, импорт…",
  failed: "ошибка",
  imported: "импортировано",
};

const KIND_RU: Record<string, string> = {
  search: "поиск",
  grab: "забрал",
  import: "импорт",
  upgrade: "апгрейд",
  fail: "ошибка",
  not_found: "не найдено",
};

export function ActivityView({
  initialActive,
  initialHistory,
}: {
  initialActive: ActiveDownload[];
  initialHistory: HistoryRow[];
}) {
  const [active, setActive] = useState(initialActive);
  const [history, setHistory] = useState(initialHistory);
  const [qbtError, setQbtError] = useState<string | null>(null);
  const hasActive = useRef(initialActive.length > 0);
  hasActive.current = active.length > 0;

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/activity");
        if (!res.ok) return;
        const data = (await res.json()) as {
          active: ActiveDownload[];
          history: HistoryRow[];
          qbtError: string | null;
        };
        setActive(data.active);
        setHistory(data.history);
        setQbtError(data.qbtError);
      } catch {
        setQbtError("Сеть недоступна");
      }
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      <h1>Активность</h1>
      {qbtError && <p className={styles.error}>{qbtError}</p>}

      <h2>Загрузки</h2>
      {active.length === 0 ? (
        <p className={styles.muted}>Активных загрузок нет.</p>
      ) : (
        <ul className={styles.list} data-testid="active-list">
          {active.map((d) => (
            <li key={d.id} className={styles.row}>
              <span className={styles.title}>{d.titleRu}</span>
              <span className={styles.rel}>{d.releaseTitle}</span>
              <span>
                {STATUS_RU[d.status]}
                {d.status === "downloading" && ` ${Math.round(d.progress * 100)}%`}
              </span>
              {d.status === "downloading" && (
                <span className={styles.track}>
                  <span className={styles.fill} style={{ width: `${Math.round(d.progress * 100)}%` }} />
                </span>
              )}
              {d.error && <span className={styles.error}>{d.error}</span>}
            </li>
          ))}
        </ul>
      )}

      <h2>История</h2>
      {history.length === 0 ? (
        <p className={styles.muted}>Пока пусто.</p>
      ) : (
        <ul className={styles.list} data-testid="history-list">
          {history.map((h) => (
            <li key={h.id} className={styles.histRow}>
              <span className={styles.kind}>{KIND_RU[h.kind] ?? h.kind}</span>
              <span>{h.message}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
