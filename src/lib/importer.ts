import { access, copyFile, link as fsLink, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

// Импорт в медиатеку: жёсткая ссылка (мгновенно, без лишнего места), иначе копия. Сначала во временное имя, потом переименование.

const NO_LINK = new Set(['EXDEV', 'EPERM', 'ENOTSUP', 'EMLINK', 'EOPNOTSUPP']);
type Fs = { link: (src: string, dst: string) => Promise<void> };

export class ImportError extends Error {}

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

/** replace: можно заменить файл по этому пути (это наш прошлый импорт той же серии); иначе чужой файл не трогаем. */
export async function importFile(src: string, mediaRoot: string, relPath: string, fsx: Fs = { link: fsLink }, opts: { replace?: boolean } = {}) {
  const root = path.resolve(mediaRoot);
  const target = path.resolve(root, relPath);
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Путь вне медиатеки');
  const taken = () => new ImportError(`Файл уже есть в медиатеке: ${relPath}`);
  if (!opts.replace && (await exists(target))) throw taken();
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.dy-${randomBytes(4).toString('hex')}.tmp`;
  let method: 'hardlink' | 'copy' = 'hardlink';
  try {
    await fsx.link(src, tmp);
  } catch (e) {
    if (!NO_LINK.has((e as NodeJS.ErrnoException).code ?? '')) throw e;
    method = 'copy';
    await copyFile(src, tmp);
  }
  try {
    if (opts.replace) await rename(tmp, target);
    else {
      // без замены: ссылка не перезаписывает существующий файл (EEXIST), временный убираем
      await fsLink(tmp, target).catch((e: NodeJS.ErrnoException) => {
        throw e.code === 'EEXIST' ? taken() : e;
      });
      await rm(tmp, { force: true });
    }
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
  return { path: target, method };
}

/** Можно ли делать жёсткие ссылки из загрузок в медиатеку (одна файловая система внутри контейнера). */
export async function checkHardlink(downloads: string, media: string): Promise<{ ok: boolean; message: string }> {
  const name = `.dublyarr-link-test-${randomBytes(4).toString('hex')}`;
  const src = path.join(downloads, name);
  const dst = path.join(media, name);
  try {
    await writeFile(src, '');
  } catch {
    return { ok: false, message: `Нет доступа к папке загрузок: ${downloads}` };
  }
  try {
    await fsLink(src, dst);
    return { ok: true, message: 'Жёсткие ссылки работают' };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? '';
    return { ok: false, message: NO_LINK.has(code) ? 'Будет копирование: папки на разных томах' : `Нет доступа к медиатеке: ${media}` };
  } finally {
    await rm(src, { force: true });
    await rm(dst, { force: true });
  }
}
