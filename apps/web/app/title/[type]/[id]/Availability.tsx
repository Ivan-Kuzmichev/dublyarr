import { getSetting } from "@dublyarr/core/db";
import { searchJackett } from "@dublyarr/core/jackett";
import {
  compressSeasons,
  parseRelease,
  summarizeStudioAvailability,
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
        Настройте Jackett в <a href="/settings">настройках</a>, чтобы видеть озвучки.
      </p>
    );
  }

  let rows;
  try {
    const releases = (await searchJackett({ url, apiKey }, query)).map(parseRelease);
    rows = summarizeStudioAvailability(releases);
  } catch (e) {
    return (
      <p className={styles.muted}>
        Jackett недоступен: {e instanceof Error ? e.message : String(e)}
      </p>
    );
  }

  if (rows.length === 0) return <p className={styles.muted}>Раздач не найдено.</p>;

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
