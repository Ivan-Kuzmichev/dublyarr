import { listPresets, listTrackedTitles } from "@dublyarr/core/db";
import { qualityLabel } from "@dublyarr/core/quality";
import { posterUrl } from "@dublyarr/core/tmdb";
import { getDb } from "@/server/db";
import { PosterCard } from "@/components/PosterCard";
import styles from "./tracked.module.css";

export const dynamic = "force-dynamic";

const STATUS_RU: Record<string, string> = {
  "Returning Series": "выходит",
  Ended: "завершён",
  Canceled: "закрыт",
  "In Production": "в производстве",
  Released: "вышел",
  "Post Production": "постпродакшн",
  Planned: "анонсирован",
};

export default function TrackedPage() {
  const db = getDb();
  const titles = listTrackedTitles(db);
  const presetLabel = new Map(
    listPresets(db).map((p) => [p.id, qualityLabel(p.preferred)]),
  );
  const tv = titles.filter((t) => t.type === "tv");
  const movies = titles.filter((t) => t.type === "movie");

  if (titles.length === 0) {
    return (
      <>
        <h1>Отслеживаемое</h1>
        <p className={styles.empty}>
          Пока пусто. Найдите фильм или сериал через «Поиск» и добавьте в отслеживание.
        </p>
      </>
    );
  }

  const section = (items: typeof titles) => (
    <div className={styles.grid}>
      {items.map((t) => (
        <PosterCard
          key={t.id}
          href={`/title/${t.type}/${t.tmdbId}`}
          title={t.titleRu}
          subtitle={`${t.year} · ${STATUS_RU[t.tmdbStatus ?? ""] ?? t.tmdbStatus ?? "—"}`}
          posterUrl={posterUrl(t.posterPath)}
          topLeft={{ text: t.type === "tv" ? "TV" : "Фильм", color: "var(--accent)" }}
          topRight={{ text: presetLabel.get(t.qualityPresetId) ?? "—" }}
          bottomLeft={{
            text: t.voiceover === "any" ? "Любая" : t.voiceover,
            color: "var(--ok)",
          }}
          bottomRight={{ text: "⏳" }}
        />
      ))}
    </div>
  );

  return (
    <>
      <h1>Отслеживаемое</h1>
      {tv.length > 0 && (
        <>
          <h2 className={styles.section}>Сериалы</h2>
          {section(tv)}
        </>
      )}
      {movies.length > 0 && (
        <>
          <h2 className={styles.section}>Фильмы</h2>
          {section(movies)}
        </>
      )}
    </>
  );
}
