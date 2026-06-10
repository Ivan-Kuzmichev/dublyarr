import { NextResponse } from "next/server";
import { createSession, hashPassword, verifyPassword } from "@dublyarr/core/auth";
import { getSetting, setSetting } from "@dublyarr/core/db";
import { getDb } from "@/server/db";

const MONTH_S = 30 * 24 * 3600;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const current = typeof body.current === "string" ? body.current : "";
  const next = typeof body.next === "string" ? body.next : "";

  const db = getDb();
  const stored = getSetting(db, "auth_password_hash");
  if (stored && !verifyPassword(current, stored)) {
    return NextResponse.json({ error: "Неверный текущий пароль" }, { status: 401 });
  }
  if (next && next.length < 4) {
    return NextResponse.json({ error: "Пароль слишком короткий (минимум 4 символа)" }, { status: 400 });
  }

  const newHash = next ? hashPassword(next) : "";
  setSetting(db, "auth_password_hash", newHash);

  const res = NextResponse.json({ ok: true, hasPassword: Boolean(newHash) });
  if (newHash) {
    res.cookies.set("dublyarr_session", createSession(newHash), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: MONTH_S,
    });
  } else {
    res.cookies.set("dublyarr_session", "", { httpOnly: true, path: "/", maxAge: 0 });
  }
  return res;
}
