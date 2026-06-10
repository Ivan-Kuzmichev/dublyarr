import { NextResponse } from "next/server";
import {
  getTitle,
  listActiveDownloads,
  listHistory,
  type Download,
} from "@dublyarr/core/db";
import { pollAll } from "@dublyarr/core/poll";
import { getDb } from "@/server/db";
import { qbtFromSettings } from "@/server/qbt";

function withTitle(db: ReturnType<typeof getDb>, d: Download) {
  return { ...d, titleRu: getTitle(db, d.titleId)?.titleRu ?? "—" };
}

export async function GET() {
  const db = getDb();
  const qbt = qbtFromSettings(db);
  let qbtError: string | null = null;
  let active: Download[];
  if (qbt) {
    const res = await pollAll(db, qbt);
    active = res.active;
    qbtError = res.qbtError;
  } else {
    active = listActiveDownloads(db);
  }
  return NextResponse.json({
    active: active.map((d) => withTitle(db, d)),
    history: listHistory(db, 50, 0),
    qbtError,
  });
}
