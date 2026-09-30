import type { Metadata, Viewport } from 'next';
import { onest, unbounded, mono } from './fonts';
import './globals.css';

export const metadata: Metadata = { title: 'Dublyarr' };
export const viewport: Viewport = { themeColor: '#121110', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${onest.variable} ${unbounded.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
