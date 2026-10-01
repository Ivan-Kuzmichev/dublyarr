import { NextResponse, type NextRequest } from 'next/server';

// Быстрый фильтр без БД: нет cookie сеанса — на вход. Настоящая проверка сеанса — в requireSession().
const PUBLIC = [/^\/login/, /^\/setup/, /^\/_next\//, /^\/favicon/, /^\/api\/health$/, /^\/api\/v1\//]; // API — свой доступ по токену

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname)) || req.cookies.has('dy_session')) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
