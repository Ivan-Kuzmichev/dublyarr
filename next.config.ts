import type { NextConfig } from 'next';

const config: NextConfig = {
  serverExternalPackages: ['better-sqlite3', '@node-rs/argon2'],
  poweredByHeader: false,
};

export default config;
