# Dastarhan POS — монорепозиторий

Облачная POS-платформа для Казахстана. TypeScript везде.

## Структура
```
apps/
  api/         NestJS — облачный бэкенд (REST API, auth, sync)
  backoffice/  Next.js — веб-админка владельца
  pos/         React+Vite — касса (офлайн-первая), упаковка: Tauri (Windows) / Capacitor (Android)
packages/
  db/          Prisma-схема PostgreSQL (единый источник правды о данных)
  shared/      общие типы/договоры API/права — используются всеми приложениями
```

## Ключевые решения фундамента (из анализа 5 конкурентов)
1. **Мультитенантность**: единая БД, каждая строка привязана к account_id (SaaS-модель Poster/QuickResto, а не «26 продуктов» r_keeper).
2. **Иерархия**: Account (бизнес) → Location (точка) → Terminal (касса). Готово к сетям с 1-го дня (урок iiko), но не мешает одиночной точке.
3. **Доступ**: роль сотрудника назначается ПО ТОЧКАМ (урок Poster access-by-locations); права — группами по операциям с тремя состояниями: allowed / pin_required / denied (урок QuickResto «состояние права» + Poster «админ-пароль на опасные действия»).
4. **Два входа**: бэк-офис — email+пароль (JWT); касса — PIN сотрудника на привязанном терминале (все 5 так делают — скорость у стойки).
5. **Офлайн заложен в ядро**: таблица EventLog + на кассе журнал событий в SQLite; синхронизация идемпотентными событиями (уроки Poster «как мы держим терминалы в синхроне»).
6. **Профиль вертикали** на аккаунте: cafe|fastfood|shop|salon|billiard — включает модули (урок Paloma).

## Запуск (dev)
```
docker compose up -d   # postgres + redis
pnpm install
pnpm -C packages/db prisma migrate dev
pnpm -C apps/api start:dev
```
