import { NextResponse } from "next/server";
import { deletePreset, updatePreset, type PresetInput } from "@dublyarr/core/db";
import { getDb } from "@/server/db";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const body = (await req.json()) as Partial<PresetInput>;
  const input: PresetInput = {
    name: typeof body.name === "string" ? body.name : "",
    allowed: Array.isArray(body.allowed) ? body.allowed.filter((k) => typeof k === "string") : [],
    preferred: typeof body.preferred === "string" ? body.preferred : "",
    upgradeEnabled: body.upgradeEnabled === true,
  };
  const r = updatePreset(getDb(), id, input);
  if (!r.ok) {
    const status = r.error === "Пресет не найден" ? 404 : 400;
    return NextResponse.json({ error: r.error }, { status });
  }
  return NextResponse.json(r.preset);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const r = deletePreset(getDb(), id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json({ ok: true });
}
