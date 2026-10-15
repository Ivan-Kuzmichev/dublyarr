# Дообученные головы Laya — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Собрать из базы Dublyarr обучающий набор, дообучить на Mac головы Laya (энкодер заморожен), положить веса в репозиторий и грузить их в образе.

**Architecture:** Node строит набор строк ровно в формате боевых вопросов (`matchInput`/`studioInput`/`animeInput`/`finalInput`) и отдаёт его через API.
Python-скрипт в `laya-train/` (venv на Mac, MPS) кодирует строки внутренними функциями Laya, учит `scorer`/`type_emb`/`head`, калибрует температуру,
сравнивает с базовой на отложенных сериалах и сохраняет `laya/heads/heads.safetensors` + `meta.json`. `laya/serve.py` подменяет веса голов после `laya.load`.

**Tech Stack:** TypeScript (Drizzle, Vitest), Python 3.11 (`laya==0.3.22`, `torch` с MPS, `safetensors`, `pytest`), `uv`.

**Spec:** `docs/superpowers/specs/2026-10-15-laya-heads-design.md`

## Global Constraints

- Учим только головы: `scorer`, `type_emb`, `head` (+ буфер `temperature`); энкодер заморожен.
- Вход обучения — строго как боевые вопросы Dublyarr; кодирование — функциями Laya (`_check_question`, `_to_internal`, `_encode_state`).
- Разбиение 80/20 по сериалам (`group`), фиксированный сид; принимается, только если по каждой проверенной задаче (≥ 50 строк в отложенной) log-loss не хуже базовой и точность при пороге 0,85 не хуже.
- На один сериал — не больше 200 строк задачи; отрицательных пар не больше положительных ×2.
- Веса — fp16, только ключи голов; `meta.json` хранит `laya`, `model`, `revision`; несовпадение — головы не грузятся.
- Выгрузка набора — только админ (весь API — админский), только локальная сеть.
- Головы владельца в `${DATA_DIR}/laya/heads/` важнее, чем в образе; файл `${DATA_DIR}/laya/heads.disabled` — базовая модель.
- Тексты интерфейса — по-русски. Версия 2.5.0.

## Review Focus

1. Кодирование в обучении расходится с боевым (другой `max_len`, порядок вариантов) — до обучения логиты скрипта и `agent.decide` должны совпасть (Task 4: тест паритета).
2. Утечка сериала между обучающей и отложенной частью — разбиение по `group` (Task 4: тест разбиения).
3. Подмена весов задевает энкодер или не все ключи голов — строгая проверка набора ключей (Task 2: тест).
4. Битый / чужой файл голов в образе ломает laya-serve — ловится, базовая модель, строка в журнал (Task 2: тест).
5. Набор перекошен одним сериалом (Чёрный клевер, 170 серий) — ограничение 200 строк на сериал и задачу (Task 1: тест).

---

## Файлы

- Create: `src/lib/laya/dataset.ts` — `buildDataset(db): DatasetRow[]`.
- Modify: `src/lib/api/read.ts` — `GET laya/dataset` (JSONL).
- Modify: `laya/serve.py` — `apply_heads`, `POST /reload`, флаг `heads.disabled`, пометка `+heads` в `model`.
- Create: `laya/heads_util.py` — чистые функции подмены (тестируемы без сервера).
- Create: `laya-train/` — `pyproject.toml`, `train.py`, `encode.py`, `tests/test_encode.py`, `tests/test_heads.py`, `README.md`.
- Create: `laya/heads/heads.safetensors`, `laya/heads/meta.json` (результат Task 5).
- Modify: `src/app/(app)/settings/ai/*` — переключатель «Дообученная Laya»; `src/lib/laya/heads.ts` — флаг и перезагрузка.
- Tests: `tests/unit/laya-dataset.test.ts`, `tests/unit/laya-heads.test.ts`, `tests/unit/api-router.test.ts`.

---

### Task 1: Обучающий набор и выгрузка

**Files:** Create `src/lib/laya/dataset.ts`; Modify `src/lib/api/read.ts`; Test `tests/unit/laya-dataset.test.ts`, `tests/unit/api-router.test.ts`

**Interfaces:**
- Produces: `type DatasetRow = { task: 'match' | 'studio' | 'anime' | 'final'; group: string; source: 'user' | 'rule' | 'download' | 'pair' | 'alias'; state: unknown; question: { type: 'noul' | 'choice'; instructions: string; criteria?: Record<string, string> }; target: boolean | string }`;
  `buildDataset(db: Db, o?: { perGroup?: number; seed?: number }): DatasetRow[]`; `GET /api/v1/laya/dataset` → `text/plain` JSONL (по строке на `DatasetRow`; если роутер отдаёт только JSON — `{ rows: DatasetRow[] }`).

- [ ] **Step 1: Write the failing tests** — `tests/unit/laya-dataset.test.ts`:
  - `user`: строка `laya_examples` (match, label true) → `{ task: 'match', source: 'user', state, question, target: true }` с `state`/`question` из `input`.
  - `rule`: `release_rules` `reject` по основе заголовка раздачи сериала → `match = false` для раздач, чья основа совпала; `match` → `true`.
  - `download`: загрузка `imported` с `releaseId` → `match = true` и `final = true`, где `question` совпадает с `finalInput(...)` для серии/озвучки/качества загрузки.
  - `pair`: при двух сериалах раздачи A, поставленные к B, → `match = false`; их не больше чем положительных ×2.
  - `alias`: раздача с подписью-вариантом студии словаря → `studio = имя студии`, `question` совпадает с `studioInput(...)`.
  - ограничение: 300 импортированных раздач одного сериала → не больше 200 строк `match` с `group` этого сериала.
  - API: `GET laya/dataset` → 200, строки парсятся, у каждой есть `task/group/state/question/target`.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/laya-dataset.test.ts tests/unit/api-router.test.ts` — Expected: FAIL (нет модуля).
- [ ] **Step 3: Implement** `buildDataset`: собрать источники по порядку надёжности; ключ строки `task|state|question` — дубли отбрасываются, побеждает более надёжный источник;
  `group = tmdbType:tmdbId` (для `studio` — подпись); ограничение по `group` — детерминированная выборка (сортировка по хэшу `seed+ключ`); маршрут `laya/dataset` в `READ_ROUTES`.
- [ ] **Step 4: Run** те же тесты — Expected: PASS; затем `pnpm typecheck && pnpm lint`.
- [ ] **Step 5: Commit** `feat(laya): обучающий набор из базы и выгрузка через API`.

### Task 2: Головы в laya-serve

**Files:** Create `laya/heads_util.py`; Modify `laya/serve.py`; Test `laya-train/tests/test_heads.py`

**Interfaces:**
- Produces: `HEAD_KEYS_PREFIXES = ('scorer.', 'type_emb.', 'head.', 'temperature')`;
  `pick_heads_dir(data_dir: str, image_dir: str) -> Optional[str]` (свой важнее, `heads.disabled` → `None`);
  `apply_heads(model, heads_dir, loaded: dict) -> Tuple[bool, str]` (`loaded = {'laya': ..., 'model': ..., 'revision': ...}`; проверяет `meta.json`, грузит `safetensors`, ключи — только с префиксами голов и все такие ключи модели, размеры совпадают; иначе `(False, причина)` без изменений модели).
  `GET /health` → `model` с суффиксом `+heads-<createdAt>` при успехе; `POST /reload` — перечитать флаг и модель.
- [ ] **Step 1: Write the failing tests** (`pytest`, маленький `torch.nn.Module` с теми же префиксами + `encoder.*`): подмена меняет только головы; лишний ключ `encoder.x` → отказ; неверная форма → отказ; `meta.model` другой → отказ; `heads.disabled` → `None`; свой каталог важнее образа.
- [ ] **Step 2: Run** `cd laya-train && uv run pytest tests/test_heads.py` — Expected: FAIL (нет модуля).
- [ ] **Step 3: Implement** `heads_util.py` и вызов в `serve.py` после `laya.load` (`agent.model`), журнал строкой JSON как сейчас; `LAYA_HEADS_DIR` по умолчанию `laya/heads` (в образе — `/app/laya/heads`).
- [ ] **Step 4: Run** тесты — PASS.
- [ ] **Step 5: Commit** `feat(laya): головы из репозитория в laya-serve, /reload, отключение`.

### Task 3: Переключатель «Дообученная Laya»

**Files:** Create `src/lib/laya/heads.ts`; Modify `src/app/(app)/settings/ai/actions.ts`, страницу «AI»; Test `tests/unit/laya-heads.test.ts`, `tests/unit/guards.test.ts`

**Interfaces:**
- Produces: `headsEnabled(dataDir): boolean`; `setHeadsEnabled(dataDir, on): void` (файл `laya/heads.disabled`); `reloadLaya(port, fetch)`; action `setHeadsAction` (guard `admin`).
- [ ] **Step 1: Write the failing tests**: включение/выключение пишет и удаляет флаг; `reloadLaya` шлёт `POST /reload`; `setHeadsAction` без права — «Недостаточно прав».
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**: карточка в «Настройки → AI» — переключатель, строка «Модель: …+heads-…» из `layaHealthInfo`.
- [ ] **Step 4: Run** `pnpm vitest run …; pnpm typecheck; pnpm lint` — PASS.
- [ ] **Step 5: Commit** `feat(laya): переключатель дообученных голов`.

### Task 4: Скрипт обучения на Mac

**Files:** Create `laya-train/pyproject.toml`, `laya-train/encode.py`, `laya-train/train.py`, `laya-train/tests/test_encode.py`, `laya-train/README.md`

**Interfaces:**
- Consumes: JSONL из Task 1; `heads_util.HEAD_KEYS_PREFIXES` (Task 2).
- Produces: `python train.py --data data.jsonl --out ../laya/heads [--epochs N]` → `heads.safetensors`, `meta.json`, `report.md`; код выхода 0 — принято, 2 — хуже базовой (файлы не пишутся).
- [ ] **Step 1: Write the failing tests**: `encode_rows(agent, rows)` для 3 строк даёт те же логиты, что `agent.decide_batch` (до обучения, допуск 1e-4); `split_by_group` — ни одна `group` не попадает в обе части, доля отложенной ≈ 20 %.
- [ ] **Step 2: Run** `uv run pytest` — FAIL.
- [ ] **Step 3: Implement** `encode.py` (внутренние функции Laya, сборка батча как в агенте), `train.py` (заморозка энкодера, AdamW lr 1e-4, кросс-энтропия по вариантам, ранняя остановка по log-loss отложенной части, калибровка температуры, метрики base/tuned по задачам, решение «принять»).
- [ ] **Step 4: Run** тесты — PASS.
- [ ] **Step 5: Commit** `feat(laya-train): скрипт дообучения голов на Mac`.

### Task 5: Данные с NAS, обучение, замер

- [ ] **Step 1:** выкатить Task 1 на NAS (релиз 2.5.0-pre не нужен — достаточно `edge`, если владелец обновится; иначе собрать набор локально из копии базы через API после релиза) и выгрузить `GET /api/v1/laya/dataset` в `laya-train/data/` (в `.gitignore`).
- [ ] **Step 2:** `uv run python train.py --data data/dataset.jsonl --out ../laya/heads` — Expected: отчёт `report.md` с таблицей base/tuned по задачам; код 0.
- [ ] **Step 3:** если код 2 — показать отчёт владельцу, ничего не коммитить; если 0 — `git add laya/heads` и коммит `feat(laya): дообученные головы <дата>` (с таблицей метрик в описании).

### Task 6: Образ, документы, версия

- [ ] **Step 1:** Dockerfile уже копирует `laya/` — проверить, что `laya/heads/*` попадает в образ; `docker run … laya-bench` с моделью: `model` содержит `+heads`, ответы есть.
- [ ] **Step 2:** CLAUDE.md — раздел «Решения (2.5 — головы Laya)»; spec.md §13 — пункт; `package.json` 2.5.0.
- [ ] **Step 3:** `pnpm typecheck && pnpm lint && pnpm test && pnpm e2e` — всё зелёное; коммит.
