import { NextResponse } from "next/server";
import { getSetting } from "@dublyarr/core/db";
import { searchJackett } from "@dublyarr/core/jackett";
import { parseRelease, summarizeStudioAvailability } from "@dublyarr/core/parser";
import { getDb } from "@/server/db";

export async function GET(req: Request) {
  const query = new URL(req.url).searchParams.get("query")?.trim();
  if (!query) return NextResponse.json({ studios: [] });
  const db = getDb();
  const url = getSetting(db, "jackett_url");
  const apiKey = getSetting(db, "jackett_api_key");
  if (!url || !apiKey) return NextResponse.json({ studios: [] });
  try {
    const releases = (await searchJackett({ url, apiKey }, query)).map(parseRelease);
    const studios = [...new Set(summarizeStudioAvailability(releases).map((r) => r.studio))];
    return NextResponse.json({ studios });
  } catch {
    return NextResponse.json({ studios: [] });
  }
}
