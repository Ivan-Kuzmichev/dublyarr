"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./tracking.module.css";

export interface EpisodeRow {
  id: number;
  season: number;
  episode: number;
  airDate: string | null;
  nameRu: string;
  wanted: boolean;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function airLabel(airDate: string | null): string {
  if (!airDate) return "дата неизвестна";
  const today = new Date().toISOString().slice(0, 10);
  const [y, m, d] = airDate.split("-");
  const human = `${d}.${m}.${y}`;
  return airDate <= today ? `вышла ${human}` : `выйдет ${human}`;
}

export function EpisodeList({
  titleId,
  episodes,
}: {
  titleId: number;
  episodes: EpisodeRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/titles/${titleId}/episodes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  const seasons = [...new Set(episodes.map((e) => e.season))].sort((a, b) => a - b);

  return (
    <div data-testid="episode-list">
      <h2>Серии</h2>
      {error && <p className={styles.error}>{error}</p>}
      {seasons.map((season) => {
        const eps = episodes.filter((e) => e.season === season);
        const allWanted = eps.every((e) => e.wanted);
        return (
          <div key={season}>
            <div className={styles.season}>
              <h3>Сезон {season}</h3>
              <label>
                <input
                  type="checkbox"
                  checked={allWanted}
                  disabled={busy}
                  onChange={(e) => patch({ season, wanted: e.target.checked })}
                />{" "}
                все серии
              </label>
            </div>
            <div className={styles.episodes}>
              {eps.map((e) => (
                <label key={e.id} className={styles.episode}>
                  <input
                    type="checkbox"
                    checked={e.wanted}
                    disabled={busy}
                    onChange={(ev) =>
                      patch({ episodeIds: [e.id], wanted: ev.target.checked })
                    }
                  />
                  <code>
                    S{pad(e.season)}E{pad(e.episode)}
                  </code>
                  <span>{e.nameRu || "—"}</span>
                  <span className={styles.epDate}>{airLabel(e.airDate)}</span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
