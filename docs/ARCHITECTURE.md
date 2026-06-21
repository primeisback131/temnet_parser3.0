# Архитектура кодовой базы

Документация по устройству приложения **Temnet Parser** — аналитики
хелпдеск-переписки ejabberd (XMPP).

- [1. Обзор](#1-обзор)
- [2. Стек](#2-стек)
- [3. Структура репозитория](#3-структура-репозитория)
- [4. Модель данных (ejabberd)](#4-модель-данных-ejabberd)
- [5. Backend](#5-backend)
- [6. Frontend](#6-frontend)
- [7. Сборка и запуск](#7-сборка-и-запуск)
- [8. Соглашения](#8-соглашения)

> Методология расчёта метрик вынесена в отдельный документ — см.
> [METRICS.md](METRICS.md).

---

## 1. Обзор

Приложение читает базу **ejabberd** (MariaDB) — архив сообщений между
сотрудниками компаний-клиентов и поддержкой (аккаунты `help*`) — и отдаёт по
ней отчёты и аналитику:

- табличные отчёты по компаниям и пользователям;
- история переписки;
- аналитические метрики: динамика обращений, нагрузка по часам, время первого
  ответа (SLA), лидерборд операторов, категоризация обращений.

Никаких записей в БД приложение не делает — только `SELECT` (read-only).

## 2. Стек

| Слой | Технологии |
| --- | --- |
| Backend | Java 25, Spring Boot 4, Spring Web MVC, Spring JDBC (`JdbcClient`), MariaDB JDBC, Gradle (toolchain JDK 25) |
| Frontend | React 19, Vite 5, TypeScript, Ant Design 5, TanStack Query, Apache ECharts, React Router, dayjs, ExcelJS |
| БД | MariaDB (схема ejabberd) |

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
│     │  ├─ Application.java           точка входа
│     │  ├─ config/WebConfig.java      CORS
│     │  ├─ controller/                HTTP-слой (5 контроллеров)
│     │  ├─ service/                   бизнес-логика (5 сервисов)
│     │  ├─ repository/                доступ к данным через JdbcClient
│     │  ├─ dto/                       records (DTO + enum Bucket)
│     │  └─ support/                   SqlLoader, CategoryRules
│     ├─ main/resources/
│     │  ├─ application.properties     конфиг БД/CORS (через env)
│     │  └─ sql/                       все SQL-запросы (*.sql)
│     └─ test/java/...                 ApplicationTests (context load)
├─ frontend-react/                     React-приложение (Vite dev на 5173)
│  └─ src/
│     ├─ main.tsx, App.tsx             bootstrap + роутинг
│     ├─ api/                          client, query-хуки, типы
│     ├─ components/                   AppLayout, EChart
│     ├─ lib/                          date, excel, format
│     └─ pages/                        экраны
├─ run_backend.bat / run_frontend.bat  запуск
└─ docs/                               эта документация
```

## 4. Модель данных (ejabberd)

Используются три таблицы:

| Таблица | Колонки (используемые) | Смысл |
| --- | --- | --- |
| `archive` | `username`, `peer`, `txt`, `created_at` | сообщение: кто (`username`), кому (`peer`, JID), текст, время |
| `sr_group` | `name` | группа/компания |
| `sr_user` | `jid`, `grp` | принадлежность JID к группе |

**Производные понятия** (используются во всех аналитических запросах):

- **Локальная часть JID** — `SUBSTRING_INDEX(jid, '@', 1)` (имя до `@`).
- **Оператор** — аккаунт поддержки; `username` начинается с `help`
  (`help`, `helpm`, `help-dnk`, …). Во всех запросах используется префикс
  `LIKE 'help%'`.
- **Клиент (`user_key`)** — не-help сторона диалога.
- **Направление (`direction`)** — `in` (написал клиент) / `out` (ответил оператор).
- **Обращение/сессия** — группа сообщений клиента в одном диалоге, разделённых
  паузой не более 15 минут (см. категоризацию в METRICS.md).

## 5. Backend

### Слои

Запрос проходит строго через три слоя:

```
HTTP → Controller → Service → Repository → (JdbcClient) → MariaDB
```

- **Controller** (`controller/`) — только HTTP: парсинг параметров
  (`@RequestParam`, даты `@DateTimeFormat(iso = DATE)` → `LocalDate`),
  возврат DTO. Тонкий, без логики.
- **Service** (`service/`) — бизнес-логика и валидация (например
  `ChatService.participants` — distinct отправителей без `help`;
  `MetricsService` проверяет диапазон дат).
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
| `MetricsController` | `GET /metrics/{timeseries,heatmap,sla,operators,categories}` |

### DTO (`dto/`)

Все — records: `Group`, `Company`, `UserStat`, `ChatMessage`, `MetricPoint`,
`HeatmapCell`, `SlaPoint`, `OperatorStat`, `CategoryCount`, и enum `Bucket`
(day/week/month). Маппинг колонок `snake_case` → полей `camelCase` делает
`DataClassRowMapper` автоматически (`user_name` → `userName`).

### Работа с SQL

- Все запросы лежат в `resources/sql/*.sql` и грузятся один раз в статическое
  поле репозитория через [`SqlLoader`](../backend/temnet_parser_2.0/src/main/java/com/temnet/temnet_parser/support/SqlLoader.java)
  (`ClassPathResource.getContentAsString`).
- **Параметры** биндятся по имени: `:start`, `:end`, `:groupName`,
  `:username`, `:sessionGapSeconds`, `:maxFrtSeconds` и т.п. — защита от
  инъекций.
- **Динамические фрагменты** SQL (которые нельзя передать параметром —
  выражение гранулярности, опциональный фильтр группы, CASE категоризации)
  собираются в коде и подставляются по плейсхолдерам `${...}`
  (`${bucket}`, `${groupFilter}`, `${rankCase}`, `${rankToName}`,
  `${categoryCase}`). **Эти фрагменты строятся только из значений,
  контролируемых кодом** (enum `Bucket`, словарь `CategoryRules`), а
  пользовательские значения всегда идут через bound-параметры — инъекций нет.

Ключевые support-классы:

- [`SqlLoader`](../backend/temnet_parser_2.0/src/main/java/com/temnet/temnet_parser/support/SqlLoader.java) — загрузка SQL из classpath.
- [`CategoryRules`](../backend/temnet_parser_2.0/src/main/java/com/temnet/temnet_parser/support/CategoryRules.java) — словарь категорий обращений и генерация
  `CASE`-выражений (ранг + ранг→имя).
- [`Bucket`](../backend/temnet_parser_2.0/src/main/java/com/temnet/temnet_parser/dto/Bucket.java) — гранулярность времени; хранит SQL-шаблон усечения даты.

### Конфигурация

[`application.properties`](../backend/temnet_parser_2.0/src/main/resources/application.properties) — подключение и пул читаются из env с дефолтами:

```properties
spring.datasource.url=${DB_URL:jdbc:mariadb://localhost:3306/ejabberd}
spring.datasource.username=${DB_USER:root}
spring.datasource.password=${DB_PASSWORD:root}
spring.datasource.hikari.maximum-pool-size=${DB_POOL_SIZE:10}
app.cors.allowed-origin=${CORS_ORIGIN:http://localhost:5173}
```

- Пул соединений — **HikariCP** (дефолт Spring Boot).
- **CORS** — единый [`WebConfig`](../backend/temnet_parser_2.0/src/main/java/com/temnet/temnet_parser/config/WebConfig.java) (`allowedOrigins` из `app.cors.allowed-origin`,
  только `GET`).

## 6. Frontend

### Точка входа и роутинг

- [`main.tsx`](../frontend-react/src/main.tsx) — поднимает `QueryClientProvider`
  (TanStack Query), `ConfigProvider` (Ant Design, локаль ru), `BrowserRouter`.
- [`App.tsx`](../frontend-react/src/App.tsx) — маршруты внутри общего
  `AppLayout`. Страница метрик грузится **лениво** (`React.lazy`), чтобы
  тяжёлый бандл ECharts подтягивался только на `/metrics`.

| Маршрут | Страница |
| --- | --- |
| `/chat` | `ChatPage` — история переписки |
| `/metrics` | `MetricsPage` — динамика, SLA, хитмап, категории (ECharts) |
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

## 7. Сборка и запуск

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

## 8. Соглашения

- **Слои не перепрыгиваются**: контроллер не ходит в репозиторий напрямую.
- **SQL — в ресурсах**, не в коде; параметры — именованные; динамические
  фрагменты — только из code-controlled значений.
- **Даты** на границе API — `LocalDate` (ISO `yyyy-MM-dd`); внутри запросов
  конец периода трактуется по-разному в базовых отчётах и в метриках — см.
  [METRICS.md](METRICS.md).
- **Идентификатор оператора** — везде префикс `username LIKE 'help%'`.
