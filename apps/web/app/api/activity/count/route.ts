import { NextResponse } from "next/server";
import { countActiveDownloads } from "@dublyarr/core/db";
import { getDb } from "@/server/db";

export async function GET() {
  return NextResponse.json({ count: countActiveDownloads(getDb()) });
}
