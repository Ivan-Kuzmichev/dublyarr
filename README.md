# Dublyarr

Подписка на сериалы и фильмы в нужной озвучке и качестве: сам ищет серии на русских трекерах
и докачивает их через qBittorrent. Один пользователь, домашний NAS, смотреть — по SMB (VidHub).

Спецификация — `docs/spec.md`, план работ — `docs/plan.md`, макеты — `design/`.

## Запуск на Synology (Container Manager)

1. Соберите образ (на машине с Docker): `docker build --platform linux/amd64 -t dublyarr:dev .`
   и перенесите его на NAS (`docker save dublyarr:dev | gzip > dublyarr.tar.gz`, затем «Образ → Импорт»).
2. Сгенерируйте ключ шифрования секретов: `openssl rand -base64 32`.
   Храните его вместе с бэкапом `/data`: без ключа сохранённые пароли qBittorrent и ключи источников не расшифровать.
3. Создайте проект по `docker-compose.example.yml`: том `/data` (база, ключ, модели), папки загрузок и медиатеки.
4. Откройте `http://<NAS>:3000` — мастер первого запуска: аккаунт → TMDB → qBittorrent → источники → папки.
   Ключ TMDB — в настройках аккаунта на themoviedb.org (API Key или API Read Access Token). Если TMDB не открывается с NAS,
   укажите HTTP-прокси — через него пойдут и запросы, и постеры.
5. Двухфакторная защита включается в «Настройки → Безопасность».

Если `DUBLYARR_SECRET_KEY` не задан, ключ создаётся в `/data/secret.key` (права 0600).

## Забыл пароль / потерял телефон

```sh
docker exec -it dublyarr dublyarr reset-password              # новый пароль, все сеансы завершатся
docker exec -it dublyarr dublyarr reset-password --disable-2fa # ещё и выключить код из приложения
```

## Переменные окружения

| Переменная | По умолчанию | Что это |
|---|---|---|
| `DATA_DIR` | `/data` | база `db.sqlite`, `secret.key`, модели Laya |
| `PORT` | `3000` | веб-интерфейс |
| `LAYA_PORT` | `8765` | laya-serve на 127.0.0.1 внутри контейнера |
| `DUBLYARR_SECRET_KEY` | — | base64 от 32 байт; ключ шифрования секретов в БД |
| `LOG_LEVEL` | `info` | уровень логов pino |
| `TMDB_BASE_URL`, `TMDB_IMAGE_BASE_URL` | официальные | только для тестов (заглушка TMDB) |

## Разработка

```sh
pnpm install
cp .env.example .env.local        # DATA_DIR=./.data и т.д.
pnpm dev                          # только веб; воркер: pnpm build && node dist/worker.cjs
pnpm test                         # unit (Vitest)
pnpm e2e                          # сценарий входа (Playwright, собирает и запускает всё)
pnpm lint && pnpm typecheck
pnpm db:generate                  # миграция после правки src/lib/db/schema.ts
```

В контейнере процессом 1 работает супервизор (`dist/supervisor.cjs`): применяет миграции и держит живыми
`next start`, воркер (`dist/worker.cjs`) и `laya/serve.py`.
