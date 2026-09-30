# Размещение только на Vercel: оставшиеся работы

Классификация внешней LLM подходит serverless-схеме и уже реализована.
Сам сайт ещё не развёрнут в Vercel; настоящий cloud demo-flow NOT RUN.
Обычный Next.js deployment текущего дерева не запускает `scripts/serve.mjs`:
bridge и readiness будут обращаться к отсутствующему localhost API.
Текущий Compose с PostgreSQL и постоянными volumes автоматически не переносится.

Чтобы весь проект размещался на Vercel, нужно:

1. Подключить существующий Node API как Vercel Function/Service или смонтировать
   текущий handler в Next server routes. Сохранить `/api/v1/*`, DTO и политики.
   Для Services проверить текущую доступность аккаунта и правила маршрутов:
   [официальное описание](https://vercel.com/docs/services).
2. Подключить управляемую PostgreSQL, использовать pooled connection и
   singleton pool на экземпляр. Запускать миграции отдельным шагом, без
   demo seed в production. База Preview должна быть отдельной:
   [Postgres](https://vercel.com/docs/postgres),
   [pool management](https://vercel.com/kb/guide/connection-pooling-with-functions).
3. Заменить постоянный `UPLOAD_DIR` закрытым объектным хранилищем.
   `/tmp` использовать только для проверки файла. Скачать файл можно лишь
   после проверки текущего автора/роли/организации. Случайный публичный URL
   не заменяет доступ: [private Blob](https://vercel.com/docs/vercel-blob/private-storage).
4. Сохранить 5 MiB через direct client upload с коротким scoped token,
   последующей серверной проверкой содержимого и атомарной привязкой к идее.
   Обычный Function payload ограничен 4,5 MB; текущий multipart не гарантирует
   загрузку 5 MiB. Уменьшение лимита — только отдельное продуктовое решение:
   [лимиты](https://vercel.com/docs/functions/limitations),
   [client uploads](https://vercel.com/docs/vercel-blob/client-upload).
5. Перенести остальные auth/register/submit/upload лимитеры в общий store;
   текущая защита платных вызовов модели уже использует PostgreSQL.
   Настроить доверенный IP от ingress Vercel, HTTPS Origin и Secure cookies.
6. Readiness должен проверять управляемую БД, все миграции и конфигурацию
   закрытого хранилища, а не постоянный локальный writable uploads-directory.
7. Проверить полный опубликованный сценарий, приватность вложений,
   потерю доступа после перенаправления и сохранность после redeploy.

Это перечень необходимых изменений, а не заявление, что cloud deployment
готов. Vercel account/project, production PostgreSQL и Blob здесь не создавались,
тарифы не приобретались. Локальные проверки backend описаны отдельно.
