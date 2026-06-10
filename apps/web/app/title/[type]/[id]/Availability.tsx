import { getSetting } from "@dublyarr/core/db";
import { searchJackett, type JackettRelease } from "@dublyarr/core/jackett";
import {
  compressSeasons,
  parseRelease,
  summarizeStudioAvailability,
  type ParsedRelease,
} from "@dublyarr/core/parser";
import { getDb } from "@/server/db";
import { DownloadButton, type GrabPayload } from "./DownloadButton";
import styles from "./title.module.css";

function formatGb(size: number): string {
  return `${(size / 2 ** 30).toFixed(2)} ГБ`;
}

function grabPayload(
  titleId: number,
  r: ParsedRelease<JackettRelease>,
): GrabPayload {
  const studios = r.parsed.voiceovers.flatMap((v) => v.studios);
  return {
    titleId,
    guid: r.guid,
    link: r.link,
    title: r.title,
    voiceoverStudio: studios[0] ?? null,
    qualitySource: r.parsed.quality.source,
    qualityResolution: r.parsed.quality.resolution,
    seasons: r.parsed.seasons,
  };
}

export async function Availability({
  query,
  titleId,
}: {
  query: string;
  titleId: number | null;
}) {
  const db = getDb();
  const url = getSetting(db, "jackett_url");
  const apiKey = getSetting(db, "jackett_api_key");
  if (!url || !apiKey) {
    return (
      <p className={styles.muted}>
        Настройте Jackett в <a href="/settings?tab=integrations">настройках</a>, чтобы видеть озвучки.
      </p>
    );
  }

  let releases: ParsedRelease<JackettRelease>[];
  try {
    releases = (await searchJackett({ url, apiKey }, query)).map(parseRelease);
  } catch (e) {
    return (
      <p className={styles.muted}>
        Jackett недоступен: {e instanceof Error ? e.message : String(e)}
      </p>
    );
  }

  const rows = summarizeStudioAvailability(releases);
  if (releases.length === 0) return <p className={styles.muted}>Раздач не найдено.</p>;

  const top = releases
    .filter((r) => r.link)
    .sort((a, b) => b.seeders - a.seeders)
    .slice(0, 30);

  return (
    <>
      {rows.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Озвучка</th><th>Тип</th><th>Сезоны</th><th>Качество</th><th>Раздач</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.studio}-${r.kind}`}>
                  <td data-label="Озвучка"><b>{r.studio}</b></td>
                  <td data-label="Тип">{r.kind}</td>
                  <td data-label="Сезоны">{compressSeasons(r.seasons)}</td>
                  <td data-label="Качество">{r.qualities.join(" · ") || "—"}</td>
                  <td data-label="Раздач">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Раздачи</h2>
      {titleId == null && (
        <p className={styles.muted}>
          Добавьте тайтл в отслеживание, чтобы скачивать раздачи.
        </p>
      )}
      {top.length === 0 ? (
        <p className={styles.muted}>Нет раздач с прямой ссылкой на скачивание.</p>
      ) : (
        <div className={styles.tableWrap} data-testid="release-list">
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Название</th><th>Озвучки</th><th>Качество</th><th>Размер</th><th>Сиды</th>
                {titleId != null && <th />}
              </tr>
            </thead>
            <tbody>
              {top.map((r) => (
                <tr key={r.guid || r.link}>
                  <td data-label="Название" className={styles.releaseTitle}>{r.title}</td>
                  <td data-label="Озвучки">
                    {[...new Set(r.parsed.voiceovers.flatMap((v) => v.studios))].join(", ") || "—"}
                  </td>
                  <td data-label="Качество">
                    {[r.parsed.quality.source, r.parsed.quality.resolution]
                      .filter(Boolean)
                      .join(" ") || "—"}
                  </td>
                  <td data-label="Размер">{formatGb(r.size)}</td>
                  <td data-label="Сиды">{r.seeders}</td>
                  {titleId != null && (
                    <td data-label="">
                      <DownloadButton payload={grabPayload(titleId, r)} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
