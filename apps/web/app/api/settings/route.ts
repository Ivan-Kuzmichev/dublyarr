import { NextResponse } from "next/server";
import { getAllSettings, setSetting, SETTING_KEYS, type SettingKey } from "@dublyarr/core/db";
import { getDb } from "@/server/db";

export async function GET() {
  return NextResponse.json(getAllSettings(getDb()));
}

export async function PUT(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  const db = getDb();
  for (const key of SETTING_KEYS) {
    const v = body[key];
    if (typeof v === "string") setSetting(db, key as SettingKey, v.trim());
  }
  return NextResponse.json({ ok: true });
}
