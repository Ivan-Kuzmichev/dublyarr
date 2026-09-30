import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

// Постеры и фоны TMDB идут через Dublyarr: браузеру не нужен доступ к image.tmdb.org, файлы кэшируются на диске.

import { IMAGE_SIZES, type ImageSize } from './image-url';

export { IMAGE_SIZES, imageUrl, POSTER_COLORS, posterColor, type ImageSize } from './image-url';
const FILE = /^[A-Za-z0-9_-]{1,64}\.(jpg|png)$/;

export const isValidImageRequest = (size: string, file: string): size is ImageSize =>
  (IMAGE_SIZES as readonly string[]).includes(size) && FILE.test(file);

const typeOf = (file: string) => (file.endsWith('.png') ? 'image/png' : 'image/jpeg');

export async function loadImage(
  size: string,
  file: string,
  o: { cacheDir: string; baseUrl?: string; fetchImpl?: typeof fetch },
): Promise<{ status: 200; body: Buffer; contentType: string } | { status: 400 | 404 }> {
  if (!isValidImageRequest(size, file)) return { status: 400 };
  const dir = path.join(o.cacheDir, size);
  const target = path.join(dir, file);
  try {
    return { status: 200, body: await readFile(target), contentType: typeOf(file) };
  } catch {
    // в кэше нет — качаем
  }
  const base = (o.baseUrl ?? 'https://image.tmdb.org/t/p').replace(/\/+$/, '');
  try {
    const res = await (o.fetchImpl ?? fetch)(`${base}/${size}/${file}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { status: 404 };
    const body = Buffer.from(await res.arrayBuffer());
    await mkdir(dir, { recursive: true });
    const tmp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, body);
    await rename(tmp, target);
    return { status: 200, body, contentType: typeOf(file) };
  } catch {
    return { status: 404 };
  }
}
