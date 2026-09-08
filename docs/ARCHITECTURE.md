# Архитектура кодовой базы

Документация по устройству приложения **Temnet Parser** — аналитики
хелпдеск-переписки ejabberd (XMPP).

- [1. Обзор](#1-обзор)
- [2. Стек](#2-стек)
- [3. Структура репозитория](#3-структура-репозитория)
- [4. Модель данных](#4-модель-данных)
- [5. Синхронизация и тикеты](#5-синхронизация-и-тикеты)
- [6. Backend](#6-backend)
- [7. Frontend](#7-frontend)
- [8. Сборка и запуск](#8-сборка-и-запуск)
- [9. Соглашения](#9-соглашения)

> Методология расчёта метрик вынесена в отдельный документ — см.
> [METRICS.md](METRICS.md).

---

## 1. Обзор

Приложение читает дамп базы **ejabberd** (MariaDB) — архив сообщений между
сотрудниками компаний-клиентов и поддержкой (аккаунты `help*`) — и отдаёт по
нему отчёты и аналитику:

- табличные отчёты по компаниям и пользователям;
- история переписки;
- заявки (тикеты), реконструированные из переписки;
- метрики: динамика, нагрузка по часам, время первого ответа (SLA), время
  решения, повторные обращения, аномалии, лидерборд операторов, категории.

Работают две базы. Дамп ejabberd приложение **только читает**; рядом оно
держит собственную аналитическую БД `temnet_analytics` (создаётся
автоматически), куда фоновая синхронизация складывает нормализованные
сообщения и тикеты. Все отчёты и метрики читают уже её — тяжёлая
нормализация (дедупликация MAM-копий, восстановление автора, сборка тикетов)
делается один раз при инжесте, а не на каждый запрос.

## 2. Стек

| Слой | Технологии |
| --- | --- |
| Backend | Java 25, Spring Boot 4, Spring Web MVC, Spring JDBC (`JdbcClient`/`JdbcTemplate`), MariaDB JDBC, Caffeine (кэш метрик), Gradle (toolchain JDK 25); LLM-классификация reopen'ов — через OpenAI-совместимый HTTP API (java.net.http + Jackson) |
| Frontend | React 19, Vite 5, TypeScript, Ant Design 5, TanStack Query, Apache ECharts, React Router, dayjs, ExcelJS |
| БД | MariaDB: схема ejabberd (источник) + `temnet_analytics` (своя) |

DTO на бэкенде — **Java records** (Lombok не используется). SQL вынесен в
ресурсы и грузится в рантайме.

## 3. Структура репозитория

```
temnet_parser_3.0/
├─ backend/temnet_parser_3.0/          Spring Boot приложение (порт 8080, API под /api)
│  ├─ build.gradle                     Java 25 toolchain, Spring Boot 4
│  ├─ settings.gradle                  foojay-resolver: JDK 25 скачивается сам
│  ├─ gradle/wrapper/                  Gradle wrapper (9.1.0)
│  ├─ db/                              схема + сид-данные для локальной проверки
│  └─ src/
│     ├─ main/java/com/temnet/temnet_parser/
│     │  ├─ Application.java           точка входа (@EnableScheduling)
│     │  ├─ config/                    DataSource'ы, CORS, проверки конфигурации на старте
│     │  ├─ security/                  вход, сессии, перепроверка учётки, лимитер входа, Scope
│     │  ├─ analytics/                 синхронизация, тикеты, LLM, /admin/sync
│     │  ├─ controller/                HTTP-слой (+ единый обработчик ошибок)
│     │  ├─ service/                   бизнес-логика
│     │  ├─ repository/                доступ к данным через JdbcClient, ScopeSql
│     │  ├─ dto/                       records (DTO + enum Bucket)
│     │  └─ support/                   SqlLoader, CategoryRules, ClosurePhrase, ReopenSignals, BusinessTime
│     ├─ main/resources/
│     │  ├─ application.properties     конфиг БД/сессий/sync/LLM (через env)
│     │  ├─ analytics/schema.sql       схема аналитической БД
│     │  └─ sql/                       SQL-запросы метрик (*.sql)
│     └─ test/java/...                 юнит-тесты support/ и ScopeSql; ApplicationTests (нужна MariaDB)
├─ frontend-react/                     React-приложение (Vite dev на 5173, /api → 8080)
│  └─ src/
│     ├─ main.tsx, App.tsx             bootstrap + роутинг
│     ├─ theme.tsx, styles.css         светлая/тёмная тема, CSS-переменные
│     ├─ api/                          client, query-хуки, типы
│     ├─ auth.tsx                      контекст входа и прав
│     ├─ components/                   AppLayout, EChart, StatCard, BrandMark,
│     │                                ChangePasswordForm, QueryError
│     ├─ lib/                          palette, antdTheme, chartTheme, date,
│     │                                excel, format
│     └─ pages/                        экраны
├─ run_backend.bat / run_frontend.bat  запуск
└─ docs/                               эта документация
```

## 4. Модель данных

### Источник (дамп ejabberd)

| Таблица | Колонки (используемые) | Смысл |
| --- | --- | --- |
| `archive` | `id`, `username`, `peer`, `bare_peer`, `txt`, `created_at`, `timestamp`, `xml` | сообщение: владелец архива, вторая сторона, текст, время, микросекунды, исходная станза |
| `sr_user` | `jid`, `grp` | принадлежность JID к группе (в т.ч. help-аккаунта к своему участку) |
| `sr_group` | `name`, `opts` | настройки общего ростера; `displayed_groups` — организации, которые обслуживает участок |

**Двойное хранение MAM.** ejabberd хранит каждое сообщение дважды — по копии
в архиве каждого участника, с переставленными `username`/`peer`. Поэтому
`username` — владелец архива, а не автор. Копии склеиваются по **stanza id**
из колонки `xml` — он у обеих копий одинаковый, тогда как `created_at` копий
может отличаться на секунду (копии пишутся с разницей в миллисекунды, иногда
через границу секунды). Автор — владелец **первой** копии пары: сервер
всегда пишет копию отправителя раньше копии получателя (проверено на всём
дампе). Эвристика «у копии получателя `peer` с ресурсом» используется только
для строк без пары — сама по себе она не различает стороны, когда ресурс
есть у обеих копий.

### Аналитическая БД (`temnet_analytics`)

Схема — [`analytics/schema.sql`](../backend/temnet_parser_3.0/src/main/resources/analytics/schema.sql),
создаётся при старте, стейтменты идемпотентны.

| Таблица | Смысл |
| --- | --- |
| `message` | одна строка на реальное сообщение диалога клиент ↔ поддержка: копии склеены (`dedup_hash`, UNIQUE), автор восстановлен, служебные строки отброшены |
| `ticket` | заявка, собранная стейт-машиной инжеста: `open` → `closed`/`rejected` (фраза оператора) или `expired` (клиент замолчал); FRT и время решения — в рабочих секундах, посчитаны при инжесте |
| `llm_verdict` | вердикты LLM по спорным reopen-кандидатам; ключ — (client, opened_at), поэтому полный пересбор не переплачивает за уже решённые случаи |
| `client_group` | членство клиентов в группах, копия `sr_user` |
| `help_account_group` | какие группы обслуживает каждый help-аккаунт; копия `displayed_groups` из `sr_group` ejabberd, обновляется при каждой синхронизации |
| `app_user` | учётки приложения: логин, bcrypt-хеш, роль (`admin`/`manager`/`user`) |
| `user_grant` | выданные доступы: участок или группа, отдельно флаги на метрики и чаты |
| `sync_state` | вотермарка (`last_archive_id`), время последнего прогона |

**Производные понятия:**

- **Локальная часть JID** — имя до `@`.
- **Оператор** — аккаунт поддержки; имя начинается с префикса `help`
  (`help`, `helpm`, `help-dnk`, …), настраивается `OPERATOR_PREFIX`.
- **Клиент** — не-help сторона диалога.
- **Направление** — `in` (написал клиент) / `out` (ответил оператор).
- **Рабочее время** — Пн–Пт 08:00–18:00; все интервалы time-метрик считаются
  в рабочих секундах (`BusinessTime`).
- **Часовой пояс.** Рабочие часы имеют смысл в поясе участка, а ejabberd
  обычно пишет `created_at` в UTC. Если заданы `SOURCE_TZ` и `BUSINESS_TZ`,
  каждая метка времени переводится из первого во второй при инжесте; иначе
  берётся как есть. Смена поясов требует полной пересборки.
  Отдельно: `archive.created_at` - колонка TIMESTAMP, и MariaDB отдаёт её в
  поясе **сессии**, поэтому соединение с дампом закрепляет пояс параметром
  `DUMP_TZ` (`+05:00`, фиксированное смещение: таблиц часовых поясов на
  сервере нет). Без этого одинаковый дамп на двух машинах даёт разные
  метрики рабочих часов; `DumpTimeZoneTest` проверяет, что пояс доехал.

## 5. Синхронизация и тикеты

Центральный класс — [`AnalyticsSyncService`](../backend/temnet_parser_3.0/src/main/java/com/temnet/temnet_parser/analytics/AnalyticsSyncService.java).
Запускается по расписанию (задержка 30 сек после старта, далее каждые 5 минут)
и вручную через `POST /admin/sync`.

**Инкрементальность.** Дамп обновляется переимпортом продовой базы, `archive.id`
при этом монотонно растёт — синхронизация идёт батчами по вотермарке id. Если
дамп заменили на другой/старый (max id меньше вотермарки) — полный пересбор.

**Полный пересбор идёт в теневых таблицах.** `message_rebuild` и
`ticket_rebuild` создаются `CREATE TABLE … LIKE`, наполняются с нуля и в конце
подменяют рабочие одним атомарным `RENAME TABLE`; только после этого
вотермарка переписывается. Рабочие таблицы всё это время отдают прежние
данные, а падение посреди пересбора их не трогает — тени просто удаляются
при следующей попытке.

**Ручной запуск.** Администратору доступна страница **Обслуживание**
(`/admin/maintenance`): состояние базы, кнопка инкрементальной синхронизации и
кнопка полного пересбора с предупреждением и подтверждением по слову. Пересбор
нужен, когда изменились правила разбора (категории, фразы закрытия, окна,
часовые пояса) — иначе старые заявки останутся посчитанными по старому коду.
Запуски асинхронные: одновременно идёт не больше одного (второй получает
`409`), ход дела отдаётся в `GET /admin/sync/status` полем `run`, страница
опрашивает его раз в 2 секунды. Запуск по расписанию, пока идёт ручной,
просто пропускается.

**Нормализация** (`normalizePairs`): служебные MAM-строки (пустой `txt`) и
диалоги не-с-поддержкой отбрасываются. Две копии одного сообщения — одинаковый
stanza id (из токен-кодированного `xml`), одинаковый текст, записаны в
пределах секунды — схлопываются в одну; автор = владелец первой копии.
Строки без пары в батче нормализуются по старой эвристике `peer`-ресурса.
У полного батча отрезается небольшой хвост, чтобы пара не разрезалась
границей батча. Страховкой от повторной вставки служит UNIQUE-ключ
SHA-1(client, stanza id, txt) и `INSERT IGNORE`; дальше в обработку идут
только реально новые строки.

**Стейт-машина тикетов** (на клиента, сообщения в хронологическом порядке):

- сообщение клиента открывает заявку — кроме благодарности («спасибо», «ок»,
  «+») в течение 4 рабочих часов после закрытия предыдущей; сообщение с
  маркером повтора («не помогло», «опять») или с отрицанием благодарностью не
  считается, как бы коротко оно ни было (`ReopenSignals`);
- фраза оператора «закрыта заявка» / «заявка отклонена» закрывает её
  (статус `closed`/`rejected`), «заявка в работе» ставит отметку
  `in_progress_at` и `pickup_seconds` (рабочие секунды от открытия);
  фраза распознаётся с допуском на опечатки
  (`ClosurePhrase`) — в дампе её пишут как «закрыта заяка», «закрытазаявка»,
  «заявк закрыта»;
- тишина дольше 20 рабочих часов истекает открытую заявку (`expired`);
- заявка, открытая в течение 10 рабочих часов после закрытия предыдущей, —
  кандидат в **повторные**: маркерные слова («опять», «не помогло», …) дают
  +2 балла, совпадение категории +1; при нуле баллов кандидат помечается
  `reopen_llm = 'pending'` и уходит на LLM-классификацию.

**LLM-классификация** ([`LlmReopenClassifier`](../backend/temnet_parser_3.0/src/main/java/com/temnet/temnet_parser/analytics/LlmReopenClassifier.java)):
спорным кандидатам модель отвечает SAME/NEW по текстам старой и новой заявки.
Работает с любым OpenAI-совместимым chat-completions endpoint'ом
(`app.llm.base-url` + `app.llm.api-key` + `app.llm.model`): Gemini free tier,
Groq, OpenRouter, Anthropic, self-hosted — что угодно. **По умолчанию
выключена** (base-url пуст): включение означает передачу текстов обращений
клиентов внешнему сервису, о чём приложение предупреждает в логе при старте.
Запросы идут с темпом `app.llm.requests-per-minute` (по умолчанию 20/мин) и
не больше `app.llm.max-per-sync` (60) за прогон, чтобы LLM-часть укладывалась
в интервал синхронизации; остальное дорешивается в следующих прогонах.
Вердикты кэшируются в `llm_verdict`.

## 6. Backend

### Слои

Весь API живёт под контекстным путём `/api` (`server.servlet.context-path`),
чтобы SPA и бэкенд жили на одном origin: dev-сервер Vite и продакшен-прокси
проксируют `/api` на Spring Boot, и cookie сессии с CSRF-токеном не требуют
кросс-доменных настроек. Запрос проходит строго через три слоя:

```
HTTP → Controller → Service → Repository → (JdbcClient) → temnet_analytics
```

Ошибки превращает в JSON `{"message": …}` единый
[`ApiExceptionHandler`](../backend/temnet_parser_3.0/src/main/java/com/temnet/temnet_parser/controller/ApiExceptionHandler.java):
`IllegalArgumentException` из сервисов — 400, нарушение уникальности — 409,
`AccessDeniedException` — 403, всё неожиданное — 500 с записью в лог и без
подробностей наружу.

- **Controller** (`controller/`) — только HTTP: парсинг параметров
  (`@RequestParam`, даты `@DateTimeFormat(iso = DATE)` → `LocalDate`),
  возврат DTO. Тонкий, без логики.
- **Service** (`service/`) — бизнес-логика и валидация; результаты метрик
  кэшируются (`@Cacheable`, Caffeine, TTL 10 мин — сброс после каждого sync
  с новыми данными).
- **Repository** (`repository/`) — доступ к данным: грузит SQL, биндит
  параметры через `JdbcClient`, маппит результат в record через
  `DataClassRowMapper`.

Эндпоинты по контроллерам:

| Контроллер | Пути |
| --- | --- |
| `GroupController` | `GET /groups` |
| `CompanyController` | `GET /companies` |
| `UserStatsController` | `GET /users` |
| `HelpAccountController` | `GET /help-accounts`, `GET /help-accounts/report` (админ + руководитель) |
| `AuthController` | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/password` (смена своего пароля) |
| `UserAdminController` | `GET/POST/PUT/DELETE /admin/users…` (только администратор) |
| `ChatController` | `GET /chat` (`user?` — переписка одного клиента), `GET /chat/chatlist` (список клиентов) (админ + руководитель) |
| `MetricsController` | `GET /metrics/{timeseries,backlog,heatmap,sla,resolution,reopens,alerts,categories,operators}` (админ + руководитель) |
| `SyncController` (пакет `analytics/`) | `POST /admin/sync`, `POST /admin/sync/rebuild`, `GET /admin/sync/status` (только администратор) |

### Авторизация и права

Вход — по локальной учётке (логин + пароль, bcrypt), сессия живёт в
HttpOnly-cookie (`SameSite=Lax`, `Secure` включается за HTTPS); POST/PUT/DELETE
защищены CSRF-токеном из cookie `XSRF-TOKEN` (заголовок `X-XSRF-TOKEN`). Всё,
кроме `/auth/login`, требует входа — новый эндпоинт закрыт по умолчанию, а не
по недосмотру. При входе id сессии меняется (защита от фиксации), а
неудачные попытки считаются по логину и по адресу
([`LoginAttemptService`](../backend/temnet_parser_3.0/src/main/java/com/temnet/temnet_parser/security/LoginAttemptService.java)):
после лимита вход отвечает `429` до конца окна.

**Учётка перечитывается на каждом запросе.** В сессии лежит лишь снимок
учётки на момент входа;
[`AccountRefreshFilter`](../backend/temnet_parser_3.0/src/main/java/com/temnet/temnet_parser/security/AccountRefreshFilter.java)
перед каждой проверкой прав сверяет его с базой: отключённая или удалённая
учётка тут же получает `401` и теряет сессию, изменённая роль применяется к
этому же запросу. Иначе удалённый администратор сохранял бы полные права до
истечения сессии.

**Временные пароли.** Пароль, сгенерированный при установке или заданный
администратором, помечен `must_change_password`: до его смены бэкенд
отвечает `403` на всё, кроме `/auth/me`, `/auth/password` и `/auth/logout`, а
интерфейс показывает только форму смены пароля. Сменить пароль самому можно
и позже, через `POST /auth/password` с текущим паролем. Последнего активного
администратора нельзя удалить, отключить или понизить; свою учётку удалить
нельзя.

Три роли: `admin` (видит всё, управляет учётками), `manager` (руководитель) и
`user` (пользователь). Руководителю и пользователю выдаются **участки**
(help-аккаунты) и **отдельные группы**; для каждой области доступ к метрикам и
к чатам отмечается раздельно.

Роль решает, какие **разделы** вообще открыты, — независимо от выданных групп.
`user` — только «Статистика компаний» (`GET /companies`) и «Статистика
пользователей» (`GET /users`): раздел «Метрики» вместе с «Операторами»
(`/metrics/**`), чаты (`/chat/**`) и отчёт по участку (`/help-accounts/**`)
закрыты в [`SecurityConfig`](../backend/temnet_parser_3.0/src/main/java/com/temnet/temnet_parser/security/SecurityConfig.java),
а не только спрятаны в интерфейсе. Флаг «чаты» у грантов такой учётки гасится
при сохранении — иначе он пережил бы понижение роли.

**Выгрузка в Excel** доступна только администраторам и руководителям. Проверить
её на сервере нельзя: книга собирается в браузере (`lib/excel.ts`) из уже
показанной на экране таблицы, поэтому кнопки просто не показываются роли
`user`. Реальная граница проходит по данным: чего роль не может запросить, того
она и не выгрузит. Единственная выгрузка со своим эндпоинтом — отчёт по
участку, и он закрыт по роли.

**Участок фильтрует данные по себе, а не по своим организациям.** Выдан
участок — видны только сообщения, где он одна из сторон
(`message.author`/`recipient`), и только заявки, которые он вёл
(`ticket.account`). Это принципиально: одну организацию и даже одного клиента
могут вести два участка, и ни один не должен видеть работу другого — иначе в
лидерборде операторов и в переписке появляются чужие. Выданная **отдельная
группа** — исключение: там имеется в виду вся организация, кем бы она ни
обслуживалась. Таблица `help_account_group` используется только для списков
групп в фильтрах, но не для фильтрации самих данных.

**Какие группы относятся к участку.** Связка берётся из конфигурации общих
ростеров ejabberd, а не выводится из переписки: в `sr_group.opts` лежит список
`displayed_groups` — организации, которые обслуживает участок, а `sr_user`
говорит, в какой help-группе состоит аккаунт (имена расходятся: аккаунт
`help-mag` состоит в группе `help-magistr`). Это то, что настроили
администраторы, поэтому картина точна сразу и передача организации между
участками отыгрывается в течение одного интервала синхронизации. Обе исходные
таблицы маленькие, так что связка перестраивается при каждом прогоне.

Ключевой класс — [`AccessControlService`](../backend/temnet_parser_3.0/src/main/java/com/temnet/temnet_parser/security/AccessControlService.java):
он превращает (пользователь, запрошенная группа, область) в
[`Scope`](../backend/temnet_parser_3.0/src/main/java/com/temnet/temnet_parser/security/Scope.java) —
список групп, которые запросу разрешено трогать. Дальше `Scope` идёт в
репозитории и подставляется в SQL как `cg.grp IN (:scopeGroups)`. Важные
свойства:

- запрос **чужой** группы получает 403, а не молча суженную выборку;
- запрос **своей** группы сужает выданное, но не расширяет: внутри общей
  организации участок по-прежнему видит только свою работу;
- запрос **без** фильтра группы для руководителя означает «все мои группы», а
  не «все группы вообще»;
- пустой набор прав даёт `AND 1 = 0` — пусто, но никогда не «всё»;
- `Scope` — record, поэтому входит в ключ кэша: пользователи с одинаковыми
  правами делят закэшированные ответы;
- аномалии (`/metrics/alerts`) считаются глобально и фильтруются по
  **развёрнутому** списку видимых групп, так что руководитель с доступом
  только к участку видит аномалии его организаций.

SQL-фрагменты фильтров живут в
[`ScopeSql`](../backend/temnet_parser_3.0/src/main/java/com/temnet/temnet_parser/repository/ScopeSql.java)
и закреплены юнит-тестами (`ScopeSqlTest`): пустой scope, участок, группа,
их сочетание и сужение до запрошенной группы.

Первый администратор создаётся при старте на пустой базе
(`APP_ADMIN_PASSWORD`, иначе пароль генерируется, пишется в лог один раз и
считается временным — при первом входе его требуется сменить).

### DTO (`dto/`)

Все — records: `Group`, `Company`, `UserStat`, `ChatMessage`, `MetricPoint`,
`HeatmapCell`, `SlaPoint`, `ResolutionPoint`, `ReopenPoint`, `Alert`,
`AlertsReport`, `OperatorStat`, `CategoryCount`, и enum `Bucket`
(day/week/month). Маппинг колонок `snake_case` → полей `camelCase` делает
`DataClassRowMapper` автоматически (`user_name` → `userName`).

### Работа с SQL

- Запросы метрик лежат в `resources/sql/*.sql` и грузятся один раз в
  статическое поле репозитория через [`SqlLoader`](../backend/temnet_parser_3.0/src/main/java/com/temnet/temnet_parser/support/SqlLoader.java).
- **Параметры** биндятся по имени: `:start`, `:endExclusive`, `:groupName`,
  `:maxFrtSeconds` и т.п. — защита от инъекций.
- **Динамические фрагменты** SQL (выражение гранулярности, опциональный
  фильтр группы) собираются в коде и подставляются по плейсхолдерам
  `${...}`. **Эти фрагменты строятся только из значений, контролируемых
  кодом** (enum `Bucket`), а пользовательские значения всегда идут через
  bound-параметры — инъекций нет.

Ключевые support-классы:

- [`SqlLoader`](../backend/temnet_parser_3.0/src/main/java/com/temnet/temnet_parser/support/SqlLoader.java) — загрузка SQL из classpath.
- [`CategoryRules`](../backend/temnet_parser_3.0/src/main/java/com/temnet/temnet_parser/support/CategoryRules.java) — словарь категорий обращений (ранг + имя); основы слов матчатся от начала слова.
- [`ClosurePhrase`](../backend/temnet_parser_3.0/src/main/java/com/temnet/temnet_parser/support/ClosurePhrase.java) — распознавание «закрыта заявка» с допуском на опечатки.
- [`ReopenSignals`](../backend/temnet_parser_3.0/src/main/java/com/temnet/temnet_parser/support/ReopenSignals.java) — благодарность после закрытия vs маркер повторного обращения.
- [`BusinessTime`](../backend/temnet_parser_3.0/src/main/java/com/temnet/temnet_parser/support/BusinessTime.java) — рабочие секунды между двумя моментами.
- [`Bucket`](../backend/temnet_parser_3.0/src/main/java/com/temnet/temnet_parser/dto/Bucket.java) — гранулярность времени; хранит SQL-шаблон усечения даты.

### Конфигурация

[`application.properties`](../backend/temnet_parser_3.0/src/main/resources/application.properties) — всё читается из env с дефолтами:

```properties
server.servlet.context-path=${API_CONTEXT_PATH:/api}
server.servlet.session.cookie.same-site=${SESSION_COOKIE_SAMESITE:lax}
server.servlet.session.cookie.secure=${SESSION_COOKIE_SECURE:false}
app.auth.max-failures-per-user=${AUTH_MAX_FAILURES_PER_USER:10}
spring.datasource.url=${DB_URL:jdbc:mariadb://localhost:3306/ejabberd}
spring.datasource.hikari.maximum-pool-size=${DB_POOL_SIZE:4}
app.analytics.url=${ANALYTICS_DB_URL:jdbc:mariadb://localhost:3306/temnet_analytics?createDatabaseIfNotExist=true}
app.analytics.pool-size=${ANALYTICS_DB_POOL_SIZE:16}
app.sync.interval=${SYNC_INTERVAL:PT5M}
app.operator-prefix=${OPERATOR_PREFIX:help}
app.time.source-zone=${SOURCE_TZ:}
app.time.business-zone=${BUSINESS_TZ:}
app.llm.base-url=${LLM_BASE_URL:}
app.llm.api-key=${LLM_API_KEY:}
app.llm.model=${LLM_MODEL:meta-llama/llama-4-scout-17b-16e-instruct}
app.llm.max-per-sync=${LLM_MAX_PER_SYNC:60}
app.llm.requests-per-minute=${LLM_RPM:20}
app.cors.allowed-origin=${CORS_ORIGIN:}
spring.cache.caffeine.spec=expireAfterWrite=${METRICS_CACHE_TTL:10m},maximumSize=500
```

- Пулы соединений — **HikariCP**, два DataSource: дамп читает только
  синхронизация (пул 4), аналитическая БД обслуживает все запросы (пул 16,
  одна загрузка дашборда — восемь параллельных запросов).
- **CORS** — единый [`WebConfig`](../backend/temnet_parser_3.0/src/main/java/com/temnet/temnet_parser/config/WebConfig.java);
  по умолчанию выключен (same-origin), `CORS_ORIGIN` нужен только если SPA
  живёт на другом хосте и не проксируется.
- **Кэш метрик** — Caffeine, ответы кэшируются по комбинации параметров;
  после sync с новыми данными кэши чистятся. Права **не** кэшируются:
  несколько запросов к крошечным таблицам дешевле, чем кэш, который нужно
  держать согласованным.
- [`StartupChecks`](../backend/temnet_parser_3.0/src/main/java/com/temnet/temnet_parser/config/StartupChecks.java)
  предупреждает в логе о паролях БД по умолчанию, cookie без `Secure` и
  включённой передаче данных в LLM.

## 7. Frontend

### Точка входа и роутинг

- [`main.tsx`](../frontend-react/src/main.tsx) — поднимает `QueryClientProvider`
  (TanStack Query), `ConfigProvider` (Ant Design, локаль ru), `BrowserRouter`.
- [`App.tsx`](../frontend-react/src/App.tsx) — маршруты внутри общего
  `AppLayout`, переключатель светлой/тёмной темы. Страница метрик грузится
  **лениво** (`React.lazy`), чтобы тяжёлый бандл ECharts подтягивался только
  на `/metrics`.

| Маршрут | Страница |
| --- | --- |
| `/chat` | `ChatPage` — история переписки |
| `/metrics` | `MetricsPage` — динамика, SLA, время решения, reopens, аномалии, хитмап, категории (ECharts) + сводный Excel-отчёт |
| `/companies` | `CompaniesPage` — статистика компаний |
| `/users` | `UsersPage` — статистика пользователей |
| `/operators` | `OperatorsPage` — лидерборд операторов |
| `/admin/users` | `AdminUsersPage` — учётки и доступы (только администратор) |
| `/admin/maintenance` | `MaintenancePage` — состояние базы аналитики, синхронизация и пересбор (только администратор) |

### Слой API (`api/`)

- [`client.ts`](../frontend-react/src/api/client.ts) — тонкая обёртка над
  `fetch`; база — `import.meta.env.VITE_API_BASE` (`.env`, по умолчанию
  относительный `/api`: dev-сервер и продакшен-прокси ведут его на бэкенд).
  Один метод на эндпоинт. Ответы с ошибкой превращаются в `ApiError` с
  текстом от сервера; `401` на любом вызове, кроме входа и стартовой проверки,
  означает истёкшую сессию — клиент шлёт событие, по которому `AuthProvider`
  сбрасывает пользователя и кэш запросов и показывает экран входа с
  пояснением.
- [`queries.ts`](../frontend-react/src/api/queries.ts) — хуки TanStack Query
  (`useGroups`, `useCompanies`, `useTimeseries`, `useSla`, …) с ключами
  кэша по параметрам.
- [`types.ts`](../frontend-react/src/api/types.ts) — TS-типы, зеркалящие
  DTO бэкенда.

### Компоненты и утилиты

- [`AppLayout`](../frontend-react/src/components/AppLayout.tsx) — сайдбар-меню
  (сгруппированное по разделам) + шапка с кнопкой смены пароля + контент
  (`<Outlet/>`).
- [`EChart`](../frontend-react/src/components/EChart.tsx) — тонкая обёртка над
  `echarts/core` (init / setOption / ResizeObserver / dispose) с регистрацией
  только нужных графиков и компонентов, чтобы ленивый чанк метрик не тянул всю
  библиотеку; используется напрямую, без `echarts-for-react`. Тема графика
  берётся из зарегистрированных `temnet-light` / `temnet-dark`.
- [`StatCard`](../frontend-react/src/components/StatCard.tsx) — KPI-плитка:
  подпись, число, подсказка и спарклайн (инлайновый SVG, без второго
  экземпляра ECharts).
- [`QueryError`](../frontend-react/src/components/QueryError.tsx) — баннер
  ошибки запроса; каждая страница показывает его вместо пустой таблицы.
- [`ChangePasswordForm`](../frontend-react/src/components/ChangePasswordForm.tsx) —
  форма смены пароля; используется и в модальном окне из шапки, и на экране
  принудительной смены временного пароля.
- `lib/` — [`date.ts`](../frontend-react/src/lib/date.ts) (формат `yyyy-MM-dd`,
  дефолтный диапазон), [`format.ts`](../frontend-react/src/lib/format.ts)
  (`humanizeSeconds`), [`excel.ts`](../frontend-react/src/lib/excel.ts)
  (экспорт в `.xlsx`, ExcelJS грузится лениво).

### Тема и цвета

Единственный источник цвета — [`lib/palette.ts`](../frontend-react/src/lib/palette.ts):
акценты серий (`accent`) и шкала поверхностей/текста/границ (`tokens`) для
каждого режима. Его читают три потребителя, и ни один из них не хранит хексы
у себя:

- [`theme.tsx`](../frontend-react/src/theme.tsx) публикует `tokens` в `<html>`
  как CSS-переменные (`--surface`, `--border`, `--text-muted` …) — до первой
  отрисовки, чтобы не было вспышки нестилизованного контента; их использует
  [`styles.css`](../frontend-react/src/styles.css);
- [`lib/antdTheme.ts`](../frontend-react/src/lib/antdTheme.ts) раскладывает те же
  значения в токены Ant Design (`ConfigProvider`), включая токены Layout, Menu,
  Card, Table;
- [`lib/chartTheme.ts`](../frontend-react/src/lib/chartTheme.ts) собирает из них
  две темы ECharts (оси, сетка, легенда, тултип, dataZoom, visualMap) плюс
  хелперы градиентов (`areaFade`, `barFade`, `barFadeX`).

Сайдбар и меню всегда работают в «светлой» теме Ant Design: их вид полностью
задан явными токенами, поэтому параллельное семейство `dark*`-токенов не нужно.

### Поток данных

```
Page → use*-хук (TanStack Query) → api.client → fetch → backend
     → данные кэшируются по ключу → useMemo строит EChartsOption / колонки таблицы
```

## 8. Сборка и запуск

**Требования:** любой JDK 17+ для запуска Gradle (JDK 25 для проекта
скачивается автоматически через foojay-resolver), Node 18+ (для фронта),
MariaDB с базой `ejabberd`. Тестовая схема и данные — в
[`backend/.../db/`](../backend/temnet_parser_3.0/db/README.md).

```bat
run_backend.bat     :: gradlew bootRun → http://localhost:8080/api
run_frontend.bat    :: npm install (при первом запуске) + npm run dev → http://localhost:5173
```

Сборки по отдельности:

```bash
# backend
cd backend/temnet_parser_3.0 && ./gradlew bootRun
cd backend/temnet_parser_3.0 && ./gradlew test --tests 'com.temnet.temnet_parser.support.*' --tests 'com.temnet.temnet_parser.repository.*'   # юнит-тесты без БД
# frontend
cd frontend-react && npm install && npm run build   # tsc + vite build → dist/
```

**Продакшен.** Статику из `frontend-react/dist` и `/api/*` раздаёт один
reverse proxy (nginx, Caddy): SPA и API на одном origin, TLS на прокси,
`SESSION_COOKIE_SECURE=true`, `FORWARD_HEADERS_STRATEGY=native`, пароли БД и
`APP_ADMIN_PASSWORD` из окружения.

## 9. Соглашения

- **Слои не перепрыгиваются**: контроллер не ходит в репозиторий напрямую.
- **SQL — в ресурсах**, не в коде; параметры — именованные; динамические
  фрагменты — только из code-controlled значений.
- **Даты** на границе API — `LocalDate` (ISO `yyyy-MM-dd`); внутри запросов
  везде полуинтервал `[start, end+1день)` — конечный день включён целиком.
- **Идентификатор оператора** — префикс имени (`help` по умолчанию).
- **Время в time-метриках** — рабочие секунды (Пн–Пт 08:00–18:00).
