# Локальная БД для проверки backend

Тестовая схема ejabberd (`archive`, `sr_group`, `sr_user`) + сид-данные,
которыми проверяется корректность отчётных запросов.

> **Важно:** метрики времени (SLA, задержка операторов, границы заявок)
> используют SQL-функцию **`business_seconds`** (рабочее время Пн–Пт 08:00–18:00)
> из [`functions.sql`](functions.sql). Её нужно **загрузить в БД один раз**,
> иначе `/metrics/sla`, `/metrics/operators`, `/metrics/categories` упадут с
> ошибкой «FUNCTION does not exist». Команды загрузки — ниже.

Дефолты приложения (`application.properties`): БД `ejabberd`, пользователь
`root`, пароль `root`, `localhost:3306`. Если поставишь так — env-переменные
не нужны.

## Вариант A — Docker

```bash
docker run --name temnet-maria \
  -e MARIADB_ROOT_PASSWORD=root \
  -e MARIADB_DATABASE=ejabberd \
  -p 3306:3306 -d mariadb:11

# залить схему, данные и функцию рабочего времени
docker exec -i temnet-maria mariadb -uroot -proot < schema.sql
docker exec -i temnet-maria mariadb -uroot -proot ejabberd < seed.sql
docker exec -i temnet-maria mariadb -uroot -proot ejabberd < functions.sql
```

## Вариант B — MSI (установщик MariaDB для Windows)

1. Поставь MariaDB, задай пароль root = `root`, порт `3306`.
2. Залей фикстуры (из папки `db/`):

```bat
"C:\Program Files\MariaDB 11.x\bin\mariadb.exe" -uroot -proot < schema.sql
"C:\Program Files\MariaDB 11.x\bin\mariadb.exe" -uroot -proot ejabberd < seed.sql
"C:\Program Files\MariaDB 11.x\bin\mariadb.exe" -uroot -proot ejabberd < functions.sql
```

На реальной (боевой) БД достаточно загрузить только `functions.sql` — схема и
данные там уже есть.

## Запуск backend

Из корня проекта:

```bat
run_backend.bat
```

(скрипт уже выставляет `JAVA_HOME` на стоящий JDK 25 и стартует через Gradle wrapper)

## Ожидаемые результаты на сид-данных (диапазон 2025-01-01 … сегодня)

- `GET /groups` → `CompanyA`, `CompanyB` (а `help-desk` и `all` исключены).
- `GET /companies?start=2025-01-01&end=2025-12-31` →
  - CompanyA: activeUsers=2, totalUsers=2, closedRequests=2, rejectedRequests=1, requestsInProgress=1, totalMessages=6
  - CompanyB: activeUsers=1, totalUsers=1, closedRequests=1, rejectedRequests=0, requestsInProgress=0, totalMessages=2
- `GET /users?start=2025-01-01&end=2025-12-31&groupName=CompanyA` →
  - alice: closed=1, rejected=1, inProgress=1, total=4
  - bob: closed=1, rejected=0, inProgress=0, total=2
- `GET /chat?start=2025-01-01&end=2025-12-31&username=petrov` → переписка petrov ↔ help
  (3 сообщения, поле даты — `createdAt`).
