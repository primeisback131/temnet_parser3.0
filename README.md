# Temnet Parser

Аналитика хелпдеск-переписки ejabberd (XMPP): статистика по компаниям и
пользователям, история чатов и аналитические метрики (динамика, нагрузка,
время первого ответа).

## Документация

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — устройство кодовой базы:
  стек, структура, слои бэкенда, фронтенд, сборка и запуск.
- [docs/METRICS.md](docs/METRICS.md) — все эндпоинты и **методология расчёта**:
  что и как считается в каждой метрике (формулы, SQL-логика, нюансы).

## Стек

- **Backend** — Java 25 + Spring Boot 4, чистый JDBC (`JdbcClient`) поверх
  MariaDB, слои controller → service → repository.
- **Frontend** — React 19 + Vite + Ant Design 5 + TanStack Query, графики на
  Apache ECharts.

## Структура

```
backend/temnet_parser_2.0   Spring Boot приложение (порт 8080)
  ├─ src/main/java/...       контроллеры, сервисы, репозитории, DTO (records)
  ├─ src/main/resources/sql  SQL-запросы (вынесены из кода)
  └─ db/                     тестовая схема + сид-данные для локальной проверки
frontend-react              React-приложение (Vite dev на порту 5173)
run_backend.bat             запуск backend (использует JDK 25 + Gradle wrapper)
run_frontend.bat            запуск frontend (npm install + npm run dev)
```

## Запуск

**Backend** (нужна MariaDB с базой `ejabberd`, по умолчанию `root:root`@`localhost:3306`):

```bat
run_backend.bat
```
Переопределить подключение можно через переменные окружения
`DB_URL`, `DB_USER`, `DB_PASSWORD`, `CORS_ORIGIN`.

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
| GET | `/chat?start&end&username` | история переписки |
| GET | `/metrics/timeseries?start&end&bucket&groupName?` | динамика сообщений/заявок |
| GET | `/metrics/heatmap?start&end&groupName?` | нагрузка по часам × дням недели |
| GET | `/metrics/sla?start&end&bucket&groupName?` | время первого ответа оператора |
