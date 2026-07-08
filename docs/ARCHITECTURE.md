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
temnet_parser_2.0/
├─ backend/temnet_parser_2.0/          Spring Boot приложение (порт 8080)
│  ├─ build.gradle                     Java 25 toolchain, Spring Boot 4
│  ├─ gradle/wrapper/                  Gradle wrapper (9.1.0)
│  ├─ db/                              схема + сид-данные для локальной проверки
│  └─ src/
│     ├─ main/java/com/temnet/temnet_parser/
│     │  ├─ Application.java           точка входа (@EnableScheduling)
│     │  ├─ config/                    CORS, второй DataSource для аналитики
│     │  ├─ analytics/                 синхронизация, тикеты, LLM, /admin/sync
│     │  ├─ controller/                HTTP-слой
│     │  ├─ service/                   бизнес-логика
│     │  ├─ repository/                доступ к данным через JdbcClient
│     │  ├─ dto/                       records (DTO + enum Bucket)
│     │  └─ support/                   SqlLoader, CategoryRules, BusinessTime
│     ├─ main/resources/
│     │  ├─ application.properties     конфиг БД/CORS/sync/LLM (через env)
│     │  ├─ analytics/schema.sql       схема аналитической БД
│     │  └─ sql/                       SQL-запросы метрик (*.sql)
│     └─ test/java/...                 ApplicationTests (context load)
├─ frontend-react/                     React-приложение (Vite dev на 5173)
│  └─ src/
│     ├─ main.tsx, App.tsx             bootstrap + роутинг + тема
│     ├─ api/                          client, query-хуки, типы
│     ├─ components/                   AppLayout, EChart
│     ├─ lib/                          date, excel, format
│     └─ pages/                        экраны
├─ run_backend.bat / run_frontend.bat  запуск
└─ docs/                               эта документация
```

## 4. Модель данных

### Источник (дамп ejabberd)

| Таблица | Колонки (используемые) | Смысл |
| --- | --- | --- |
| `archive` | `id`, `username`, `peer`, `bare_peer`, `txt`, `created_at`, `xml` | сообщение: владелец архива, вторая сторона, текст, время, исходная станза |
| `sr_user` | `jid`, `grp` | принадлежность JID к группе |

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

Схема — [`analytics/schema.sql`](../backend/temnet_parser_2.0/src/main/resources/analytics/schema.sql),
создаётся при старте, стейтменты идемпотентны.

| Таблица | Смысл |
| --- | --- |
| `message` | одна строка на реальное сообщение диалога клиент ↔ поддержка: копии склеены (`dedup_hash`, UNIQUE), автор восстановлен, служебные строки отброшены |
| `ticket` | заявка, собранная стейт-машиной инжеста: `open` → `closed`/`rejected` (фраза оператора) или `expired` (клиент замолчал); FRT и время решения — в рабочих секундах, посчитаны при инжесте |
| `llm_verdict` | вердикты LLM по спорным reopen-кандидатам; ключ — (client, opened_at), поэтому полный пересбор не переплачивает за уже решённые случаи |
| `client_group` | членство клиентов в группах, копия `sr_user` |
| `sync_state` | вотермарка (`last_archive_id`), время последнего прогона |

**Производные понятия:**

- **Локальная часть JID** — имя до `@`.
- **Оператор** — аккаунт поддержки; имя начинается с префикса `help`
  (`help`, `helpm`, `help-dnk`, …), настраивается `OPERATOR_PREFIX`.
- **Клиент** — не-help сторона диалога.
- **Направление** — `in` (написал клиент) / `out` (ответил оператор).
- **Рабочее время** — Пн–Пт 08:00–18:00; все интервалы time-метрик считаются
  в рабочих секундах (`BusinessTime`).

## 5. Синхронизация и тикеты

Центральный класс — [`AnalyticsSyncService`](../backend/temnet_parser_2.0/src/main/java/com/temnet/temnet_parser/analytics/AnalyticsSyncService.java).
Запускается по расписанию (задержка 30 сек после старта, далее каждые 5 минут)
и вручную через `POST /admin/sync`.

**Инкрементальность.** Дамп обновляется переимпортом продовой базы, `archive.id`
при этом монотонно растёт — синхронизация идёт батчами по вотермарке id. Если
дамп заменили на другой/старый (max id меньше вотермарки) — полный пересбор.
Пересбор можно вызвать и руками: `POST /admin/sync/rebuild`.

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

- сообщение клиента открывает заявку — кроме короткого «спасибо» в течение
  4 рабочих часов после закрытия предыдущей;
- фраза оператора «закрыта заявка» / «заявка отклонена» закрывает её
  (статус `closed`/`rejected`), «заявка в работе» ставит отметку
  `in_progress_at`;
- тишина дольше 20 рабочих часов истекает открытую заявку (`expired`);
- заявка, открытая в течение 10 рабочих часов после закрытия предыдущей, —
  кандидат в **повторные**: маркерные слова («опять», «не помогло», …) дают
  +2 балла, совпадение категории +1; при нуле баллов кандидат помечается
  `reopen_llm = 'pending'` и уходит на LLM-классификацию.

**LLM-классификация** ([`LlmReopenClassifier`](../backend/temnet_parser_2.0/src/main/java/com/temnet/temnet_parser/analytics/LlmReopenClassifier.java)):
спорным кандидатам модель отвечает SAME/NEW по текстам старой и новой заявки.
Работает с любым OpenAI-совместимым chat-completions endpoint'ом
(`app.llm.base-url` + `app.llm.api-key` + `app.llm.model`): Gemini free tier,
Groq, OpenRouter, Anthropic, self-hosted — что угодно. Пока base-url пуст,
шаг выключен. Запросы идут с темпом `app.llm.requests-per-minute`
(по умолчанию 5/мин — укладывается в любой бесплатный тариф) и не больше
`app.llm.max-per-sync` (20) за прогон, чтобы LLM-часть укладывалась в
5-минутный интервал синхронизации; остальное дорешивается в следующих
прогонах. Вердикты кэшируются в `llm_verdict`.

## 6. Backend

### Слои

Запрос проходит строго через три слоя:

```
HTTP → Controller → Service → Repository → (JdbcClient) → temnet_analytics
```

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
| `ChatController` | `GET /chat`, `GET /chat/chatlist` |
| `MetricsController` | `GET /metrics/{timeseries,heatmap,sla,resolution,reopens,alerts,categories,operators}` |
| `SyncController` (пакет `analytics/`) | `POST /admin/sync`, `POST /admin/sync/rebuild`, `GET /admin/sync/status` |

### DTO (`dto/`)

Все — records: `Group`, `Company`, `UserStat`, `ChatMessage`, `MetricPoint`,
`HeatmapCell`, `SlaPoint`, `ResolutionPoint`, `ReopenPoint`, `Alert`,
`AlertsReport`, `OperatorStat`, `CategoryCount`, и enum `Bucket`
(day/week/month). Маппинг колонок `snake_case` → полей `camelCase` делает
`DataClassRowMapper` автоматически (`user_name` → `userName`).

### Работа с SQL

- Запросы метрик лежат в `resources/sql/*.sql` и грузятся один раз в
  статическое поле репозитория через [`SqlLoader`](../backend/temnet_parser_2.0/src/main/java/com/temnet/temnet_parser/support/SqlLoader.java).
- **Параметры** биндятся по имени: `:start`, `:endExclusive`, `:groupName`,
  `:maxFrtSeconds` и т.п. — защита от инъекций.
- **Динамические фрагменты** SQL (выражение гранулярности, опциональный
  фильтр группы) собираются в коде и подставляются по плейсхолдерам
  `${...}`. **Эти фрагменты строятся только из значений, контролируемых
  кодом** (enum `Bucket`), а пользовательские значения всегда идут через
  bound-параметры — инъекций нет.

Ключевые support-классы:

- [`SqlLoader`](../backend/temnet_parser_2.0/src/main/java/com/temnet/temnet_parser/support/SqlLoader.java) — загрузка SQL из classpath.
- [`CategoryRules`](../backend/temnet_parser_2.0/src/main/java/com/temnet/temnet_parser/support/CategoryRules.java) — словарь категорий обращений (ранг + имя).
- [`BusinessTime`](../backend/temnet_parser_2.0/src/main/java/com/temnet/temnet_parser/support/BusinessTime.java) — рабочие секунды между двумя моментами.
- [`Bucket`](../backend/temnet_parser_2.0/src/main/java/com/temnet/temnet_parser/dto/Bucket.java) — гранулярность времени; хранит SQL-шаблон усечения даты.

### Конфигурация

[`application.properties`](../backend/temnet_parser_2.0/src/main/resources/application.properties) — всё читается из env с дефолтами:

```properties
spring.datasource.url=${DB_URL:jdbc:mariadb://localhost:3306/ejabberd}
app.analytics.url=${ANALYTICS_DB_URL:jdbc:mariadb://localhost:3306/temnet_analytics?createDatabaseIfNotExist=true}
app.sync.interval=${SYNC_INTERVAL:PT5M}
app.operator-prefix=${OPERATOR_PREFIX:help}
app.llm.base-url=${LLM_BASE_URL:}
app.llm.api-key=${LLM_API_KEY:}
app.llm.model=${LLM_MODEL:gemini-flash-latest}
app.llm.max-per-sync=${LLM_MAX_PER_SYNC:20}
app.llm.requests-per-minute=${LLM_RPM:5}
app.cors.allowed-origin=${CORS_ORIGIN:http://localhost:5173}
spring.cache.caffeine.spec=expireAfterWrite=${METRICS_CACHE_TTL:10m},maximumSize=500
```

- Пул соединений — **HikariCP** (дефолт Spring Boot), для аналитики —
  отдельный DataSource.
- **CORS** — единый [`WebConfig`](../backend/temnet_parser_2.0/src/main/java/com/temnet/temnet_parser/config/WebConfig.java) (`allowedOrigins` из `app.cors.allowed-origin`).
- **Кэш метрик** — Caffeine, ответы кэшируются по комбинации параметров;
  после sync с новыми данными кэши чистятся.

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

### Слой API (`api/`)

- [`client.ts`](../frontend-react/src/api/client.ts) — тонкая обёртка над
  `fetch`; база — `import.meta.env.VITE_API_BASE` (`.env`, по умолчанию
  `http://localhost:8080`). Один метод на эндпоинт.
- [`queries.ts`](../frontend-react/src/api/queries.ts) — хуки TanStack Query
  (`useGroups`, `useCompanies`, `useTimeseries`, `useSla`, …) с ключами
  кэша по параметрам.
- [`types.ts`](../frontend-react/src/api/types.ts) — TS-типы, зеркалящие
  DTO бэкенда.

### Компоненты и утилиты

- [`AppLayout`](../frontend-react/src/components/AppLayout.tsx) — сайдбар-меню + контент (`<Outlet/>`).
- [`EChart`](../frontend-react/src/components/EChart.tsx) — тонкая обёртка над
  `echarts` (init / setOption / resize / dispose); используется напрямую,
  без `echarts-for-react`.
- `lib/` — [`date.ts`](../frontend-react/src/lib/date.ts) (формат `yyyy-MM-dd`,
  дефолтный диапазон), [`format.ts`](../frontend-react/src/lib/format.ts)
  (`humanizeSeconds`), [`excel.ts`](../frontend-react/src/lib/excel.ts)
  (экспорт в `.xlsx`, ExcelJS грузится лениво).

### Поток данных

```
Page → use*-хук (TanStack Query) → api.client → fetch → backend
     → данные кэшируются по ключу → useMemo строит EChartsOption / колонки таблицы
```

## 8. Сборка и запуск

**Требования:** JDK 25 (для бэка), Node 18+ (для фронта), MariaDB с базой
`ejabberd`. Тестовая схема и данные — в
[`backend/.../db/`](../backend/temnet_parser_2.0/db/README.md).

```bat
run_backend.bat     :: JAVA_HOME=JDK25 + gradlew bootRun → http://localhost:8080
run_frontend.bat    :: npm install (при первом запуске) + npm run dev → http://localhost:5173
```

Сборки по отдельности:

```bash
# backend
cd backend/temnet_parser_2.0 && ./gradlew bootRun
# frontend
cd frontend-react && npm install && npm run build   # tsc + vite build → dist/
```

## 9. Соглашения

- **Слои не перепрыгиваются**: контроллер не ходит в репозиторий напрямую.
- **SQL — в ресурсах**, не в коде; параметры — именованные; динамические
  фрагменты — только из code-controlled значений.
- **Даты** на границе API — `LocalDate` (ISO `yyyy-MM-dd`); внутри запросов
  везде полуинтервал `[start, end+1день)` — конечный день включён целиком.
- **Идентификатор оператора** — префикс имени (`help` по умолчанию).
- **Время в time-метриках** — рабочие секунды (Пн–Пт 08:00–18:00).
