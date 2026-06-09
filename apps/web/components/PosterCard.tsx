import Image from "next/image";
import Link from "next/link";
import styles from "./PosterCard.module.css";

export interface Badge {
  text: string;
  color?: string; // фон; по умолчанию полупрозрачный чёрный
}

export interface PosterCardProps {
  href: string;
  title: string;
  subtitle: string;
  posterUrl: string | null;
  topLeft?: Badge | null;
  topRight?: Badge | null;
  bottomLeft?: Badge | null;
  bottomRight?: Badge | null;
}

function BadgeSpan({ badge, className }: { badge: Badge; className: string }) {
  return (
    <span
      className={`${styles.badge} ${className}`}
      style={badge.color ? { background: badge.color } : undefined}
    >
      {badge.text}
    </span>
  );
}

export function PosterCard(p: PosterCardProps) {
  return (
    <Link href={p.href} className={styles.card}>
      <div className={styles.poster}>
        {p.posterUrl ? (
          <Image src={p.posterUrl} alt={p.title} fill sizes="180px"
            className={styles.img} />
        ) : (
          <div className={styles.noPoster}>нет постера</div>
        )}
        {p.topLeft && <BadgeSpan badge={p.topLeft} className={styles.tl} />}
        {p.topRight && <BadgeSpan badge={p.topRight} className={styles.tr} />}
        {p.bottomLeft && <BadgeSpan badge={p.bottomLeft} className={styles.bl} />}
        {p.bottomRight && <BadgeSpan badge={p.bottomRight} className={styles.br} />}
      </div>
      <div className={styles.title}>{p.title}</div>
      <div className={styles.subtitle}>{p.subtitle}</div>
    </Link>
  );
}
