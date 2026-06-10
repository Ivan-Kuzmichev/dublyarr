import { NextResponse } from "next/server";
import { searchJackett } from "@dublyarr/core/jackett";
import { getSetting } from "@dublyarr/core/db";
import { getDb } from "@/server/db";
import { qbtFromSettings } from "@/server/qbt";

export async function POST(req: Request) {
  const { service } = (await req.json()) as { service: "tmdb" | "jackett" | "qbit" };
  const db = getDb();
  try {
    if (service === "tmdb") {
      const key = getSetting(db, "tmdb_api_key") ?? "";
      const res = await fetch(
        `https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(key)}`,
      );
      if (!res.ok) throw new Error(`TMDb ${res.status}`);
    } else if (service === "qbit") {
      const qbt = qbtFromSettings(db);
      if (!qbt) throw new Error("qBittorrent не настроен");
      await qbt.version();
    } else {
      await searchJackett(
        {
          url: getSetting(db, "jackett_url") ?? "",
          apiKey: getSetting(db, "jackett_api_key") ?? "",
        },
        "test",
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
