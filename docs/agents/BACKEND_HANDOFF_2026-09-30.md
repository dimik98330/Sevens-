# Backend → frontend: интеграция после доработки

Обновление классификатора: `CLASSIFIER_MODE=llm`, GPT-6 Sol + `rules-v2`
fallback, миграции 0005 и 0006. Реальный серверный preview уже подключён
в мастере; preview/submit могут переиспользовать результат. Новые поля
`detectedCategoryCode`, `classificationSource`, `classifierStatus`,
`classificationMethod`, `catalogVersion` показывают тему и источник без
внутреннего анализа. AUTO и TRIAGE не означают, что житель выбрал OTHER.
Ручной маршрут не показывать как уверенность модели.
327 unit, 161 integration, 14 PostgreSQL PASS; production browser PASS.
Подробности: [классификатор](../reports/CLASSIFIER_IMPLEMENTATION_2026-09-30.md).
`.env.sevens` уже выбран llm; основной API 18081 перезапущен с новыми
переменными, миграции применены, readiness PASS. Next 3100 и PG сохранены.
Развёртывание всего backend на Vercel ещё не готово:
[оставшиеся работы](../reports/VERCEL_DEPLOYMENT_GAPS_2026-09-30.md).

Задача BACKEND-IMPLEMENTATION, ветка `codex/sevens-experience`, исходный HEAD `d66d2b1`, текущие незакоммиченные изменения. Layout, компоненты и CSS чата фронтенда сохранены. Единственная совместимая правка страницы staff — показ/валидация причины при ручном NEEDS_INFO→UNDER_REVIEW; тестовый fake ZoomControl обновлён под параллельную правку карты. Общая БД/volumes сохранены; проверки выполнялись в изолированных схемах/Compose-проекте.

## Сессия и повтор запроса

- `GET /api/v1/auth/me` возвращает `{data:{id,displayName,role,organizationId,csrfToken},meta:{requestId}}`. Токен стабилен до новой сессии. Старый токен до обновления auth однократно требует refresh `/me`; текущий frontend recovery можно сохранить.
- Все записи требуют cookie, правильный Origin и `X-CSRF-Token`.
- Новый пользовательский запрос получает новый `Idempotency-Key`; повтор после сетевой ошибки сохраняет тело и ключ. После 409 VERSION_CONFLICT не повторять действие автоматически с новой версией. Сохранить набранный текст и предложить обновление карточки.
- Ошибки: `{error:{code,message,fields?},meta:{requestId}}`. 429 содержит `Retry-After` в секундах. Bridge передаёт заголовок.
- `expectedVersion` — положительное целое число. Неизвестные поля отклоняются. `requestedCategoryCode:null` означает AUTO; строку AUTO не отправлять.

## Предпросмотр маршрута

`POST /api/v1/ideas/routing-preview`, только CITIZEN. Тело:

```json
{
  "title": "Умные светофоры рядом со школой",
  "problem": "Возле школы дорога требует внимания к безопасности детей.",
  "solution": "Установить умные светофоры и датчики загруженности дороги.",
  "requestedCategoryCode": null,
  "territoryId": "UUID из catalogs.territories[].id"
}
```

В примере UUID — поясняющий placeholder, не допустимое значение для отправки. Превью требует заполненных полей по тем же нижним/верхним лимитам формы: title 10–120, problem/solution 30–3000 символов. Не вызывать его для неполного ввода. Debounce, отмена старого запроса и проверка актуальности результата — на стороне формы.

Ответ: `data:{source,ruleVersion,effectiveCategoryCode,organizationCode,mode,confidenceBand,tags,reasonCodes,explanation}`, `meta:{requestId,preview:true}`. Нет записи идеи, статуса, событий или уведомлений. Показать как предварительную оценку. Официальный маршрут брать из submit/detail. В real-режиме заменить клиентский расчёт с DEV_CATALOG на этот endpoint.

## Уведомления и списки

`GET /api/v1/notifications?page=1&pageSize=20&unreadOnly=true` возвращает `data:Notification[]`, `meta:{requestId,page,pageSize,total,unreadCount}`. `unreadCount` относится ко всем непрочитанным уведомлениям пользователя, независимо от страницы и фильтра. Колокольчик брать из meta, не из `.filter()` текущей страницы.

`POST /api/v1/notifications/:id/read` с `{}` идемпотентен, 204. Карточку открывать по роли пользователя: гражданину `/ideas/:id`, сотруднику `/staff/:id`; старый орган после перенаправления может получить 404.

Для «Моих идей» и уведомлений подключить страницы из meta.total/page/pageSize. Очередь уже использует этот контракт. Допустимы `page≥1`, `pageSize=1..100`; неверный фильтр/сортировка/UUID даёт 400 с полем, а не 503.

Для формы `territoryId` — UUID. Для фильтра очереди `territory` — код из catalogs (`DEMO_SEMEY` и т.д.). `assignee=unassigned` обозначает отсутствие ответственного. `dateFrom/dateTo` — YYYY-MM-DD, включительно по Asia/Qyzylorda. Даты записей передаются в UTC.

## Аналитика

`GET /api/v1/analytics/summary` поддерживает те же фильтры доступной очереди: q/category/territory/status/assignee/dateFrom/dateTo. STAFF всегда ограничен своей организацией; ADMIN передаёт выбранный organizationId. Пагинация не влияет на агрегаты.

```ts
interface AnalyticsSummary {
  total: number;
  byStatus: Partial<Record<IdeaStatus, number>>;
  byCategory: Partial<Record<CategoryCode, number>>;
  unassigned: number;
  triage: number;
  medianFirstReviewSeconds: number | null;
}
```

Отсутствующие buckets считать нулём. `medianFirstReviewSeconds:null` — нет рассмотренных записей, показать «Нет данных». Не выводить это как 0% успешности. Статистика демостенда синтетическая.

## Workflow и файлы

- Публичный комментарий сохраняется на любом допустимом переходе. Для NEEDS_INFO/REJECTED/COMPLETED и служебного NEEDS_INFO→UNDER_REVIEW он обязателен.
- Поле и клиентская валидация причины для ручного NEEDS_INFO→UNDER_REVIEW уже добавлены в staff/[id]/page.tsx.
- Обычное снятие ответственного в NEEDS_INFO отклоняется; разрешено прямое переназначение. Ответ после административного reroute остаётся допустим без ответственного.
- В reroute effectiveCategoryCode можно не передавать: сервер сохраняет текущую заблокированную категорию.
- Multipart: ровно один `file` и `expectedVersion`. JPG/PNG/WebP/PDF, 5 MiB, максимум 3 активных файла; повреждённые изображения отклоняются. Текущий FormData-клиент совместим.
- INTERNAL заметки отсутствуют в citizen timeline на сервере. Названия статусов и существующие маршруты сохранены.

## Проверенная интеграция и дальнейший UI

Production HTTP проверяет отправку, назначение, PUBLIC/INTERNAL, уточнение, завершение, отклонение, reroute, отзыв доступа и сохранность файла после restart. Браузерный сценарий проходит реальные формы и кабинеты на отдельном стенде; новый preview/аналитику и full unreadCount фронтенду необходимо подключить по контрактам выше.

Локальный production стенд для review: адрес и результат находятся в `.data/backend-verification/release-report.json`. Действующий стенд 3100 этим чатом не перезапускался. Секреты только в игнорируемом локальном release.env; в handoff их нет.

На локальном loopback без доверенного ingress BRIDGE_CLIENT_IP_HEADER пуст: общий лимит регистраций применяется к адресу bridge. В публичном окружении включать подписанную передачу IP только за ingress, который перезаписывает выбранный заголовок и исключает прямой доступ к Next. Не доверять браузерному X-Forwarded-For.
