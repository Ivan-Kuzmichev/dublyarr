export const migrations: { id: string; sql: string }[] = [
  {
    id: "0000_init",
    sql: `CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );`,
  },
];
