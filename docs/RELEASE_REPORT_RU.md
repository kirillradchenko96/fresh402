# Fresh402 2.0 RC — технический аудит и готовность

Дата: 8 октября 2026. Версия: `2.0.0-rc.1`. Ветка: `feature/fresh402-v2-beta`. Работа продолжает существующий [Draft PR #8](https://github.com/kirillradchenko96/fresh402/pull/8).

## 1. Обнаруженные ошибки

- После успешного settlement результат существовал только в памяти. Сбой Worker/доставки мог оставить клиента без ответа, а replay claim блокировал повторный запрос.
- Settlement, запись финансового события и snapshots выполнялись раздельно без сохраняемого плана восстановления. После сбоя snapshots нельзя было безопасно завершить операцию в новом экземпляре Worker.
- Обязательное резервирование авторизации находилось в `onAfterVerify`. x402 SDK 2.27.0 перехватывает ошибки hooks: исключение D1 само по себе не является надёжным запретом выполнения. SDK также поддерживает повтор settlement при `settlement_pending`.
- `payment_claims` не очищались автоматически; операции не имели точного глобального дневного бюджета, а rate-limit bindings ограничивают отдельные Cloudflare locations и не являются финансовым лимитом.
- Несколько HTMLRewriter handlers задавали `onEndTag` одному элементу и перезаписывали bookkeeping scope. Вложенные селекторы могли включать внешний текст. Не все границы HTML обеспечивали пробелы; существовал риск квадратичных сравнений одинаковых блоков.
- Документация ссылалась на публичную маршрутизацию Cloudflare как на дополнительную гарантию против DNS rebinding. Текущая документация описывает маршрутизацию и обход same-zone origin, но не гарантирует pinning произвольного TLS peer.
- Проверяемой изолированной staging-конфигурации не было.
- Заключительная проверка выявила неполную валидацию DNS IP syntax и пропущенные special-purpose/transition диапазоны. Добавлены канонический разбор IP, блокировка этих диапазонов и шесть дополнительных DNS regression cases.

## 2. Выполненные исправления

Добавлена аддитивная миграция `0008_release_hardening.sql`: приватный журнал `payment_operations`, trigger однократного завершения и дневной `operation_budget`. Миграции 0001–0007 не переписаны. Старые watch IDs, таблицы истории, normalizer version 2, маршруты `/v1/*`, цены и существующий Bazaar patch сохранены.

Результат и план серверных SQL-записей сохраняются **до** отправки settlement. Обязательные проверки находятся в facilitator adapter. Переход `prepared -> settling` атомарен и дополнительно проверяет живую capacity lease: Worker с потерянной lease не может начать списание. Повторный вызов адаптера, включая внутренний SDK retry, не отправляет авторизацию повторно.

Успешный receipt и `payment_events` фиксируются одной транзакционной D1 batch. Затем snapshots и `completed` фиксируются другой batch. Trigger откатывает дублирующую финализацию полностью. Ошибка snapshots оставляет сохранённый платный ответ, receipt и план для безопасного повторного завершения.

HTML scope теперь размечается отдельно, а сбор текста и закрытие элемента обслуживает единый handler. Текст не дублируется при вложенных совпадениях; корректно обрабатываются списки, вложенные параграфы, div/table/br, entities и Unicode. Добавлены лимит 10 000 HTML elements и предупреждение для бедного статического содержимого. Smart Diff использует индекс точных совпадений вместо квадратичного поиска. JSON сохраняет типы, порядок arrays и ключи, похожие на prototype properties.

## 3. Оставшиеся риски

Полной атомарности blockchain/D1/HTTP нет. Если Worker прекращает работу после маркера `settling`, но до сохранения receipt, факт списания может быть неизвестен. Такая операция остаётся закрытой для выдачи данных и повторного settlement до сверки оператором. Успешные ответы обычного потока доверяют CDP receipt; фиктивный facilitator подтверждает поведение программы, а не реальную mainnet-транзакцию.

DNS preflight повторно проверяет A/AAAA, private/reserved адреса и каждый redirect, но не привязывает фактическое соединение к проверенному IP. `global_fetch_strictly_public` не устраняет доказанным образом TOCTOU. Неограниченный публичный production требует проверенного egress решения либо отдельно согласованного запуска только на доверенных хостах. Staging ограничен разрешёнными оператором хостами и закрыт аутентификацией.

Extraction/Smart Diff детерминированы и эвристичны: без браузера, JS и LLM. HTML links/attributes и перестановки одинаковых блоков не являются самостоятельными semantic changes; legacy HTML сохраняет качество `legacy_text`. Warning о малом статическом тексте не гарантирует обнаружение всех JS-сайтов. CPU/memory на облачном Worker необходимо измерить в staging.

Общий HTTP/D1 расход не ограничивается полностью дневным счётчиком дорогих операций. Нужны account alerts/traffic controls. Финансовый журнал сохраняется вместе с платёжной историей; неопределённые операции требуют обработки оператором. Полный npm audit содержит 4 high advisories в dev-only цепочке `braces -> micromatch -> find-yarn-workspace-root -> patch-package`; runtime audit чист. Не применялось небезопасное `audit fix --force`.

## 4. Повторные платежи и восстановление

Клиент заранее генерирует и сохраняет отдельный секрет из 32 случайных байтов. REST передаёт его в `X-Fresh402-Recovery-Token`; MCP — в `_meta["fresh402/recovery-token"]`. В D1 сохраняется только SHA-256 секрета. Повтор исходных arguments, transport, service, payment proof и секрета возвращает тот же ответ/receipt без нового fetch, verify или settlement. Срок — семь дней от резервирования.

Известные transaction hash, nonce, watch ID или подпись не дают доступа. EIP-3009 подпись может стать публичной onchain; она не является recovery credential. Для совместимости секрет необязателен: старые клиенты получают обычный ответ, но не получают небезопасный неаутентифицированный replay. Потерянный секрет и legacy-инциденты требуют отдельно проверяемой аутентификации у оператора; универсальная доставка/возврат средств не реализованы.

Неопределённое списание выдаёт `settlement_pending` без платного содержимого и сохраняет quarantine target даже после истечения capacity lease. Подготовлена read-only утилита сверки: Base chain, finalized receipt, native USDC, прямой EIP-3009 calldata, payer/recipient/amount/nonce/expiry, события `AuthorizationUsed` и `Transfer`. Она создаёт защищённый SQL для проверки оператором, не применяет его и не отправляет транзакций. Indirect/batched calldata отклоняется. Подробный runbook: [PAYMENT_RECOVERY.md](PAYMENT_RECOVERY.md).

## 5. Очистка служебных данных

Cron подготовлен на каждые десять минут. Удаляются до 500 claims после `validBefore + 300 секунд`, истёкшие leases и до 500 never-submitted/failed операций после того же защитного окна. Действующая авторизация не становится повторно доступной; expiry проверяется также непосредственно перед settlement.

После семи дней очищаются payloads до 100 completed результатов за запуск; финансовые строки и receipt сохраняются. `settling` и unfinalized `settled` не удаляются автоматически. Служебные daily-budget counters старше 30 дней удаляются. Пользовательские watches, snapshots, baselines и `payment_events` cleanup не удаляет. На backlog и возраст неопределённых операций нужны оповещения.

## 6. Реально выполненные локальные проверки

| Проверка | Результат |
|---|---|
| Clean `npm ci` | Успешно; Bazaar patch 2.27.0 применён |
| TypeScript приложения и тестов | Успешно |
| Full Vitest в workerd | **174/174**, 6 файлов |
| Node tests сверки/staging guards | **21/21** |
| REST/MCP/x402 | Входят в полный suite: verify/settle/replay, совпадение цены, приватность, параллельность, modern MCP |
| Сбои платежей | До settlement, потеря lease, сетевой timeout, `settlement_pending`, ошибка receipt D1 и snapshots, restart/recovery |
| Миграции | 0006 → 0008 сохраняет watches/snapshots/payments; 0007 → 0008 сохраняет активные claims/leases |
| Production dry-run | Успешно: 1973.65 KiB / gzip 377.47 KiB; публикации нет |
| Staging dry-run | Успешно; отдельные D1/limiters/allowlist/budget |
| Runtime npm audit | **0 уязвимостей** |
| Gitleaks 8.30.1, SHA-256 архива проверен | Repository working-tree snapshot: секретов не найдено |
| OpenAPI / docs / git diff | Генерация, ссылки и whitespace проверяются перед commit |
| Local staging D1 | Все 8 миграций применены только локально |
| Local Explorer | Подтверждены `fresh402-staging` и отдельный local D1 sentinel; private bindings отсутствуют |
| Local Worker/Cron | Без staging secret `/` возвращает 403; scheduled cleanup выполнен; explorer traces `ok` |

Это **195 автоматизированных тестов**, а не 195 реальных платежей. Проверки не доказывают mainnet settlement, облачный load profile или DNS peer pinning. Реальные USDC-платежи не выполнялись.

## 7. GitHub Actions

Существующий Draft PR #8 сохраняется; заголовок и описание обновлены. CI дополнен Node tests, staging configuration guard и staging dry-run. [CI #19](https://github.com/kirillradchenko96/fresh402/actions/runs/37832041731) успешно прошёл для `e09fc15590e026176087382736a894b2c97789c7`: все шаги, включая clean install, оба TypeScript checks, suites, OpenAPI consistency, две сборки и runtime audit, завершились `success`. Дополнительный DNS hardening отправляется отдельным commit; окончательный exact-head результат проверяется в [checks PR #8](https://github.com/kirillradchenko96/fresh402/pull/8/checks) и указывается в финальной передаче. Локальное прохождение не подменяет GitHub Actions.

## 8. Что требуется для staging

Код, конфигурация, команды, safeguards и сценарии подготовлены: [STAGING.md](STAGING.md). С разрешения владельца необходимо создать **fresh402-staging-db**, заменить sentinel новым UUID, выдать независимые staging credentials/access secret, применить миграции только к staging и развернуть **fresh402-staging**. Guard отклоняет production D1 и ещё не provisioned sentinel. Directory/Bazaar discovery закрыт. Реальные платежи требуют отдельного разрешения.

## 9. Что требуется для production

Успешная облачная staging acceptance, измерение CPU/memory/стоимости, разрешённая проверка реальных платежей и finalized receipts, рабочая процедура reconciliation, отдельные cost/log retention controls, решение DNS TOCTOU и согласованный rollout/rollback. Перед rollback необходимо закрыть дорогие операции и обработать незавершённые платежи; версия 1.1.1 не умеет читать новый recovery journal. Аддитивные таблицы и пользовательские данные сохраняются.

## 10. Решение о запуске

**READY FOR STAGING** — код и изолированный план прошли локальные проверки, безопасное создание ресурсов оставлено владельцу. Это готовность к контролируемому staging-тестированию, не утверждение, что облачный staging уже создан.

**NOT READY FOR PRODUCTION** — облачные и реальные платёжные доказательства ещё отсутствуют; гарантия arbitrary-host DNS egress не установлена; эксплуатационные процедуры нужно подтвердить. Ограниченный публичный запуск пока не разрешается этим аудитом.

Merge, production deploy/migrations, Cloudflare secret changes, реальные USDC-транзакции, удаление существующих пользовательских данных и публикация staging в каталогах не выполнялись. Разработка Fresh402 2.1 и новые коммерческие услуги не добавлялись.
