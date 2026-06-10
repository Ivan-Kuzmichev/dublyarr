import { Suspense } from "react";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getSetting, getTitleByTmdb, listDownloadsForTitle, listEpisodes, listFiles, listPresets } from "@dublyarr/core/db";
import { qualityKeyFor, qualityLabel } from "@dublyarr/core/quality";
import { TmdbError, getDetails, posterUrl, type TmdbType } from "@dublyarr/core/tmdb";
import { getDb } from "@/server/db";
import { Availability } from "./Availability";
import { TrackingBlock } from "./TrackingBlock";
import { EpisodeList } from "./EpisodeList";
import { DownloadsBlock } from "./DownloadsBlock";
import { FilesList } from "./FilesList";
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

  const trackedTitle = getTitleByTmdb(db, type as TmdbType, numId);
  const presets = listPresets(db).map((p) => ({ id: p.id, name: p.name }));
  const episodeRows = trackedTitle
    ? listEpisodes(db, trackedTitle.id).map((e) => ({
        id: e.id,
        season: e.season,
        episode: e.episode,
        airDate: e.airDate,
        nameRu: e.nameRu,
        wanted: e.wanted,
        fileId: e.fileId,
      }))
    : [];
  const downloadRows = trackedTitle
    ? listDownloadsForTitle(db, trackedTitle.id).map((d) => ({
        id: d.id,
        releaseTitle: d.releaseTitle,
        status: d.status,
        progress: d.progress,
        error: d.error,
      }))
    : [];
  const fileRows = trackedTitle
    ? listFiles(db, trackedTitle.id).map((f) => {
        const key = qualityKeyFor(f.qualitySource, f.qualityResolution);
        return {
          id: f.id,
          path: f.path,
          size: f.size,
          quality: key ? qualityLabel(key) : "",
          voiceover: f.voiceoverStudio ?? "",
        };
      })
    : [];

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

      <TrackingBlock
        type={type as TmdbType}
        tmdbId={numId}
        tracked={
          trackedTitle
            ? {
                id: trackedTitle.id,
                voiceover: trackedTitle.voiceover,
                qualityPresetId: trackedTitle.qualityPresetId,
                monitorRule: trackedTitle.monitorRule,
              }
            : null
        }
        presets={presets}
        searchQuery={details.originalTitle || details.title}
      />

      {trackedTitle && <DownloadsBlock titleId={trackedTitle.id} initial={downloadRows} />}

      <h2>Доступные озвучки</h2>
      <Suspense fallback={<p className={styles.muted}>Ищу раздачи в Jackett…</p>}>
        <Availability
          query={details.originalTitle || details.title}
          titleId={trackedTitle?.id ?? null}
        />
      </Suspense>

      {trackedTitle && type === "tv" && episodeRows.length > 0 && (
        <EpisodeList titleId={trackedTitle.id} episodes={episodeRows} />
      )}

      <FilesList files={fileRows} />
    </>
  );
}
