"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./tracking.module.css";

export interface FileView {
  id: number;
  path: string;
  size: number;
  quality: string;
  voiceover: string;
}

export function FilesList({ files }: { files: FileView[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function remove(id: number) {
    if (!window.confirm("Удалить файл с диска?")) return;
    setError(null);
    try {
      const res = await fetch(`/api/files/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError(`Ошибка ${res.status}`);
        return;
      }
      router.refresh();
    } catch {
      setError("Сеть недоступна");
    }
  }

  if (files.length === 0) return null;

  return (
    <section className={styles.block} data-testid="files-list">
      <h2>Файлы</h2>
      {error && <p className={styles.error}>{error}</p>}
      <ul className={styles.downloadList}>
        {files.map((f) => (
          <li key={f.id} className={styles.downloadRow}>
            <span className={styles.downloadTitle}>{f.path}</span>
            <span>
              {(f.size / 2 ** 30).toFixed(2)} ГБ · {f.quality || "—"} · {f.voiceover || "—"}
            </span>
            <button type="button" className={styles.danger} onClick={() => remove(f.id)}>
              Удалить
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
