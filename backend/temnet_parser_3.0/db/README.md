# Локальная БД для проверки backend

Тестовая схема ejabberd (`archive`, `sr_group`, `sr_user`) ровно с теми
колонками, которые читает синхронизация, плюс сид-данные, проводящие
стейт-машину заявок через все состояния.

Дефолты приложения (`application.properties`): БД `ejabberd`, пользователь
`root`, пароль `root`, `localhost:3306`. Если поставишь так — env-переменные
не нужны. Аналитическая база `temnet_analytics` создаётся приложением
автоматически; после старта подожди первую синхронизацию (~30 сек) или дёрни
`POST /api/admin/sync` — метрики читают уже синхронизированные таблицы.

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

Нужный JDK Gradle скачает сам (toolchain + foojay-resolver в
`settings.gradle`); достаточно любого JDK 17+ для запуска самого Gradle.
Пароль первого администратора `admin` печатается в лог при первом старте
(или берётся из `APP_ADMIN_PASSWORD`); он временный, при первом входе его
попросят сменить.

## Что должно получиться на сид-данных

Все пути — под `/api`, запросы требуют входа (cookie сессии), удобнее
проверять через интерфейс.

- `GET /api/admin/sync/status` → синхронизация прошла, сообщений 15 (30 строк
  дампа схлопнулись в пары, служебная строка и переписка клиент↔клиент
  отброшены), заявок 6: `closed` 4, `rejected` 1, `expired` 1; `reopens` 1.
- `GET /api/groups` → `CompanyA`, `CompanyB` (`help-desk`, `help-magistr` и
  `all` исключены).
- Участки: `help` обслуживает `CompanyA` и `CompanyB`, `help-mag` — только
  `CompanyB` (из `displayed_groups` в `sr_group.opts`).
- `GET /api/companies?start=2025-01-01&end=2025-12-31` → CompanyA: 2 активных
  пользователя, 3 закрытых, 1 отклонённая; CompanyB: 1 активный, 1 закрытая.
- `GET /api/chat?start=2025-01-01&end=2025-12-31&groupName=CompanyA&user=petrov`
  → переписка petrov с поддержкой за 2025 год, каждое сообщение один раз, у
  каждого есть `direction` (`in`/`out`) и `client`.
- Метрики за июнь 2025: у petrov первый ответ 3 мин и время решения 40 мин
  по первой заявке; вторая заявка petrov в тот же день — повторное
  обращение (маркер «опять», та же категория «Печать»); заявка sidorov от
  4 июня истекла по тишине, следующая от 9 июня закрыта участком `help-mag`.
