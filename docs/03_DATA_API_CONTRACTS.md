# 03. Данные, API и инварианты

**Контракт версии 1.0.** Имена enum и полей этого документа едины для backend, frontend, правил, fixtures и тестов. Изменение согласует A; схемой БД и миграциями владеет B. В JSON используется `camelCase`, в БД — `snake_case`.

## 1. Общие соглашения

- Внутренние идентификаторы сущностей — UUID. Примеры `idea-id` в URL — обозначения, не буквальные допустимые значения.
- Справочники имеют стабильные строковые коды; пример `TRANSPORT`. В fixtures могут использоваться `seedKey`; seed преобразует их в UUID.
- Время хранится как `timestamptz`, передаётся ISO 8601 UTC. UI форматирует в `Asia/Almaty`.
- Строки валидируются после `trim`; Unicode нормализуется в NFC. Лимиты пользовательского текста считаются по Unicode code points; размер тела ограничивается отдельно в байтах.
- Неизвестные поля write DTO отклоняются; не передавать `request.body` напрямую в ORM.
- Все `/api/v1/*`, кроме регистрации/входа и справочников общего назначения, требуют сессию. Даже общие справочники не содержат контактов сотрудников.
- Частные ответы и файлы: `Cache-Control: private, no-store`.

## 2. Enum

```ts
export type Role = 'CITIZEN' | 'STAFF' | 'ADMIN';
export type IdeaStatus =
  | 'DRAFT' | 'RECEIVED' | 'UNDER_REVIEW' | 'NEEDS_INFO'
  | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED';
export type CategoryCode =
  | 'TRANSPORT' | 'UTILITIES' | 'EDUCATION' | 'ECOLOGY'
  | 'SAFETY' | 'HEALTH' | 'TOURISM' | 'ACCESSIBILITY' | 'OTHER';
export type CommentVisibility = 'PUBLIC' | 'INTERNAL';
export type RoutingMode = 'ASSIGNED' | 'TRIAGE';
export type ConfidenceBand = 'HIGH' | 'MEDIUM' | 'LOW';
export type ResolutionType =
  | 'ANSWER_PROVIDED' | 'PILOT_PLANNED' | 'IMPLEMENTED' | 'FORWARDED_EXTERNALLY';
```

`AUTO` существует только в форме; на API `requestedCategoryCode: null` означает автоматическое определение. `PUBLIC` у комментария означает «доступен автору», а не общедоступный web.

## 3. Модель данных P0

### 3.1. Identity и справочники

| Таблица | Основные поля | Ограничения |
|---|---|---|
| `regions` | id, code, name_ru, name_kk, active | code unique; один активный регион демо |
| `territories` | id, region_id, parent_id, code, kind, name_ru, name_kk, active, is_demo | parent в том же регионе; code unique |
| `organizations` | id, region_id, code, name, is_triage, active, is_demo | ровно одна активная triage-организация региона |
| `categories` | code, name_ru, name_kk, active | code — PK из enum |
| `routing_rules` | id, region_id, territory_id?, category_code, organization_id, priority, version, active | ссылки в одном регионе; детерминированный порядок |
| `users` | id, email_normalized, display_name, password_hash, role, organization_id?, region_id, active, created_at | email unique; STAFF требует organization_id |
| `sessions` | id, user_id, token_hash, csrf_token_hash, created_at, expires_at, revoked_at? | token_hash unique; токен в открытом виде не хранится |

Для P0 сотрудник состоит в одной организации. Множественное членство — отдельное расширение, а не массив неявных прав. Администратор имеет региональный scope. Проверка `region_id` применяется и к нему; глобальный суперпользователь вне MVP.

### 3.2. Идеи и взаимодействие

| Таблица | Основные поля |
|---|---|
| `ideas` | id, region_id, author_id, public_number?, title, problem, solution, expected_benefit?, requested_category_code?, effective_category_code?, territory_id?, location_text?, status, organization_id?, assignee_id?, version, content_revision, submitted_at?, created_at, updated_at, resolution_type?, consent_version?, consent_at? |
| `routing_decisions` | id, idea_id, source, mode, effective_category_code, organization_id, tags_json, confidence_band, scores_json, reason_codes_json, explanation, rule_version, actor_id?, created_at |
| `comments` | id, idea_id, author_id, visibility, kind, body, created_at |
| `idea_events` | id, idea_id, type, actor_id?, visibility, from_status?, to_status?, comment_id?, payload_json, created_at |
| `attachments` | id, idea_id, uploaded_by, storage_key, original_name, detected_mime, size_bytes, sha256, created_at, removed_at? |
| `notifications` | id, recipient_id, idea_id, source_event_id, kind, title, read_at?, created_at |
| `audit_events` | id, region_id, actor_id?, action, entity_type, entity_id, request_id, metadata_json, created_at |
| `idempotency_records` | id, user_id, operation, key, request_hash, response_status, response_json, created_at, expires_at |

`routing_decisions.source` — `RULES` или `HUMAN`; AI-рекомендации P1 хранятся отдельно и не становятся текущим маршрутом без действия человека. `ideas` хранит текущую проекцию; история решений сохраняется.

Согласие при регистрации и при отправке идеи фиксируется отдельно: таблица `user_consents` содержит user_id, purpose, version, accepted_at. Поля согласия в `ideas` фиксируют подачу конкретной идеи, а не заменяют журнал согласий пользователя.

`content_revision` увеличивается при изменении текста черновика и добавлении уточнения. Счётчик `version` увеличивается при каждом изменении карточки, маршрута, статуса, комментария или вложения. Прочтение уведомления не меняет версию идеи.

### 3.3. Инварианты

1. В `DRAFT` номер и `submitted_at` пусты; после отправки они обязательны и неизменяемы.
2. У отправленной идеи всегда есть `effective_category_code` и `organization_id`, включая triage.
3. Автор, идея, территория, организация и ответственный принадлежат одному региону.
4. Ответственный активен и относится к текущей организации. Проверяется внутри той же транзакции, что назначение/смена маршрута.
5. Смена организации обнуляет `assignee_id`; обычное изменение категории внутри той же организации может сохранить его.
6. Переход сотрудником в `UNDER_REVIEW`/`IN_PROGRESS` требует ответственного. Исключение: ответ автора после перенаправления возвращает `NEEDS_INFO` в `UNDER_REVIEW` даже без ответственного; такая карточка явно попадает в «Без ответственного» новой организации.
7. `COMPLETED` требует `resolution_type` и публичного комментария; в других статусах `resolution_type` отсутствует.
8. Чужой файл нельзя прикрепить передачей произвольного UUID. Проверяются владелец, идея, регион и состояние.
9. Идея содержит максимум 3 активных вложения; конкурентная загрузка проверяет лимит под row lock.
10. Обязательные комментарий, статус, событие, аудит и уведомление записываются одной транзакцией.
11. Уникальность уведомления: `(source_event_id, recipient_id)`.
12. Уникальность идемпотентности: `(user_id, operation, key)`. Ключ истекает через 24 часа, но уже применённые бизнес-изменения не отменяются.
13. Номер создаёт PostgreSQL sequence с префиксом проекта и годом подачи; последовательность может быть сквозной между годами.
14. P0 не удаляет отправленные идеи, события и комментарии через пользовательский API. Это не определяет юридический срок хранения.

Ограничения выражаются FK/CHECK/unique там, где это возможно. Межтабличные правила дополнительно проверяет application service. Не полагаться исключительно на валидацию React.

### 3.4. Индексы

`users(email_normalized)`; `sessions(token_hash)`; `ideas(author_id, updated_at desc, id)`; `ideas(region_id, organization_id, status, created_at desc, id)`; `ideas(region_id, territory_id, effective_category_code)`; `idea_events(idea_id, created_at, id)`; `comments(idea_id, created_at, id)`; `notifications(recipient_id, read_at, created_at desc)`; `attachments(idea_id)`.

Для хакатонного объёма допустим параметризованный `ILIKE` в рамках авторизованного набора. Масштабирование поиска — отдельно после измерений. Индекс `%подстрока%` не обещать ускорить обычным B-tree.

## 4. Проекции чтения

`CitizenIdeaDetail` включает своё предложение, разрешённые файлы, публичные события/комментарии, текущий маршрут и отображаемое имя ответственного. Не включает внутренние заметки, email других сотрудников, хеши, storage keys.

`StaffIdeaDetail` включает контакты автора и внутренние заметки, но только при текущем доступе к организации. Список не обязан возвращать полный email автора: контакт нужен в карточке, не во всех строках.

P1 `PublishedIdea` — отдельный whitelist DTO. Никогда не использовать `return {...idea, author: user}` с последующим удалением нескольких секретных полей.

## 5. Формат API

Успех чтения/записи:

```json
{
  "data": { "id": "4ce2f417-198d-4052-921a-0b0329cb8b88", "version": 3 },
  "meta": { "requestId": "req_demo_01" }
}
```

Ошибка:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Проверьте заполнение формы",
    "fields": { "solution": "Опишите решение подробнее: минимум 30 символов" }
  },
  "meta": { "requestId": "req_demo_02" }
}
```

Список: `data: []`, `meta: {requestId, page, pageSize, total}`. Пустой список — `200`. Сортировка стабильная: выбранное поле + `id`. Не возвращать SQL/stack trace пользователю.

Коды: `400 VALIDATION_ERROR`; `401 UNAUTHENTICATED`; `403 FORBIDDEN/CSRF_INVALID`; `404 NOT_FOUND` для чужого объекта; `409 VERSION_CONFLICT/INVALID_TRANSITION/IDEMPOTENCY_CONFLICT`; `413 FILE_TOO_LARGE`; `415 UNSUPPORTED_FILE_TYPE`; `429 RATE_LIMITED`; `503 SERVICE_UNAVAILABLE`.

## 6. Endpoints P0

### 6.1. Вход и справочники

| Метод и путь | Тело/ответ | Доступ |
|---|---|---|
| `POST /api/v1/auth/register` | displayName, email, password, consentAccepted; сессия | Гость |
| `POST /api/v1/auth/login` | email, password; сессия | Гость |
| `POST /api/v1/auth/logout` | отзыв текущей сессии; 204 | Вход выполнен |
| `GET /api/v1/auth/me` | id, displayName, role, organization, csrfToken | Вход выполнен |
| `GET /api/v1/catalogs` | категории, активные территории, версия | Всем; только несекретные поля |
| `GET /api/v1/staff/assignees?organizationId=...` | id + displayName активных сотрудников | STAFF своей организации / ADMIN региона |
| `GET /api/v1/admin/organizations` | активные организации региона | ADMIN |

Регистрация всегда задаёт `CITIZEN` сервером. `csrfToken` не передаётся в query string и не сохраняется в логах.

Обновление 2026-09-30: CSRF стабилен в пределах сессии; `/me` не ротирует его.
Строгие runtime write-схемы — `src/contracts/requests.mjs`; дополнительные typed
результаты — `src/contracts/index.ts`. Точный frontend handoff:
`agents/BACKEND_HANDOFF_2026-09-30.md`.

Реализованы `POST /api/v1/ideas/routing-preview` (CITIZEN, без сохранения,
`meta.preview=true`) и `GET /api/v1/analytics/summary` (STAFF своей организации,
ADMIN выбранной организации). `GET /notifications` добавляет полный
`meta.unreadCount`. Dates-фильтры YYYY-MM-DD включают весь календарный день
Asia/Qyzylorda. `Retry-After` передаётся через bridge.

### 6.2. Житель и карточка

| Метод и путь | Описание |
|---|---|
| `POST /api/v1/ideas` | Создать частичный `DRAFT`, 201; Idempotency-Key обязателен |
| `PATCH /api/v1/ideas/:id` | Изменить только собственный черновик, expectedVersion |
| `POST /api/v1/ideas/:id/submit` | Полная валидация, маршрут, номер, RECEIVED; expectedVersion + Idempotency-Key |
| `GET /api/v1/ideas?scope=mine` | Только свои идеи; page, pageSize, status, q |
| `GET /api/v1/ideas/:id` | Ролевой DTO; `version` обязателен |
| `GET /api/v1/ideas/:id/timeline` | Отфильтрованные по доступу события |
| `POST /api/v1/ideas/:id/clarifications` | Ответ автора в NEEDS_INFO, expectedVersion, body, Idempotency-Key |
| `POST /api/v1/ideas/:id/attachments` | Один multipart file, expectedVersion; DRAFT/NEEDS_INFO автора |
| `DELETE /api/v1/ideas/:id/attachments/:attachmentId` | Только свой файл в DRAFT, expectedVersion в JSON; soft delete + уборка |
| `GET /api/v1/attachments/:id/download` | Проверка доступа к идее; поток файла; не публичный URL |

`PATCH draft` принимает только поля формы; статус, номер, authorId, organizationId и assignedTo запрещены. Attachment endpoint возвращает метадату и новую `ideaVersion`.

### 6.3. Сотрудник, комментарии и уведомления

| Метод и путь | Тело / поведение |
|---|---|
| `GET /api/v1/ideas?scope=staff` | Сервер ограничивает организацию; фильтры q/category/territory/status/assignee/unassigned/dateFrom/dateTo |
| `POST /api/v1/ideas/:id/assignment` | assigneeId или null, expectedVersion, Idempotency-Key; сброс допустим, если не выполняется переход статуса |
| `POST /api/v1/ideas/:id/status` | toStatus, publicComment?, resolutionType?, takeOwnership?, expectedVersion, Idempotency-Key |
| `POST /api/v1/ideas/:id/comments` | visibility, body, expectedVersion, Idempotency-Key; в P0 только STAFF/ADMIN |
| `POST /api/v1/admin/ideas/:id/reroute` | organizationId, effectiveCategoryCode, reason, expectedVersion, Idempotency-Key |
| `GET /api/v1/notifications` | Только свои; unreadOnly, page, pageSize |
| `POST /api/v1/notifications/:id/read` | Только своё; идемпотентно, 204 |
| `GET /api/health/live` | Процесс отвечает; без секретов |
| `GET /api/health/ready` | БД и схема готовы, uploads доступны; 200/503 |

`scope=staff` от жителя запрещён; переданный `organizationId` не расширяет доступ. Для ADMIN используется `scope=admin` и явный фильтр организации; регион по сессии.

`takeOwnership: true` разрешён сотруднику при `RECEIVED -> UNDER_REVIEW`: назначение на себя и переход атомарны. Одновременные попытки двух сотрудников разрешаются version check, не принципом «последний перезаписал».

### 6.4. Пример отправки

```http
POST /api/v1/ideas/4ce2f417-198d-4052-921a-0b0329cb8b88/submit
Content-Type: application/json
Idempotency-Key: 1b58a44b-04db-4b47-a7db-5714df85b7ab
X-CSRF-Token: <session-csrf-token>

{"expectedVersion": 4, "consentAccepted": true}
```

```json
{
  "data": {
    "id": "4ce2f417-198d-4052-921a-0b0329cb8b88",
    "publicNumber": "ABAI-2026-000123",
    "status": "RECEIVED",
    "version": 5,
    "routing": {
      "source": "RULES",
      "mode": "ASSIGNED",
      "effectiveCategoryCode": "TRANSPORT",
      "organizationCode": "DEMO_TRANSPORT",
      "tags": ["SAFETY", "SMART_CITY"],
      "confidenceBand": "HIGH",
      "ruleVersion": "rules-v1",
      "explanation": "Признаки «светофор» и «дорога» указывают на транспорт. Тема безопасности сохранена как дополнительная."
    }
  },
  "meta": { "requestId": "req_demo_03" }
}
```

`organizationCode` — представление справочника, серверная связь — UUID. Confidence — оценка определённости правил, не вероятность правильности в процентах.

## 7. Идемпотентность и конкуренция

Клиент генерирует новый UUID-ключ для каждого нового намерения записи. При повторе после сетевой ошибки использует тот же ключ и точно то же тело. Новый изменённый запрос получает новый ключ. В записи идемпотентности хранится хеш канонического JSON и минимальный ответ без лишних контактов.

Обработка конкурентного одинакового ключа: атомарная вставка под unique constraint; конкурент ждёт завершения/читает зафиксированный результат. Отмена транзакции удаляет незавершённую вставку. Повтор с тем же ключом и другим телом — `409 IDEMPOTENCY_CONFLICT`.

Все изменения идеи требуют `expectedVersion`, кроме первого создания. SQL-паттерн — row lock + проверка либо условный UPDATE по `(id, version)`, согласованный с остальными вставками внутри транзакции. После конфликта UI предлагает обновить карточку, сохраняя набранный комментарий, и не повторяет автоматически бизнес-действие с новой версией.

## 8. P1 endpoints — не блокируют P0

`POST /ideas/:id/analysis` ставит AI-анализ в очередь, возвращает `202 + analysisId`; `GET /ideas/:id/analysis/:analysisId` возвращает PENDING/RUNNING/READY/UNAVAILABLE/STALE. `POST /ideas/:id/improve-draft` предлагает текст, не записывая его автоматически. `GET /ideas/:id/similar` соблюдает доступ. `GET /analytics/summary` агрегирует текущий scope. Витрина `/published-ideas` использует отдельную таблицу/проекцию и проверенное согласие.

P1 таблицы: `ai_analyses`, `jobs`, `published_ideas`. Их поля и миграции добавляются только после закрытия P0, чтобы не раздувать обязательную схему.

## 9. Проверка контракта

A фиксирует `src/contracts` первым. B реализует сервер по этим DTO; C строит typed API client и временные mock fixtures по тем же схемам; D создаёт контрактные тесты. Mock-флаг удаляется из production-сценария перед приёмкой. Финальная проверка запрещает скрытую подмену backend локальными массивами.
