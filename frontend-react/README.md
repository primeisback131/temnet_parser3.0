# Temnet Parser — Frontend (React)

Современный фронтенд, заменяющий старое Angular 12 приложение (`../frontend`).

## Стек

- **React 19** + **Vite 5** (esbuild, без webpack)
- **Ant Design 5** — UI-компоненты
- **TanStack Query** — загрузка/кэширование данных
- **dayjs** — даты
- **exceljs** — экспорт в `.xlsx` (грузится лениво, только при экспорте)

## Экраны

| Маршрут       | Экран                       | API                          |
| ------------- | --------------------------- | ---------------------------- |
| `/chat`       | История чата по группе      | `/groups`, `/users`, `/chat` |
| `/companies`  | Статистика компаний (групп) | `/companies`                 |
| `/users`      | Статистика пользователей    | `/groups`, `/users`          |

## Запуск

```bash
npm install
npm run dev      # http://localhost:5173
```

Адрес бэкенда задаётся в `.env`:

```
VITE_API_BASE=http://localhost:8080
```

Бэкенд (Spring Boot) должен разрешать CORS для этого origin — он берётся из
переменной `CORS_ORIGIN` (по умолчанию `http://localhost:5173`).

## Сборка

```bash
npm run build    # tsc (typecheck) + vite build → dist/
npm run preview  # локальный предпросмотр продакшен-сборки
```
