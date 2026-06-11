import { getSetting } from "@dublyarr/core/db";
import { searchJackett, type JackettRelease } from "@dublyarr/core/jackett";
import {
  compressSeasons,
  parseRelease,
  summarizeStudioAvailability,
  type ParsedRelease,
} from "@dublyarr/core/parser";
import { getDb } from "@/server/db";
import styles from "./title.module.css";

export async function Availability({ query }: { query: string }) {
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
  if (rows.length === 0) {
    return <p className={styles.muted}>Озвучки в найденных раздачах не распознаны.</p>;
  }

  return (
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
  );
}
