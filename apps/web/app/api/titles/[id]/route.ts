import { NextResponse } from "next/server";
import {
  deleteTitle,
  getPreset,
  getTitle,
  updateTitle,
  type MonitorRule,
  type TitlePatch,
} from "@dublyarr/core/db";
import { getDb } from "@/server/db";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const MONITOR_RULES = new Set(["all", "future_only", "manual"]);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const db = getDb();
  if (!getTitle(db, id)) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  const body = (await req.json()) as Record<string, unknown>;
  const patch: TitlePatch = {};
  if (typeof body.voiceover === "string" && body.voiceover.trim()) {
    patch.voiceover = body.voiceover.trim();
  }
  if (body.qualityPresetId !== undefined) {
    const presetId = Number(body.qualityPresetId);
    if (!getPreset(db, presetId)) {
      return NextResponse.json({ error: "Пресет не найден" }, { status: 400 });
    }
    patch.qualityPresetId = presetId;
  }
  if (body.monitorRule !== undefined) {
    if (!MONITOR_RULES.has(String(body.monitorRule))) {
      return NextResponse.json({ error: "Некорректный monitor_rule" }, { status: 400 });
    }
    patch.monitorRule = body.monitorRule as MonitorRule;
  }
  return NextResponse.json(updateTitle(db, id, patch));
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  deleteTitle(getDb(), id);
  return NextResponse.json({ ok: true });
}
