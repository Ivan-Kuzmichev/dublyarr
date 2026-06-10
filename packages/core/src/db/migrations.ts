export const migrations: { id: string; sql: string }[] = [
  {
    id: "0000_init",
    sql: `CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );`,
  },
  {
    id: "0001_tracking",
    sql: `CREATE TABLE quality_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      allowed TEXT NOT NULL,
      preferred TEXT NOT NULL,
      upgrade_enabled INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE titles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tmdb_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('movie','tv')),
      title_ru TEXT NOT NULL,
      title_original TEXT NOT NULL,
      year TEXT NOT NULL DEFAULT '',
      poster_path TEXT,
      overview TEXT NOT NULL DEFAULT '',
      tmdb_status TEXT,
      tracked INTEGER NOT NULL DEFAULT 1,
      quality_preset_id INTEGER NOT NULL REFERENCES quality_presets(id) ON DELETE RESTRICT,
      voiceover TEXT NOT NULL DEFAULT 'any',
      monitor_rule TEXT NOT NULL DEFAULT 'all' CHECK (monitor_rule IN ('all','future_only','manual')),
      root_folder TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (tmdb_id, type)
    );
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
      season INTEGER NOT NULL,
      episode INTEGER NOT NULL,
      air_date TEXT,
      name_ru TEXT NOT NULL DEFAULT '',
      wanted INTEGER NOT NULL DEFAULT 0,
      file_id INTEGER,
      UNIQUE (title_id, season, episode)
    );
    INSERT INTO quality_presets (name, allowed, preferred, upgrade_enabled) VALUES
      ('FullHD', '["bluray-1080p","bdrip-1080p","webdl-1080p","webrip-1080p","hdtv-1080p"]', 'webdl-1080p', 0),
      ('4K', '["bdremux-2160p","webdl-2160p","bdremux-1080p","webdl-1080p"]', 'bdremux-2160p', 1);`,
  },
  {
    id: "0002_downloads",
    sql: `CREATE TABLE files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
      episode_id INTEGER REFERENCES episodes(id) ON DELETE SET NULL,
      path TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      quality_source TEXT,
      quality_resolution TEXT,
      voiceover_studio TEXT,
      release_guid TEXT,
      downloaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
      release_guid TEXT NOT NULL DEFAULT '',
      release_title TEXT NOT NULL DEFAULT '',
      qbit_hash TEXT,
      tag TEXT NOT NULL UNIQUE,
      episodes_covered TEXT NOT NULL DEFAULT '[]',
      voiceover_studio TEXT,
      quality_source TEXT,
      quality_resolution TEXT,
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','downloading','completed','failed','imported')),
      progress REAL NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
  },
];
