import { NextResponse } from "next/server";
import { listDownloadsForTitle } from "@dublyarr/core/db";
import { pollTitle } from "@dublyarr/core/poll";
import { getDb } from "@/server/db";
import { qbtFromSettings } from "@/server/qbt";

export async function GET(req: Request) {
  const titleId = Number(new URL(req.url).searchParams.get("titleId"));
  if (!Number.isInteger(titleId) || titleId <= 0) {
    return NextResponse.json({ error: "Некорректный titleId" }, { status: 400 });
  }
  const db = getDb();
  const qbt = qbtFromSettings(db);
  if (!qbt) {
    return NextResponse.json({ downloads: listDownloadsForTitle(db, titleId), qbtError: null });
  }
  const { downloads, qbtError } = await pollTitle(db, qbt, titleId);
  return NextResponse.json({ downloads, qbtError });
}

