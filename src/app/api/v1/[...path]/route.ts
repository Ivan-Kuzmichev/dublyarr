import { getDb } from '@/lib/db/client';
import { handleApi } from '@/lib/api/router';
import { getQbit } from '@/lib/qbit';
import { logDir } from '@/lib/log-read';
import { appVersion } from '@/lib/version';
import { todayIso } from '@/lib/dates';

// API для автоматизации и отладки: токен, только локальная сеть (src/lib/api/*).
export const dynamic = 'force-dynamic';

async function handle(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const db = getDb();
  const url = new URL(req.url);
  let body: unknown = undefined;
  if (req.method !== 'GET' && req.method !== 'DELETE') {
    const text = await req.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        return Response.json({ error: 'Тело запроса — JSON' }, { status: 400 });
      }
    }
  }
  const r = await handleApi(
    db,
    {
      method: req.method,
      path: (await params).path,
      query: url.searchParams,
      body,
      headers: {
        authorization: req.headers.get('authorization'),
        forwardedFor: req.headers.get('x-forwarded-for'),
        realIp: req.headers.get('x-real-ip'),
        forwarded: req.headers.get('forwarded'),
      },
    },
    { qbit: getQbit(db), logDir: logDir(), today: todayIso(), now: Date.now(), version: appVersion() },
  );
  return Response.json(r.body, { status: r.status });
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
