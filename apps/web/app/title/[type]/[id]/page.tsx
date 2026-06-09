import { Suspense } from "react";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getSetting } from "@dublyarr/core/db";
import { TmdbError, getDetails, posterUrl, type TmdbType } from "@dublyarr/core/tmdb";
import { getDb } from "@/server/db";
import { Availability } from "./Availability";
import styles from "./title.module.css";

export const dynamic = "force-dynamic";

export default async function TitlePage({
  params,
}: {
  params: Promise<{ type: string; id: string }>;
}) {
  const { type, id } = await params;
  if (type !== "movie" && type !== "tv") notFound();
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) notFound();
  const db = getDb();
  const apiKey = getSetting(db, "tmdb_api_key");
  if (!apiKey) {
    return <p>Укажите TMDb API ключ в <a href="/settings">настройках</a>.</p>;
  }

  let details;
  try {
    details = await getDetails(type as TmdbType, numId, apiKey);
  } catch (e) {
    if (e instanceof TmdbError && e.status === 404) notFound();
    throw e;
  }
  const poster = posterUrl(details.posterPath, 500);

  return (
    <>
      <div className={styles.hero}>
        <div className={styles.poster}>
          {poster && <Image src={poster} alt={details.title} fill sizes="180px" />}
        </div>
        <div>
          <h1 className={styles.h1}>
            {details.title}{" "}
            <span className={styles.original}>
              / {details.originalTitle} ({details.year})
            </span>
          </h1>
          <div className={styles.meta}>
            {details.type === "tv" && details.seasons != null && (
              <span className={styles.badge}>
                {details.status === "Returning Series" ? "Выходит" : details.status} ·{" "}
                {details.seasons} сезонов · {details.episodes} эпизодов
              </span>
            )}
            {details.genres.length > 0 && (
              <span className={styles.badgeMuted}>{details.genres.join(", ")}</span>
            )}
          </div>
          <p className={styles.overview}>{details.overview}</p>
        </div>
      </div>

      <h2>Доступные озвучки</h2>
      <Suspense fallback={<p className={styles.muted}>Ищу раздачи в Jackett…</p>}>
        <Availability query={details.originalTitle || details.title} />
      </Suspense>
    </>
  );
}
