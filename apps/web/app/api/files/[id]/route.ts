import { unlinkSync } from "node:fs";
import { NextResponse } from "next/server";
import { deleteFileRecord } from "@dublyarr/core/db";
import { getDb } from "@/server/db";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  }
  const row = deleteFileRecord(getDb(), numId);
  if (row) {
    try {
      unlinkSync(row.path);
    } catch {
      // файла уже нет на диске — запись всё равно удалена
    }
  }
  return NextResponse.json({ ok: true });
}
