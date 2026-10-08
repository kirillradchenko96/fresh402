# Fresh402 2.0 RC: исправление регистрации и облачный staging

Дата: 8 октября 2026. Ветка: `feature/fresh402-v2-beta`, существующий Draft PR #8.

Staging URL: https://fresh402-staging.kirilllabs.workers.dev

Исправленная версия Worker: `957a9d85-e517-4cc0-8670-ef14a0f2cb01`. Deployment выполнен исключительно через `wrangler deploy --env staging`. Production Worker, D1 и secrets не изменялись.

## Точная причина HTTP 500

Полный ответ `POST /v1/register` содержал `error: check_failed` и сообщение:

```text
Invalid redirect value, must be one of "follow" or "manual" ("error" won't be implemented since it does not make sense at the edge; use "manual" and check the response status code).
```

Исключение возникало при первой DNS-over-HTTPS загрузке в `src/dns.ts`: использовался `fetch(..., {redirect:"error"})`. Развёрнутый edge runtime отклонял этот режим до загрузки целевой страницы, нормализации и записи watch. Поэтому D1 оставалась без watches/snapshots, а admission budget уже учитывал запрос. Generic catch в core превращал исключение в HTTP 500 с `fresh402_core_error internal_error`.

Локальные mock fetch не проверяли это ограничение реального edge runtime. TypeScript/общая документация Fetch также не были достаточным доказательством работоспособности этого режима на развёрнутом Worker.

## Исправление и защита

DNS запросы используют `redirect:"manual"`. Существующий non-2xx guard отклоняет любой DNS redirect и отменяет его тело; новый адрес не загружается. Проверки A/AAAA, mixed public/private answers, reserved IP, redirect destinations, тайм-ауты, allowlist, аутентификация, rate limits и D1 gates сохранены.

Неожиданные исключения больше не возвращают `error.message` клиенту. Сохраняются HTTP 500 и совместимый код `check_failed`, но message фиксирован: `Unable to process the target. Retry later.` Логи содержат только фиксированные event/error codes. Ожидаемые input/network errors сохраняют свои публичные коды.

Добавлены четыре regression cases: Workers-compatible DNS mode, запрет DNS redirect, безопасная обработка исключений D1 lookup и D1 insert. Ошибки SQL/ключи/приватные данные не появляются ни в ответе, ни в application logs. Дополнительные staging-only события не понадобились: точное исключение установлено по полному HTTP response.

## Проверки

- TypeScript приложения и тестов: успешно.
- Full Vitest в workerd: **178/178**, 6 файлов.
- Node proof/staging guards: **21/21**. Всего **199** автоматизированных тестов.
- Staging build: **1973.62 KiB / gzip 377.46 KiB**.
- Cloud smoke: все проверенные unauthenticated маршруты — 403; неверный token — 403; authenticated health/OpenAPI — 200; x402/Glama directory discovery — 404.
- REST register — 200; повтор и MCP register возвращают тот же watch/hash/checked_at без обновления baseline. В D1 один watch и один snapshot; сохранён ожидаемый текст Example Domain.
- MCP tools/list — четыре инструмента; history/diff — 200.
- REST Check/Extract/Smart Diff — ожидаемый **503 payment_unavailable**. Все три MCP paid tools возвращают `isError` с `payment_unavailable`. Платёжная проверка не обходилась, публичный mock facilitator не добавлялся.
- Wrangler tail после исправления подтверждает `outcome: ok`, регистрацию HTTP 200 и ожидаемые HTTP 503 платных REST routes. Заголовки, токены, payloads и содержимое страниц отфильтрованы до вывода/сохранения диагностических событий.

## Изоляция и доступ

Единственный облачный D1 binding: `fresh402-staging-db`, UUID `ba10c4f4-d845-4f6f-9494-b0592dcaf19b`. Миграции 0001–0008 уже применены. Production UUID `0339b063-141f-49e4-9dc7-0fe251a6a3c2` в staging bindings отсутствует.

Облачные settings проверены: CPU 1000 ms, subrequests 50, отдельные rate-limit namespaces `4023001–4023003`, budget 1000/day UTC, allowlist `example.com`, previews выключены. Cron: `*/10 * * * *`.

Реальное выполнение Cron подтверждено Wrangler tail: 8 октября 2026, 20:40:51 UTC, `outcome: ok`. Специальная уже истёкшая техническая claim была удалена самим scheduled cleanup: количество изменилось с 1 на 0. Watch и snapshot сохранились по одному; paid operations осталось 0, migration/backfill payment rows — 3. Публичный endpoint для запуска Cron или обхода платежей не добавлялся.

Токен — отдельный 256-битный `secret_text`. Локальная копия защищена CurrentUser DPAPI и owner-only ACL вне Git: `%LOCALAPPDATA%\Fresh402\staging\access-token.dpapi`. [Скрипт доступа](../scripts/staging-access.ps1) поддерживает копирование в локальный clipboard и smoke без печати секрета. Временный plaintext upload file удалён. Production CDP credentials не копировались.

В staging нет новых paid operations. Три строки `payment_events` — fixtures/backfill миграции 0005, а не реальные транзакции текущих smoke tests.

## Следующий этап

Staging готов к следующей контролируемой проверке. Для реального paid execution нужны независимые staging CDP credentials и отдельное разрешение владельца на USDC-транзакции. Затем необходимо проверить реальные verify/settle/finality, recovery после отключения клиента и reconciliation. Результаты mock facilitator не доказывают mainnet settlement. Неограниченный production по-прежнему требует решения DNS TOCTOU и эксплуатационной acceptance.

Команды и доступ: [STAGING.md](STAGING.md). Итоговый GitHub SHA/CI фиксируется в Draft PR #8 и финальной передаче.
