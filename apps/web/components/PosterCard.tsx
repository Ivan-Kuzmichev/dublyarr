import Image from "next/image";
import Link from "next/link";
import styles from "./PosterCard.module.css";

export interface PosterCardProps {
  href: string;
  title: string;
  subtitle: string;
  posterUrl: string | null;
  typeBadge?: string;       // "TV" | "Фильм"
  ratingBadge?: string;     // "8.7"
  cornerBadge?: { text: string; color: string } | null;
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
        {p.typeBadge && <span className={styles.type}>{p.typeBadge}</span>}
        {p.ratingBadge && <span className={styles.rating}>{p.ratingBadge}</span>}
        {p.cornerBadge && (
          <span className={styles.corner} style={{ background: p.cornerBadge.color }}>
            {p.cornerBadge.text}
          </span>
        )}
      </div>
      <div className={styles.title}>{p.title}</div>
      <div className={styles.subtitle}>{p.subtitle}</div>
    </Link>
  );
}
