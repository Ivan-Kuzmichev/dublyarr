import path from 'node:path';
import { getCurrentSession } from '@/lib/auth/current';
import { getConfig } from '@/lib/config';
import { getDb } from '@/lib/db/client';
import { loadImage } from '@/lib/images';
import { getTmdbSettings, proxiedFetch } from '@/lib/tmdb';

export async function GET(_req: Request, { params }: { params: Promise<{ size: string; file: string }> }) {
  if (!(await getCurrentSession())) return new Response(null, { status: 401 });
  const { size, file } = await params;
  const r = await loadImage(size, file, {
    cacheDir: path.join(getConfig().dataDir, 'cache', 'images'),
    baseUrl: process.env.TMDB_IMAGE_BASE_URL,
    fetchImpl: proxiedFetch(getTmdbSettings(getDb())?.proxy),
  });
  if (r.status !== 200) return new Response(null, { status: r.status });
  return new Response(new Uint8Array(r.body), {
    headers: { 'content-type': r.contentType, 'cache-control': 'public, max-age=31536000, immutable' },
  });
}
