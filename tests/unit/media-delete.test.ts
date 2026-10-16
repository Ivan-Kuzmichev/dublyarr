import { expect, test } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deleteMediaFile } from '@/lib/retention';

const put = (root: string, rel: string, body = 'x') => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), body);
};

test('после удаления последней серии папки сериала уходят, даже если Synology и macOS оставили служебные файлы (@eaDir, .DS_Store, ._*)', async () => {
  const media = mkdtempSync(path.join(tmpdir(), 'dy-media-'));
  put(media, 'Чёрный клевер (2017)/Season 01/Чёрный клевер S01E01 [AniDUB 1080p].mkv');
  put(media, 'Чёрный клевер (2017)/Season 01/._Чёрный клевер S01E01 [AniDUB 1080p].mkv');
  put(media, 'Чёрный клевер (2017)/Season 01/@eaDir/Чёрный клевер S01E01 [AniDUB 1080p].mkv/SYNOVIDEO_VIDEO_SCREENSHOT.jpg');
  put(media, 'Чёрный клевер (2017)/@eaDir/.DS_Store@SynoResource');
  put(media, 'Чёрный клевер (2017)/.DS_Store');
  put(media, 'Чёрный клевер (2017)/Thumbs.db');
  put(media, '.DS_Store'); // корень медиатеки не трогаем
  expect(await deleteMediaFile(media, 'Чёрный клевер (2017)/Season 01/Чёрный клевер S01E01 [AniDUB 1080p].mkv')).toBe(true);
  expect(existsSync(path.join(media, 'Чёрный клевер (2017)'))).toBe(false);
  expect(existsSync(path.join(media, '.DS_Store'))).toBe(true);
});

test('в папке есть что-то кроме служебного (другая серия, субтитры, обложка) — папка и это остаются', async () => {
  const media = mkdtempSync(path.join(tmpdir(), 'dy-media-'));
  put(media, 'Фонари (2026)/Season 01/Фонари S01E01.mkv');
  put(media, 'Фонари (2026)/Season 01/.DS_Store');
  put(media, 'Фонари (2026)/poster.jpg');
  put(media, 'Фонари (2026)/@eaDir/x');
  await deleteMediaFile(media, 'Фонари (2026)/Season 01/Фонари S01E01.mkv');
  expect(existsSync(path.join(media, 'Фонари (2026)/Season 01'))).toBe(false);
  expect(existsSync(path.join(media, 'Фонари (2026)/poster.jpg'))).toBe(true);
  expect(existsSync(path.join(media, 'Фонари (2026)/@eaDir/x'))).toBe(true); // папка осталась — её служебное не трогаем
});
