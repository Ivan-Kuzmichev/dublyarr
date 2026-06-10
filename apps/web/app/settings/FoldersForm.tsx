"use client";

import { useState } from "react";
import { DEFAULT_NAMING_MOVIE, DEFAULT_NAMING_TV } from "@dublyarr/core/naming";
import styles from "./settings.module.css";

type Values = Record<
  "library_movies" | "library_tv" | "staging_dir" | "naming_tv" | "naming_movie",
  string | null
>;

const FIELDS = [
  { key: "library_movies", label: "Папка фильмов", placeholder: "/media/movies" },
  { key: "library_tv", label: "Папка сериалов", placeholder: "/media/tv" },
  {
    key: "staging_dir",
    label: "Папка загрузок (staging)",
    placeholder: "пусто — папка qBittorrent по умолчанию",
  },
  { key: "naming_tv", label: "Шаблон имени серии", placeholder: DEFAULT_NAMING_TV },
  { key: "naming_movie", label: "Шаблон имени фильма", placeholder: DEFAULT_NAMING_MOVIE },
] as const;

export function FoldersForm({ initial }: { initial: Values }) {
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
    <div className={styles.card} data-testid="folders-form">
      {FIELDS.map((f) => (
        <label key={f.key} className={styles.field}>
          <span>{f.label}</span>
          <input
            type="text"
            placeholder={f.placeholder}
            value={values[f.key] ?? ""}
            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
          />
        </label>
      ))}
      <p className={styles.muted}>
        Токены шаблонов: {"{Show} {Year} {ss} {ee} {Quality} {VO}"}. Пустой шаблон —
        значение по умолчанию из подсказки.
      </p>
      <div className={styles.actions}>
        <button onClick={save}>Сохранить</button>
      </div>
      {status && <p className={status === "Сохранено" ? styles.ok : styles.err}>{status}</p>}
    </div>
  );
}
