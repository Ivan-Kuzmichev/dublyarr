import { getSetting, type Db } from "@dublyarr/core/db";
import { QbtClient } from "@dublyarr/core/qbittorrent";

/** null — qBittorrent не настроен (нет URL). */
export function qbtFromSettings(db: Db): QbtClient | null {
  const url = getSetting(db, "qbit_url");
  if (!url) return null;
  return new QbtClient({
    url,
    username: getSetting(db, "qbit_username") ?? "",
    password: getSetting(db, "qbit_password") ?? "",
  });
}
