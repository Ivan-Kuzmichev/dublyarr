import { Onest, Unbounded, JetBrains_Mono } from 'next/font/google';

export const onest = Onest({ subsets: ['latin', 'cyrillic'], weight: ['400', '500', '600', '700'], variable: '--font-onest' });
export const unbounded = Unbounded({ subsets: ['latin', 'cyrillic'], weight: ['500', '600', '700'], variable: '--font-unbounded' });
export const mono = JetBrains_Mono({ subsets: ['latin', 'cyrillic'], weight: ['400', '500'], variable: '--font-mono-jb' });
