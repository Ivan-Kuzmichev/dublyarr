import { NextResponse } from "next/server";
import { createSession, verifyPassword } from "@dublyarr/core/auth";
import { getSetting } from "@dublyarr/core/db";
import { getDb } from "@/server/db";

const MONTH_S = 30 * 24 * 3600;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const password = typeof body.password === "string" ? body.password : "";
  const hash = getSetting(getDb(), "auth_password_hash");
  if (!hash) {
    return NextResponse.json({ error: "Пароль не установлен" }, { status: 400 });
  }
  if (!verifyPassword(password, hash)) {
    return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("dublyarr_session", createSession(hash), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MONTH_S,
  });
  return res;
}
