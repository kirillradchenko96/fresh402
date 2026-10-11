# Fresh402 2.0 Beta — технический отчёт

Дата: 8 октября 2026. Версия: `2.0.0-beta.1`. Основа: актуальный `main`, `3378225` (исправление Bazaar, PR #7).

- [Ветка feature/fresh402-v2-beta](https://github.com/kirillradchenko96/fresh402/tree/feature/fresh402-v2-beta)
- [Draft PR #8 в main](https://github.com/kirillradchenko96/fresh402/pull/8)

Результат — работающий код Beta с автоматическими проверками, опубликованный для review. Production не обновлялся. Merge, реальные платежи, изменение секретов и операции с production D1 не выполнялись.

## 1. Реально реализовано

**Freshness Check:** сохранены `/v1/*`, бесплатная регистрация, watch IDs, normalizer version 2, HTML/JSON/text, фильтрация шума, conditional HTTP, cache и прежний deterministic diff. Миграции 0001–0006 и патч Bazaar не изменены. Платные записи теперь применяются после успешного settlement, чтобы неудачная оплата не открывала свежие данные через публичную историю.

**Web Extract:** отдельный REST endpoint и MCP tool, извлечение основного текста, title/description/canonical, headings, ссылок и JSON-LD. Поддержаны CSS scope, ignore rules, JSON и text, ограничения размера и явные ошибки. Нет браузера, выполнения JavaScript страницы или внешнего LLM.

**Smart Diff:** отдельный сервис со сравнением JSON по JSON Pointer, сопоставлением HTML/text блоков, списками added/removed/modified и объяснимыми правилами значимости. Поддержаны previous/baseline/previous_hash. Есть отдельная фиксированная baseline и до 20 платных структурных снимков; старые HTML baseline явно помечаются `legacy_text`.

**Биллинг и безопасность:** единый каталог цен и схем, настоящий x402 SDK, проверка оплаты до загрузки цели, выдача результата после settlement, защита от повторного nonce, глобальные D1 leases и сериализация операций с одной целью. Ограничены тела, ответы, время, redirects, JSON/HTML complexity. Добавлена проверка DNS A/AAAA/CNAME на каждом переходе. MCP проверяет Origin и поддерживает актуальный формат 2026 и stateless compatibility 2025.

**Аналитика:** дневные агрегаты discovery/docs, регистрации, первоначальные 402, attempts, verified/settled payments, paid results и повторные платные обращения. Технические запросы выделяются документированными эвристиками. В агрегатах нет URL, IP, тел, содержимого страниц, подписей и секретов. Выручка считается по подтверждённым уникальным settlement, не по 402.

## 2. Следующие версии

Batch Check, Price Track, Smart Alerts и API keys/prepaid credits спроектированы через точки расширения, но не выданы за готовые endpoints. Также отложены browser rendering, LLM semantic diff, private ownership, автоматические refunds и надёжное восстановление платного ответа после аварии.

См. [архитектуру](ARCHITECTURE.md) и [roadmap 2.1](ROADMAP.md).

## 3. Публикация

До разработки подтверждены права репозитория и успешный `git push --dry-run` для новой ветки. Работа велась вне `main`. Код и документация отправлены отдельными commits.

GitHub-коннектор вернул 403 на создание PR. Draft PR успешно создан через уже настроенную Git-аутентификацию. Пользовательские токены не запрашивались и не публиковались.

## 4. Endpoints и MCP

| REST | MCP tool | Цена USDC |
|---|---|---:|
| `POST /v1/register` | `fresh402_register` | Бесплатно |
| `POST /v1/check` | `fresh402_check` | 0.005 |
| `POST /v2/extract` | `fresh402_extract` | 0.01 |
| `POST /v2/smart-diff` | `fresh402_smart_diff` | 0.015 |

Сеть — Base Mainnet, `eip155:8453`, x402 v2 exact USDC. Старые history/diff/stats и discovery endpoints сохранены. OpenAPI и manifest перечисляют три платных сервиса. Существующий registry manifest оставлен для опубликованной версии: Beta не объявляется уже развёрнутой.

## 5. Фактически выполненные проверки

| Проверка | Результат |
|---|---|
| Чистая установка `npm ci` | Успешно, Bazaar patch применён; первая попытка встретила временную Windows-блокировку файла, повторная прошла |
| TypeScript приложения и тестов | Успешно |
| Полный Vitest/workerd suite | **139 тестов, 6 файлов — успешно** |
| Существующие сценарии 1.1.1 | Включены в полный suite; обновлены ожидаемые version/manifest metadata и изолированы DNS fixtures |
| Переход существующей D1 с 0006 на 0007 | Старые watch/snapshot/payment записи сохранились без изменений |
| Платежи REST/MCP | Настоящий SDK + подставной facilitator: цены/challenges, отказ, settlement failure, replay, отсутствие бесплатного результата/записи |
| Устойчивость | Size/timeout/SSRF/redirect/DNS, quotas, capacity, retention, persistence failure после settlement |
| Production bundle dry-run | Успешно: 1958.82 KiB, gzip 373.73 KiB; deploy не выполнялся |
| `npm audit --omit=dev` | **0 vulnerabilities** |
| Полный dependency audit | 4 high advisories одной dev-only цепочки braces → micromatch → find-yarn-workspace-root → patch-package; исправленной braces-версии на момент проверки нет |
| OpenAPI generation, локальные ссылки, `git diff --check` | Успешно |
| Проверка известных шаблонов секретов | Совпадений в 61 Git-кандидате не обнаружено; это ограниченная проверка, не доказательство отсутствия любых секретов |
| TypeScript example | Проверен TypeScript, выполнен с mocked fetch без сети |
| Python example | Python 3.13: синтаксис, импорт и запрет redirect проверены без сети |

CI в PR повторяет установку, TypeScript, полный suite, проверку актуальности OpenAPI, bundle dry-run и runtime audit. Его актуальный статус доступен в [Checks PR #8](https://github.com/kirillradchenko96/fresh402/pull/8/checks).

Сетевые/mainnet end-to-end платежи и production нагрузочные испытания **не выполнялись**. У SDK остаются предупреждения о отсутствующих исходниках sourcemap; они не мешают тестам/сборке.

## 6. Риски и ограничения

1. **DNS:** preflight проверяет адреса и redirects, но Workers fetch повторно разрешает hostname. Код не может закрепить произвольный TLS peer IP; остаётся граница TOCTOU и зависимость от публичной outbound-изоляции Cloudflare. Перед широким доступом нужна отдельная проверка этой границы в staging.
2. **Платёж и доставка:** settlement и D1 не атомарны. При аварии после оплаты ответ может потеряться; автоматического refund/replay пока нет. При обычной ошибке сохранения возвращается оплаченный результат с `persistence_error`.
3. **Смысл изменений:** Smart Diff детерминированный. Значимость — объяснимая эвристика, не вероятность и не понимание смысла. Старые HTML baseline дают меньшую точность блоков. Фиксированная baseline не восстанавливает уже удалённую историей исходную версию.
4. **Сайты:** только доступный HTTP-контент; JS-only/authenticated pages не поддержаны. Нет обхода CAPTCHA, proxy rotation или авторизации. Автоматический robots.txt parser не реализован; доступ должен соответствовать правилам источника.
5. **Данные и расходы:** v1 watches/history общие и публичные; ownership ещё нет. Free baseline storage растёт со временем. Rate-limit bindings работают по локациям; глобальная параллельность отдельно ограничивается D1.
6. **SDK/dependencies:** сохранены проверенные x402 2.27.0/MCP server 2.1.0 ради совместимости с патчем. Более новые опубликованные версии не объявляются протестированными. Dev-only advisory требует контроля перед релизом.

Подробности: [SECURITY.md](SECURITY.md), [PRICING.md](PRICING.md), [ANALYTICS.md](ANALYTICS.md).

## 7. Что потребуется для будущего deploy

- Проверка и одобрение владельцем; отдельная staging D1 без production данных.
- Backup по принятой процедуре и применение только новой additive миграции 0007 до выпуска Worker.
- Новый binding `REQUEST_LIMITER` (120/60s, namespace 4022001), сохранение двух старых limiter bindings и `DB`.
- Существующие `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET`, прежние recipient/network и compatibility flag. Секреты в ходе работы не изменялись.
- Проверка account limits/cost alerts/observability и процедуры сверки неясного settlement.
- Откат: прежний Worker без удаления новых таблиц и без отката базы на устаревший backup.

См. [DEPLOYMENT.md](DEPLOYMENT.md).

## 8. Как проверить Beta до релиза

```sh
git fetch origin
git switch feature/fresh402-v2-beta
npm ci
npm run typecheck
npm run test:run
npm run build
npm audit --omit=dev --audit-level=high
```

На Windows при ограничении PowerShell использовать `npm.cmd`/`npx.cmd`. Затем при необходимости применить миграции **локально** (`npx wrangler d1 migrations apply fresh402-db --local`) и запустить `npm run dev`. Проверить root/OpenAPI и MCP `tools/list`. Без CDP конфигурации платные операции закрыты; полный сценарий без денег воспроизводится автоматическими тестами.

Для review: [REST](API.md), [OpenAPI](openapi.json), [MCP](MCP.md), [curl/TypeScript/Python](../examples/README.md), [позиционирование](POSITIONING.md), [CHANGELOG](../CHANGELOG.md). Польза Fresh402 — обслуживание baseline, безопасной загрузки, нормализации и сравнения за агента; простое умение открыть URL само по себе не является конкурентным преимуществом.
