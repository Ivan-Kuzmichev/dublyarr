import { NextResponse } from "next/server";
import { runOneTitle } from "@dublyarr/core/tick";
import { getDb } from "@/server/db";
import { qbtFromSettings } from "@/server/qbt";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const titleId = Number(id);
  if (!Number.isInteger(titleId) || titleId <= 0) {
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  }
  const db = getDb();
  const qbt = qbtFromSettings(db);
  if (!qbt) {
    return NextResponse.json({ error: "qBittorrent не настроен" }, { status: 400 });
  }
  try {
    const ok = await runOneTitle(db, titleId, { qbt });
    if (!ok) return NextResponse.json({ error: "Тайтл не отслеживается" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ошибка поиска" },
      { status: 502 },
    );
  }
}
