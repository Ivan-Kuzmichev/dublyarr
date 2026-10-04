import { titleHref } from './title-href';
import { and, desc, eq, isNull, like } from 'drizzle-orm';
import type { Db } from './db/client';
import { notificationDeliveries, notifications, releases, sources, titles, type Download, type EpisodeRef, type WantedState } from './db/schema';
import { notify } from './notify';
import { getTelegramSettings, type InlineButton } from './telegram';
import { formatShortDate, todayIso } from './dates';

// События для Telegram (spec §12): тексты и ключи от повторов.

const pad = (n: number) => String(n).padStart(2, '0');
const HOUR = 3_600_000;

/** «S01E03», «S01E01–E03», «S01E01, E04». */
export function codeRange(eps: EpisodeRef[]): string {
  const s = [...eps].sort((a, b) => a.season - b.season || a.number - b.number);
  if (!s.length) return '';
  if (s.length === 1 && s[0].season === 0 && s[0].number === 0) return 'фильм';
  if (s.length === 1) return `S${pad(s[0].season)}E${pad(s[0].number)}`;
  const oneSeason = s.every((e) => e.season === s[0].season);
  const run = oneSeason && s.every((e, i) => i === 0 || e.number === s[i - 1].number + 1);
  if (run) return `S${pad(s[0].season)}E${pad(s[0].number)}–E${pad(s.at(-1)!.number)}`;
  return s.map((e, i) => (i === 0 || !oneSeason ? `S${pad(e.season)}E${pad(e.number)}` : `E${pad(e.number)}`)).join(', ');
}

const titleOf = (db: Db, id: number) => db.select().from(titles).where(eq(titles.id, id)).get();

/** Кнопка-ссылка на страницу Dublyarr, если задан его адрес. */
export function linkButton(db: Db, path: string, text = 'Открыть'): InlineButton[][] {
  const base = getTelegramSettings(db)?.baseUrl?.replace(/\/+$/, '');
  return base ? [[{ text, url: `${base}${path}` }]] : [];
}

/** Пока идёт импорт (пересборка пака — проходами, несколько паков сериала), «скачано» копится и уходит одним сообщением через 5 мин затишья. */
const IMPORT_QUIET = 5 * 60_000;

export function notifyImported(db: Db, d: Download, eps: EpisodeRef[], now = Date.now()) {
  const t = titleOf(db, d.titleId);
  if (!t || !eps.length) return;
  const upgrade = !!d.note?.startsWith('Улучшение');
  const what = d.note ? d.note.replace(/^Улучшение/, 'Улучшено') : [d.studioLabel, d.resolution ? `${d.resolution}p` : null].filter(Boolean).join(' ');
  const group = `import:${t.id}:${upgrade ? 'up' : 'new'}`;
  const text = (all: EpisodeRef[], labels: string[]) => `📥 ${t.nameRu}${t.kind === 'movie' ? '' : ` · ${codeRange(all)}`}${labels.length ? ` — ${labels.join(', ')}` : ''}`;
  // открытая группа: событие сериала, которое ещё никому не ушло, — дополнить и отложить отправку
  const open = db
    .select()
    .from(notifications)
    .where(and(like(notifications.key, `${group}:%`), isNull(notifications.sentAt)))
    .orderBy(desc(notifications.id))
    .get();
  if (open) {
    const ref = (open.ref ?? {}) as { eps?: EpisodeRef[]; labels?: string[] };
    const all = [...new Map([...(ref.eps ?? []), ...eps].map((e) => [`${e.season}:${e.number}`, e])).values()].sort((a, b) => a.season - b.season || a.number - b.number);
    const labels = [...new Set([...(ref.labels ?? []), ...(what ? [what] : [])])];
    db.update(notifications).set({ text: text(all, labels), ref: { ...ref, eps: all, labels } }).where(eq(notifications.id, open.id)).run();
    db.update(notificationDeliveries)
      .set({ nextAt: now + IMPORT_QUIET })
      .where(and(eq(notificationDeliveries.notificationId, open.id), isNull(notificationDeliveries.sentAt)))
      .run();
    return;
  }
  const labels = what ? [what] : [];
  notify(db, { key: `${group}:${now}`, kind: 'downloaded', text: text(eps, labels), buttons: linkButton(db, titleHref(t)), ref: { eps, labels }, delayMs: IMPORT_QUIET }, now);
}

export function notifyStalled(db: Db, d: Download, now = Date.now()) {
  const t = titleOf(db, d.titleId);
  if (t) notify(db, { key: `stalled:${d.id}`, kind: 'stuck', text: `⏳ Застряла: ${t.nameRu} · ${codeRange(d.episodes)} — нет сидов больше суток`, buttons: linkButton(db, '/activity') }, now);
}

export function notifyGone(db: Db, d: Download, now = Date.now()) {
  const t = titleOf(db, d.titleId);
  if (t) notify(db, { key: `gone:${d.id}`, kind: 'stuck', text: `⚠️ Раздача пропала из qBittorrent: ${t.nameRu} · ${codeRange(d.episodes)}`, buttons: linkButton(db, '/activity') }, now);
}

/** Серия перешла в «нужен ответ» (кнопки «Это он» / «Не тот сериал») или впервые ждёт озвучку. */
export function notifyWanted(db: Db, w: Pick<WantedState, 'titleId' | 'season' | 'number' | 'state' | 'reason' | 'releaseId' | 'until'>, prev: WantedState['state'] | null, now = Date.now()) {
  if (prev === w.state) return;
  const t = titleOf(db, w.titleId);
  if (!t) return;
  const code = codeRange([{ season: w.season, number: w.number }]);
  if (w.state === 'ask' && w.releaseId) {
    const r = db.select().from(releases).where(eq(releases.id, w.releaseId)).get();
    if (!r) return;
    notify(
      db,
      {
        key: `ask:${w.titleId}:${w.season}:${w.number}:${r.id}`,
        kind: 'ask',
        text: `❓ ${t.nameRu}${t.kind === 'movie' ? '' : ` · ${code}`}: ${w.reason}\n${r.title}`,
        buttons: [
          [
            { text: 'Это он', data: `m:${r.id}` },
            { text: t.kind === 'movie' ? 'Не тот фильм' : 'Не тот сериал', data: `r:${r.id}` },
          ],
          ...linkButton(db, t.kind === 'movie' ? `/search/${t.tmdbId}?type=movie` : `/search/${t.tmdbId}?s=${w.season}&e=${w.number}`),
        ],
        ref: { releaseId: r.id, titleId: w.titleId },
      },
      now,
    );
  }
  if (w.state === 'waiting' && prev === null)
    notify(
      db,
      {
        key: `wait:${w.titleId}:${w.season}:${w.number}`,
        kind: 'original',
        text: `🕐 Вышла ${t.nameRu} · ${code} в оригинале${w.until ? ` — озвучку ждём до ${formatShortDate(w.until, todayIso())}` : ''}`,
      },
      now,
    );
}

/** Источник не отвечает больше часа — одно сообщение; снова отвечает — одно. */
export function checkSourcesDown(db: Db, now = Date.now()) {
  for (const s of db.select().from(sources).all()) {
    if (s.failingSince && !s.downNotified && now - s.failingSince > HOUR) {
      const since = new Date(s.failingSince).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      notify(db, { key: `down:${s.id}:${s.failingSince}`, kind: 'source-down', text: `🔌 ${s.name} не отвечает с ${since}` }, now);
      db.update(sources).set({ downNotified: true }).where(eq(sources.id, s.id)).run();
    } else if (!s.failingSince && s.downNotified) {
      notify(db, { key: `up:${s.id}:${now}`, kind: 'source-down', text: `✅ ${s.name} снова отвечает` }, now);
      db.update(sources).set({ downNotified: false }).where(eq(sources.id, s.id)).run();
    }
  }
}

/** Заметки «Сегодня» (новый сезон) — туда же. */
export function notifyNotice(db: Db, noticeId: number, titleId: number, text: string, now = Date.now()) {
  const t = titleOf(db, titleId);
  if (t) notify(db, { key: `notice:${noticeId}`, kind: 'downloaded', text: `🗓 ${t.nameRu}: ${text}`, buttons: linkButton(db, titleHref(t)) }, now);
}

/** Сводка «ждёт подтверждения» (старые копии, уборка) — не чаще раза в сутки. */
export function notifyPendingConfirm(db: Db, what: 'old-copies' | 'cleanup' | 'retention', text: string, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  const page = { 'old-copies': '/old-copies', cleanup: '/cleanup', retention: '/storage' }[what];
  // подтвердить удаление может тот, у кого «Хранилище», а не «Ответы на вопросы»
  notify(db, { key: `${what}:${day}`, kind: 'ask', text, buttons: linkButton(db, page, 'Посмотреть список'), need: 'storage' }, now);
}
