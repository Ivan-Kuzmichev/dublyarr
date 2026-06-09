import { NextResponse } from "next/server";
import { getTitle, listEpisodes, setEpisodesWanted, setSeasonWanted } from "@dublyarr/core/db";
import { getDb } from "@/server/db";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  }
  const db = getDb();
  if (!getTitle(db, id)) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  const body = (await req.json()) as Record<string, unknown>;
  if (typeof body.wanted !== "boolean") {
    return NextResponse.json({ error: "Поле wanted обязательно" }, { status: 400 });
  }
  if (Array.isArray(body.episodeIds)) {
    const ids = body.episodeIds.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    setEpisodesWanted(db, id, ids, body.wanted);
  } else if (body.season !== undefined && Number.isInteger(Number(body.season))) {
    setSeasonWanted(db, id, Number(body.season), body.wanted);
  } else {
    return NextResponse.json({ error: "Укажите episodeIds или season" }, { status: 400 });
  }
  return NextResponse.json(listEpisodes(db, id));
}
