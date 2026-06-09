import { getSetting } from "@dublyarr/core/db";
import { posterUrl, searchMulti } from "@dublyarr/core/tmdb";
import { getDb } from "@/server/db";
import { PosterCard } from "@/components/PosterCard";
import styles from "./search.module.css";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const apiKey = getSetting(getDb(), "tmdb_api_key");

  let results = null;
  let error = null;
  if (q && apiKey) {
    try {
      results = await searchMulti(q, apiKey);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  return (
    <>
      <form className={styles.searchBox} action="/search" method="get">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Название фильма или сериала"
          autoFocus
        />
      </form>
      {!apiKey && (
        <p className={styles.hint}>
          Укажите TMDb API ключ в <a href="/settings">настройках</a>.
        </p>
      )}
      {error && <p className={styles.hint}>Ошибка TMDb: {error}</p>}
      {results && results.length === 0 && <p className={styles.hint}>Ничего не найдено.</p>}
      {results && results.length > 0 && (
        <div className={styles.grid}>
          {results.map((r) => (
            <PosterCard
              key={`${r.type}-${r.id}`}
              href={`/title/${r.type}/${r.id}`}
              title={r.title}
              subtitle={`${r.year} · ${r.type === "tv" ? "сериал" : "фильм"}`}
              posterUrl={posterUrl(r.posterPath)}
              typeBadge={r.type === "tv" ? "TV" : "Фильм"}
              ratingBadge={r.rating ? r.rating.toFixed(1) : undefined}
            />
          ))}
        </div>
      )}
      {results && (
        <p className={styles.hint}>Клик по карточке → страница тайтла.</p>
      )}
    </>
  );
}
