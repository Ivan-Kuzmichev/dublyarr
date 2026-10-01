import Link from 'next/link';
import { titleHref } from '@/lib/title-href';
import { PageTitle } from '@/components/shell/PageTitle';
import { Card } from '@/components/ui/Card';
import { Poster } from '@/components/catalog/Poster';
import { getDb } from '@/lib/db/client';
import { todayIso } from '@/lib/dates';
import { todayData } from '@/lib/dashboard';
import { formatSpeed } from '@/lib/activity';

export const metadata = { title: 'Сегодня · Dublyarr' };
export const dynamic = 'force-dynamic';

const longDate = (iso: string) => {
  const s = new Date(`${iso}T00:00:00Z`).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function Stat({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className="flex min-w-[96px] flex-col gap-0.5 rounded-xl border border-line bg-surface px-4 py-2.5">
      <span className={`font-display text-[22px] font-semibold ${tone}`}>{n}</span>
      <span className="text-xs text-muted">{label}</span>
    </div>
  );
}

const sectionHead = (title: string, link?: { href: string; text: string }, note?: string, hint?: string) => (
  <div className="flex items-baseline justify-between gap-3">
    <h2 className="m-0 text-xl font-semibold">{title}</h2>
    {link && (
      <Link href={link.href} className="text-sm no-underline">
        {link.text}
      </Link>
    )}
    {note && <span className="font-mono text-[13px] text-progress">{note}</span>}
    {hint && <span className="text-[13px] text-muted max-lg:hidden">{hint}</span>}
  </div>
);

export default function TodayPage() {
  const today = todayIso();
  const d = todayData(getDb(), today);
  const speed = d.downloads.reduce((n, r) => n + r.speedBps, 0);
  const empty = !d.fresh.length && !d.waiting.length && !d.downloads.length && !d.week.length && !d.attention.length && !d.news.length;
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex flex-col gap-2.5">
          <span className="text-sm text-muted">{longDate(today)}</span>
          <PageTitle>Сегодня</PageTitle>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Stat n={d.fresh.filter((f) => !f.loading).length} label="новые серии" tone="" />
          <Stat n={d.waiting.length} label="ждут озвучку" tone="text-accent" />
          <Stat n={d.downloads.length} label="качаются" tone="text-progress" />
          {d.attention.length > 0 && <Stat n={d.attention.length} label="требуют внимания" tone="text-danger" />}
        </div>
      </div>

      {!d.qbitConfigured && (
        <Card tone="danger">
          <p className="m-0 text-[15px] text-text-2">
            Подключите qBittorrent в настройках — без него Dublyarr находит серии, но не качает. <Link href="/settings/download">Подключить</Link>
          </p>
        </Card>
      )}

      {empty && (
        <Card>
          <p className="m-0 text-[15px] text-muted">
            Пока тихо. Подпишитесь на сериал — новые серии будут появляться здесь. <Link href="/discover">Найти сериал</Link>
          </p>
        </Card>
      )}

      {d.fresh.length > 0 && (
        <section className="flex flex-col gap-4">
          {sectionHead('Новые серии', { href: '/calendar', text: 'Весь календарь →' })}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
            {d.fresh.map((e) => (
              <Link key={`${e.tmdbId}-${e.code}`} href={titleHref({ kind: e.movie ? 'movie' : 'series', tmdbId: e.tmdbId })} className="flex flex-col gap-3 text-text no-underline hover:text-text">
                <div className="relative h-[120px] overflow-hidden rounded-[14px] lg:h-[158px]">
                  <Poster tmdbId={e.tmdbId} name={e.title} path={e.posterPath} size="w342" className="h-full w-full" />
                  <span className="absolute top-3 left-3 rounded-md bg-bg/80 px-2 py-1 font-mono text-xs">{e.code}</span>
                  {e.quality && <span className="absolute top-3 right-3 rounded-md bg-bg/80 px-2 py-1 text-xs font-semibold">{e.quality}</span>}
                  {e.loading && (
                    <div className="absolute inset-x-0 bottom-0 h-1 bg-bg/70">
                      <div className="h-1 bg-progress" style={{ width: `${e.pct}%` }} />
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <span className="truncate text-[15px] font-semibold">
                    {e.title} <span className="font-normal text-muted">· {e.code}</span>
                  </span>
                  <span className={`text-[13px] ${e.loading ? 'text-progress' : 'text-muted'}`}>{e.state}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {(d.waiting.length > 0 || d.downloads.length > 0 || d.attention.length > 0) && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <Card className="flex flex-col gap-5 !p-6">
            {sectionHead('Ждём озвучку', undefined, undefined, 'прогноз по истории студий')}
            {d.waiting.length === 0 ? (
              <p className="m-0 text-sm text-muted">Все вышедшие серии уже в нужной озвучке.</p>
            ) : (
              d.waiting.map((w) => (
                <Link key={`${w.tmdbId}-${w.code}`} href={titleHref({ kind: w.movie ? 'movie' : 'series', tmdbId: w.tmdbId })} className="flex items-start gap-4 text-text no-underline hover:text-text">
                  <Poster tmdbId={w.tmdbId} name={w.title} path={w.posterPath} size="w185" className="h-[72px] w-12 shrink-0 rounded-lg" />
                  <div className="flex min-w-0 grow flex-col gap-2">
                    <div className="flex justify-between gap-3">
                      <span className="min-w-0 truncate text-[15px] font-semibold">
                        {w.title} <span className="font-mono text-[13px] font-normal text-muted">{w.code}</span>
                      </span>
                      <span className={`text-[13px] font-semibold whitespace-nowrap ${w.progress === null ? 'text-faint' : 'text-accent'}`}>{w.etaText}</span>
                    </div>
                    {w.progress !== null && (
                      <div className="relative h-1.5 rounded-full bg-line">
                        <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${Math.round(w.progress * 100)}%` }} />
                        {w.fallbackMark !== null && <div className="absolute -top-[3px] h-3 w-0.5 bg-text-2" style={{ left: `${Math.round(w.fallbackMark * 100)}%` }} />}
                      </div>
                    )}
                    <div className="flex justify-between gap-3 text-xs text-faint">
                      <span className="whitespace-nowrap">{w.movie ? 'Цифровой релиз' : 'Оригинал'} {w.aired}</span>
                      {w.delayText && <span className="truncate">{w.delayText}</span>}
                    </div>
                    <span className="text-[13px] leading-snug text-text-3">{w.fallbackNote || w.reason}</span>
                  </div>
                </Link>
              ))
            )}
          </Card>
          <div className="flex flex-col gap-6">
            <Card className="flex flex-col gap-[18px] !p-6">
              {sectionHead('Загрузки', undefined, speed > 0 ? `↓ ${formatSpeed(speed)}` : undefined)}
              {d.downloads.length === 0 ? (
                <p className="m-0 text-sm text-muted">Сейчас ничего не качается.</p>
              ) : (
                d.downloads.map((r) => (
                  <Link key={r.id} href="/activity" className="flex flex-col gap-2 text-text no-underline hover:text-text">
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="truncate font-medium">
                        {r.title} · {r.code}
                      </span>
                      <span className="font-mono text-xs whitespace-nowrap text-muted">{r.pct} %</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-line">
                      <div className={`h-1.5 rounded-full ${r.tone === 'danger' ? 'bg-danger' : 'bg-progress'}`} style={{ width: `${r.pct}%` }} />
                    </div>
                    <span className="text-xs text-faint">
                      {r.state}
                      {r.speed && ` · ${r.speed}`}
                    </span>
                  </Link>
                ))
              )}
            </Card>
            {d.attention.length > 0 && (
              <Card tone="danger" className="flex flex-col gap-4 !p-6">
                <h2 className="m-0 text-xl font-semibold">Требует внимания</h2>
                <div className="flex flex-col gap-2.5">
                  {d.attention.map((a) => (
                    <Link key={`${a.href}-${a.tmdbId}-${a.code}`} href={a.href} className="flex flex-col gap-0.5 rounded-xl bg-bg/40 px-3.5 py-3 text-text no-underline hover:text-text">
                      <span className="text-sm font-semibold">
                        {a.title} <span className="font-mono text-xs font-normal text-muted">{a.code}</span>
                      </span>
                      <span className="text-[13px] text-danger">{a.text}</span>
                    </Link>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>
      )}

      {d.news.length > 0 && (
        <section className="flex flex-col gap-3">
          {sectionHead('Новости')}
          <div className="flex flex-col gap-2">
            {d.news.map((n) => (
              <Link key={`${n.tmdbId}-${n.createdAt}`} href={`/series/${n.tmdbId}`} className="flex items-baseline gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-text no-underline hover:text-text">
                <span className="font-semibold">{n.title}</span>
                <span className="text-text-2">{n.text}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {d.week.length > 0 && (
        <section className="flex flex-col gap-4">
          {sectionHead('Неделя', { href: '/calendar', text: 'Календарь →' })}
          <div className="overflow-hidden rounded-2xl border border-line">
            {d.week.map((w) => (
              <Link
                key={`${w.tmdbId}-${w.code}`}
                href={titleHref({ kind: w.movie ? 'movie' : 'series', tmdbId: w.tmdbId })}
                className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 border-t border-line-soft px-4 py-3 text-sm text-text no-underline first:border-t-0 hover:bg-surface hover:text-text"
              >
                <span className="text-[13px] text-muted">{w.day}</span>
                <span className="truncate">
                  <span className="font-medium">{w.title}</span> <span className="font-mono text-xs text-muted">{w.code}</span>
                </span>
                <span className={`text-[13px] ${w.kind === 'downloaded' ? 'text-text-2' : 'text-faint'}`}>{w.kind === 'downloaded' ? w.sub : w.kind === 'aired' ? 'оригинал' : 'эфир'}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
