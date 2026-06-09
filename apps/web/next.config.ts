import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@dublyarr/core"],
  serverExternalPackages: ["better-sqlite3"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "image.tmdb.org" }],
  },
};

export default config;
