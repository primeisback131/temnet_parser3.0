# Temnet Parser

Аналитика хелпдеск-переписки ejabberd (XMPP): статистика по компаниям и
пользователям, история чатов, заявки (тикеты) и аналитические метрики —
динамика, нагрузка, время первого ответа, время решения, повторные обращения,
аномалии.

## Документация

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — устройство кодовой базы:
  стек, структура, аналитическая БД и синхронизация, слои бэкенда, фронтенд,
  сборка и запуск.
- [docs/METRICS.md](docs/METRICS.md) — все эндпоинты и **методология расчёта**:
  что и как считается в каждой метрике (формулы, SQL-логика, нюансы).

## Стек

- **Backend** — Java 25 + Spring Boot 4, чистый JDBC (`JdbcClient`/`JdbcTemplate`)
  поверх MariaDB, слои controller → service → repository. Собственная
  аналитическая БД (`temnet_analytics`), которую наполняет фоновая
  синхронизация из дампа ejabberd.
- **Frontend** — React 19 + Vite + Ant Design 5 + TanStack Query, графики на
  Apache ECharts, экспорт отчётов в Excel (ExcelJS).
- **LLM (опционально)** — классификация спорных повторных обращений через
  любой OpenAI-совместимый chat-completions API (бесплатные варианты —
  Gemini free tier, Groq); пока base-url не задан, этот шаг просто выключен.

## Структура

```
backend/temnet_parser_2.0   Spring Boot приложение (порт 8080)
  ├─ src/main/java/...       контроллеры, сервисы, репозитории, DTO (records),
  │                          пакет analytics/ — синхронизация и тикеты
  ├─ src/main/resources/sql  SQL-запросы метрик (вынесены из кода)
  ├─ src/main/resources/analytics  схема аналитической БД
  └─ db/                     тестовая схема + сид-данные для локальной проверки
frontend-react              React-приложение (Vite dev на порту 5173)
run_backend.bat             запуск backend (использует JDK 25 + Gradle wrapper)
run_frontend.bat            запуск frontend (npm install + npm run dev)
```

## Запуск

**Backend** (нужна MariaDB с базой `ejabberd`, по умолчанию `root:root`@`localhost:3306`;
аналитическая база `temnet_analytics` создаётся автоматически):

```bat
run_backend.bat
```

Настройки через переменные окружения (все опциональны):

| Переменная | Что задаёт | По умолчанию |
| ---------- | ---------- | ------------ |
| `DB_URL`, `DB_USER`, `DB_PASSWORD` | подключение к дампу ejabberd | `localhost:3306/ejabberd`, `root:root` |
| `ANALYTICS_DB_URL`, `ANALYTICS_DB_USER`, `ANALYTICS_DB_PASSWORD` | аналитическая БД | `localhost:3306/temnet_analytics`, `root:root` |
| `SYNC_INTERVAL`, `SYNC_INITIAL_DELAY` | периодичность синхронизации | 5 мин / 30 сек |
| `LLM_BASE_URL` | OpenAI-совместимый endpoint для LLM-классификации reopen'ов (например `https://generativelanguage.googleapis.com/v1beta/openai`) | пусто (выключено) |
| `LLM_API_KEY` | ключ провайдера (Gemini — с aistudio.google.com, без карты) | пусто |
| `LLM_MODEL`, `LLM_MAX_PER_SYNC`, `LLM_RPM` | модель, лимит вызовов за один sync, темп запросов | `gemini-flash-latest`, 20, 5/мин |
| `CORS_ORIGIN` | адрес фронтенда | `http://localhost:5173` |

**Frontend:**

```bat
run_frontend.bat
```
Адрес API задаётся в `frontend-react/.env` (`VITE_API_BASE`).

## API

| Метод | Путь | Назначение |
| ----- | ---- | ---------- |
| GET | `/groups` | список групп |
| GET | `/companies?start&end` | статистика по группам |
| GET | `/users?start&end&groupName` | статистика по пользователям |
| GET | `/chat?start&end&groupName` | история переписки клиентов группы |
| GET | `/chat/chatlist?start&end&groupName` | участники переписки |
| GET | `/metrics/timeseries?start&end&bucket&groupName?` | динамика сообщений/заявок |
| GET | `/metrics/heatmap?start&end&groupName?` | нагрузка по часам × дням недели |
| GET | `/metrics/sla?start&end&bucket&groupName?` | время первого ответа оператора |
| GET | `/metrics/resolution?start&end&bucket&groupName?` | время решения заявок |
| GET | `/metrics/reopens?start&end&bucket&groupName?` | повторные обращения |
| GET | `/metrics/alerts` | аномалии за последнюю неделю |
| GET | `/metrics/categories?start&end&groupName?` | категории заявок |
| GET | `/metrics/operators?start&end&groupName?` | лидерборд операторов |
| POST | `/admin/sync` | инкрементальная синхронизация вручную |
| POST | `/admin/sync/rebuild` | полный пересбор аналитической БД |
| GET | `/admin/sync/status` | состояние синхронизации и счётчики |
