import { getTitle, listActiveDownloads, listHistory } from "@dublyarr/core/db";
import { getDb } from "@/server/db";
import { ActivityView } from "./ActivityView";

export const dynamic = "force-dynamic";

export default function ActivityPage() {
  const db = getDb();
  const active = listActiveDownloads(db).map((d) => ({
    id: d.id,
    titleRu: getTitle(db, d.titleId)?.titleRu ?? "—",
    releaseTitle: d.releaseTitle,
    status: d.status,
    progress: d.progress,
    error: d.error,
  }));
  const history = listHistory(db, 50, 0).map((h) => ({
    id: h.id,
    kind: h.kind,
    message: h.message,
    createdAt: h.createdAt,
  }));
  return <ActivityView initialActive={active} initialHistory={history} />;
}
