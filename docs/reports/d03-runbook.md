# D-03 — сквозной demo-flow (resident → routing → queue → status)

Владелец: D. Стенд: сборка A-02 (backend+frontend) на Compose PG17.
Адрес стенда, API base, сиды и учётки — от A (запрошены msg 116/146).

## Flow A — resident submit → staff queue → assign/status/comment → resident
1. Регистрация жителя (201), черновик (201), attach PNG (201), submit (200):
   publicNumber `ABAI-2026-N`, route org = TRANSPORT для светофорной идеи.
2. Очередь staff (`GET /ideas?scope=staff`): идея видна своей организации.
3. Assign 200 (assigneeId выставлен), `UNDER_REVIEW` 200.
4. PUBLIC- installment 201 + INTERNAL-заметка 201.
5. Refetch карточки/истории жителем: текст PUBLIC-ответа виден дословно;
   событий/тел INTERNAL нет нигде (ни типов, ни текста).
6. Уведомления жителя: есть PUBLIC_REPLY / смена статуса; прочтение 204.

## Flow B — triage / NEEDS_INFO / REJECTED + негативы
1. `NEEDS_INFO` 200 только с `publicComment`; ответ жителя 200 → UNDER_REVIEW.
2. Все 6 статусов достижимы легальными переходами; нелегальный прыжок → 409.
3. Reroute (admin): 200, assignee сброшен, новая организация; история содержит REROUTED.
4. Негативы API: 401 без cookie, 403 житель на staff-операции и кросс-орг assign,
   404 чужой scope, 409 stale expectedVersion, 415 SVG-маскарад, 413 oversize.

## Критерии готовности D-03
- Живой прогон Flow A/B против стенда A-02 на PG17 (не PGlite, не копия).
- PUBLIC-текст у жителя дословно после обновления; INTERNAL скрыт.
- Ни одного NOT RUN без причины; дефекты — владельцам с SHA/шагами.
- D-03 отмечается DONE только после живого прогона.

## Исполнение
- Недеструктивно: без reset/migrate чужой БД; уникальные email `d03-*@example.test`.
- Проба: `/tmp` `probe-d03.mjs` (`STAND_API`, staff/admin email через env, сиды стенда).
- Браузерные шаги (карточка/очередь/390px/обновление страницы) — вручную по этому чек-листу
  против frontend-URL стенда; скрины — в `docs/reports/screenshots/d03-*`.
