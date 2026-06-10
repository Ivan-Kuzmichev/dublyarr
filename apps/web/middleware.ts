import { NextResponse, type NextRequest } from "next/server";
import { isPrivateIp, verifySession } from "@dublyarr/core/auth";
import { getSetting } from "@dublyarr/core/db";
import { getDb } from "@/server/db";

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/|favicon.ico|login$|api/auth/login$).*)"],
};

export function middleware(req: NextRequest) {
  const db = getDb();
  const hash = getSetting(db, "auth_password_hash");
  if (!hash) return NextResponse.next();

  const lanBypass = getSetting(db, "auth_lan_bypass") !== "0";
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  if (lanBypass && isPrivateIp(ip)) return NextResponse.next();

  const token = req.cookies.get("dublyarr_session")?.value ?? "";
  if (verifySession(token, hash)) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  }
  const login = req.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  return NextResponse.redirect(login);
}
