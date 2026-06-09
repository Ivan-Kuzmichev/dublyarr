import { defineConfig } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

// Load repo-root .env so TMDB_API_KEY is available when running from apps/web
const rootEnv = path.resolve(__dirname, "../../.env");
if (fs.existsSync(rootEnv)) {
  for (const line of fs.readFileSync(rootEnv, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: { baseURL: "http://localhost:3100" },
  webServer: {
    command: "npx next dev -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    env: { DATA_DIR: "./.e2e-data" },
  },
});
