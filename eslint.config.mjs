import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: ['dist/**', '.next/**', 'drizzle/**', 'next-env.d.ts', '.superpowers/**', 'design/**', 'playwright-report/**', 'test-results/**'] },
];

export default config;
