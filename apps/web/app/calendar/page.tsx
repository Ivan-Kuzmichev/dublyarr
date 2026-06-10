import { listCalendar, type CalendarEntry } from "@dublyarr/core/db";
import { getDb } from "@/server/db";
import styles from "./calendar.module.css";

export const dynamic = "force-dynamic";

function isoOffset(base: Date, days: number): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function statusOf(e: CalendarEntry, today: string): { text: string; cls: string } {
  if (e.hasFile) return { text: "✓ скачано", cls: "ok" };
  if (e.airDate > today) return { text: "выйдет в эфир", cls: "future" };
  if (e.wanted) return { text: `ждём раздачу${e.voiceover !== "any" ? ` в ${e.voiceover}` : ""}`, cls: "wait" };
  return { text: "вышла", cls: "muted" };
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export default function CalendarPage() {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const from = isoOffset(new Date(), -30);
  const to = isoOffset(new Date(), 90);
  const entries = listCalendar(db, from, to);

  const byDate = new Map<string, CalendarEntry[]>();
  for (const e of entries) {
    if (!byDate.has(e.airDate)) byDate.set(e.airDate, []);
    byDate.get(e.airDate)!.push(e);
  }

  return (
    <>
      <h1>Календарь</h1>
      {entries.length === 0 ? (
        <p className={styles.muted}>Нет серий с датами выхода в ближайшие 3 месяца.</p>
      ) : (
        <div data-testid="calendar">
          {[...byDate.entries()].map(([date, eps]) => (
            <section key={date} className={styles.day}>
              <h2 className={styles.date}>
                {formatDate(date)}
                {date === today && <span className={styles.todayBadge}>сегодня</span>}
              </h2>
              <ul className={styles.list}>
                {eps.map((e) => {
                  const st = statusOf(e, today);
                  return (
                    <li key={`${e.titleId}-${e.season}-${e.episode}`} className={styles.row}>
                      <span className={styles.title}>{e.titleRu}</span>
                      <span className={styles.code}>
                        S{String(e.season).padStart(2, "0")}E{String(e.episode).padStart(2, "0")}
                      </span>
                      {e.nameRu && <span className={styles.epName}>{e.nameRu}</span>}
                      <span className={styles[st.cls]}>{st.text}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
