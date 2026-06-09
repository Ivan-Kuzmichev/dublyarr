import { openDb, type Db } from "@dublyarr/core/db";
import { join } from "node:path";

const globalForDb = globalThis as unknown as { __dublyarrDb?: Db };

export function getDb(): Db {
  if (!globalForDb.__dublyarrDb) {
    const dir = process.env.DATA_DIR ?? "./data";
    globalForDb.__dublyarrDb = openDb(join(dir, "dublyarr.db")).db;
  }
  return globalForDb.__dublyarrDb;
}
