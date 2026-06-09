# Dublyarr

Self-hosted сервис класса Sonarr/Radarr «всё в одном» с выбором **озвучки**.
Работает поверх Jackett (поиск по трекерам) и qBittorrent (скачивание),
метаданные — TMDb (ru-RU).

Спека: `docs/superpowers/specs/2026-06-09-dublyarr-design.md`.

## Структура

- `packages/core` — парсер озвучек/качества, клиенты Jackett/TMDb, SQLite (Drizzle)
- `apps/web` — Next.js UI (App Router, CSS Modules)

## Разработка

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # unit (vitest)
npm run test:e2e -w @dublyarr/web   # e2e (playwright)
```

Ключи интеграций задаются в UI: Настройки → Интеграции.
БД создаётся в `./data/dublyarr.db` (переопределить: `DATA_DIR`).
