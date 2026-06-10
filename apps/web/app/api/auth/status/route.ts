import { NextResponse } from "next/server";
import { getSetting } from "@dublyarr/core/db";
import { getDb } from "@/server/db";

export async function GET() {
  const db = getDb();
  return NextResponse.json({
    hasPassword: Boolean(getSetting(db, "auth_password_hash")),
    lanBypass: getSetting(db, "auth_lan_bypass") !== "0",
  });
}
