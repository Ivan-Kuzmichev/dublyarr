"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./Nav.module.css";

const items = [
  { href: "/", label: "Отслеживаемое", icon: "📌" },
  { href: "/search", label: "Поиск", icon: "🔍" },
  { href: "/calendar", label: "Календарь", icon: "📅" },
  { href: "/activity", label: "Активность", icon: "⬇️" },
];

export function Nav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const [activeCount, setActiveCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/activity/count");
        if (!res.ok) return;
        const data = (await res.json()) as { count: number };
        if (alive) setActiveCount(data.count);
      } catch {
        // молча — бейдж не критичен
      }
    };
    void load();
    const timer = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <>
      <header className={styles.top} data-testid="top-nav">
        <Link href="/" className={styles.logo}>⛵ Dublyarr</Link>
        <nav className={styles.topLinks}>
          {items.map((i) => (
            <Link key={i.href} href={i.href}
              className={isActive(i.href) ? styles.active : ""}>
              {i.label}
              {i.href === "/activity" && activeCount > 0 && (
                <span className={styles.badge} data-testid="activity-badge">{activeCount}</span>
              )}
            </Link>
          ))}
        </nav>
        <Link href="/settings" className={styles.gear} aria-label="Настройки">⚙️</Link>
      </header>
      <header className={styles.mobileHead} data-testid="mobile-head">
        <Link href="/" className={styles.logo}>⛵ Dublyarr</Link>
        <Link href="/settings" aria-label="Настройки">⚙️</Link>
      </header>
      <nav className={styles.tabBar} data-testid="tab-bar">
        {items.map((i) => (
          <Link key={i.href} href={i.href}
            className={isActive(i.href) ? styles.active : ""}>
            <span className={styles.tabIcon}>{i.icon}</span>
            <span className={styles.tabLabel}>{i.label}</span>
            {i.href === "/activity" && activeCount > 0 && (
              <span className={styles.badge} data-testid="activity-badge-mobile">{activeCount}</span>
            )}
          </Link>
        ))}
      </nav>
    </>
  );
}
