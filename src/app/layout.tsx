import type { Metadata, Viewport } from 'next';
// Шрифты лежат в npm-пакетах: сборка образа не ходит в Google Fonts (с NAS он бывает недоступен).
import '@fontsource-variable/onest';
import '@fontsource/unbounded/500.css';
import '@fontsource/unbounded/600.css';
import '@fontsource/unbounded/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './globals.css';

export const metadata: Metadata = { title: 'Dublyarr' };
export const viewport: Viewport = { themeColor: '#121110', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
