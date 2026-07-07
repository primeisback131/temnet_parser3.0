# Локальная БД для проверки backend

Тестовая схема ejabberd (`archive`, `sr_group`, `sr_user`) + сид-данные,
которыми проверяется корректность отчётов.

Дефолты приложения (`application.properties`): БД `ejabberd`, пользователь
`root`, пароль `root`, `localhost:3306`. Если поставишь так — env-переменные
не нужны. Аналитическая база `temnet_analytics` создаётся приложением
автоматически; после старта подожди первую синхронизацию (~30 сек) или дёрни
`POST /admin/sync` — метрики читают уже синхронизированные таблицы.

`functions.sql` (SQL-функция `business_seconds`) приложению больше не нужна —
рабочее время считается в Java при инжесте. Файл оставлен для ad-hoc анализа
дампа руками.

## Вариант A — Docker

```bash
docker run --name temnet-maria \
  -e MARIADB_ROOT_PASSWORD=root \
  -e MARIADB_DATABASE=ejabberd \
  -p 3306:3306 -d mariadb:11

# залить схему и данные
docker exec -i temnet-maria mariadb -uroot -proot < schema.sql
docker exec -i temnet-maria mariadb -uroot -proot ejabberd < seed.sql
```

## Вариант B — MSI (установщик MariaDB для Windows)

1. Поставь MariaDB, задай пароль root = `root`, порт `3306`.
2. Залей фикстуры (из папки `db/`):

```bat
"C:\Program Files\MariaDB 11.x\bin\mariadb.exe" -uroot -proot < schema.sql
"C:\Program Files\MariaDB 11.x\bin\mariadb.exe" -uroot -proot ejabberd < seed.sql
```

## Запуск backend

Из корня проекта:

```bat
run_backend.bat
```

(скрипт уже выставляет `JAVA_HOME` на стоящий JDK 25 и стартует через Gradle wrapper)

## Что проверить на сид-данных

- `GET /admin/sync/status` → синхронизация прошла, счётчики сообщений и
  тикетов ненулевые.
- `GET /groups` → `CompanyA`, `CompanyB` (а `help-desk` и `all` исключены).
- `GET /companies?start=2025-01-01&end=2025-12-31` → строки по обеим
  компаниям с активными пользователями и исходами заявок.
- `GET /chat?start=2025-01-01&end=2025-12-31&groupName=CompanyA` → переписка
  клиентов группы с поддержкой, каждое сообщение один раз, поле даты —
  `createdAt`.
