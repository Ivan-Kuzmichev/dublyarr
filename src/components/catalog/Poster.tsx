'use client';

import { useState } from 'react';
import { imageUrl, posterColor, type ImageSize } from '@/lib/image-url';

type Props = { tmdbId: number; name: string; path: string | null; size?: ImageSize; className?: string };

/** Постер TMDB; не загрузился или его нет — цветная заглушка с названием, как в макетах. */
export function Poster({ tmdbId, name, path, size = 'w342', className = '' }: Props) {
  const [failed, setFailed] = useState(false);
  const src = imageUrl(size, path);
  if (!src || failed)
    return (
      <div className={`flex items-end p-3 ${className}`} style={{ background: posterColor(tmdbId) }} role="img" aria-label={name}>
        <span className="line-clamp-2 text-[13px] font-medium text-text-2">{name}</span>
      </div>
    );
  // eslint-disable-next-line @next/next/no-img-element -- картинки идут через свой прокси с кэшем
  return <img src={src} alt={name} loading="lazy" onError={() => setFailed(true)} className={`object-cover ${className}`} />;
}
