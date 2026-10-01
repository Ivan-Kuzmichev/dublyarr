// Без node-модулей: используется и в клиентских компонентах.

export const IMAGE_SIZES = ['w185', 'w300', 'w342', 'w780', 'w1280'] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

export const imageUrl = (size: ImageSize, p: string | null) => (p ? `/api/image/${size}${p}` : null);

// Цвета заглушек — из макетов (design/screens/Login.dc.html).
export const POSTER_COLORS = [
  '#22394A', '#2B3D2A', '#2A3656', '#3E3322', '#3A2B2A', '#2A3346', '#4A3122', '#4A2A22', '#4A2E40',
  '#233042', '#3A3A36', '#2C3548', '#2F3B2E', '#24454D', '#3B3526', '#4A4222', '#3A2626', '#2E2A26',
];
export const posterColor = (tmdbId: number) => POSTER_COLORS[tmdbId % POSTER_COLORS.length];
