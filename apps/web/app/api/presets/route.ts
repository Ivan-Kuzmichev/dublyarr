import { NextResponse } from "next/server";
import { createPreset, listPresets, type PresetInput } from "@dublyarr/core/db";
import { getDb } from "@/server/db";

export async function GET() {
  return NextResponse.json(listPresets(getDb()));
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<PresetInput>;
  const input: PresetInput = {
    name: typeof body.name === "string" ? body.name : "",
    allowed: Array.isArray(body.allowed) ? body.allowed.filter((k) => typeof k === "string") : [],
    preferred: typeof body.preferred === "string" ? body.preferred : "",
    upgradeEnabled: body.upgradeEnabled === true,
  };
  const r = createPreset(getDb(), input);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json(r.preset, { status: 201 });
}
