# Sevens — идеи для области Абай

Платформа хакатона: житель подаёт идею с местом и вложениями, система
определяет направление, сотрудник рассматривает обращение и отвечает.
Доступны русский и казахский языки, уведомления, публичная витрина,
реакции, карта, кабинет сотрудника и помощник.

**Организации и маршруты демонстрационные. Официальной отправки
в государственные системы нет.**

## Облачный запуск

Один **Render Free Web Service** запускает Next.js и приватный Node API.
**Neon PostgreSQL** хранит пользователей, идеи, геометрию, комментарии,
уведомления и байты вложений. Перезапуск приложения не удаляет данные.

```sh
npm ci
npm run build
npm run start:cloud
```

До первого запуска восстановите базу в Neon и задайте `DATABASE_URL`,
`APP_ENV=demo`, `DEMO_LOGIN_ENABLED=true`. Render передаёт `PORT` и
`RENDER_EXTERNAL_URL`; launcher устанавливает HTTPS origin, Secure cookies
и `ATTACHMENT_STORAGE=database`. Миграции выполняются без seed или сброса.
Настройки: `render.yaml`; инструкция: `docs/07_DEPLOYMENT_RUNBOOK.md`.

После восстановления базы существующие файлы переносятся командой
`npm run storage:import`: `DATABASE_URL` указывает на облако,
`UPLOAD_DIR` — абсолютный путь исходных файлов. Импорт проверяет размер
и SHA-256, сохраняет байты транзакционно и не удаляет исходники.

[Render Free](https://render.com/docs/free) засыпает после 15 минут простоя;
первое открытие может занять около минуты. Перед показом откройте сайт
заранее. Объём Neon Free ограничен: стенд рассчитан на небольшое демо.

## Локальный запуск

Нужны Node.js 22+ и Docker:

```sh
npm ci
npm run dev:sevens
# http://127.0.0.1:3100; данные сохраняются в отдельной PostgreSQL
```

Для Compose: `bash scripts/setup-demo.sh`. `docker compose down -v`
удаляет volumes — не используйте эту команду для сохранения данных.

## Карта и AI

`NEXT_PUBLIC_DGIS_MAP_KEY` задаётся перед сборкой. Нужен ключ 2ГИС
с Map Tiles API и разрешённым доменом. Без ключа доступно текстовое
указание места. Геометрия проверяется по границе области Абай.

`OPENAI_API_KEY`, `ASSISTANT_ENABLED=true`, `CLASSIFIER_MODE=llm`
включают внешние модели. Ключ только серверный: не помещайте его в Git
или `NEXT_PUBLIC_*`. Без модели остаются справка, правила и ручной разбор.

## Проверки

```sh
npm run check              # TypeScript + unit tests
npm run test:integration   # изолированная PGlite, не рабочая база
npm run build
```

`/api/health/live` проверяет процесс; `/api/health/ready` — API,
схему и хранилище. PostgreSQL и HTTP/browser проверки находятся
в `tests/integration/postgres` и `tests/e2e`. Reset suites запрещены
на демонстрационной базе.

Код: `src/`; миграции: `db/migrations`; fixtures: `fixtures/`
и `docs/fixtures/`; продукт, API и безопасность: основные документы `docs/`.
