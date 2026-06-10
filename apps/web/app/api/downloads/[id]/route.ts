import { NextResponse } from "next/server";
import { deleteDownload, getDownload } from "@dublyarr/core/db";
import { getDb } from "@/server/db";
import { qbtFromSettings } from "@/server/qbt";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  }
  const db = getDb();
  const download = getDownload(db, numId);
  if (!download) return NextResponse.json({ ok: true });

  if (download.qbitHash && download.status !== "imported") {
    const qbt = qbtFromSettings(db);
    if (qbt) {
      try {
        await qbt.deleteTorrent(download.qbitHash, true);
      } catch {
        // qBittorrent недоступен — строку всё равно удаляем
      }
    }
  }
  deleteDownload(db, numId);
  return NextResponse.json({ ok: true });
}
