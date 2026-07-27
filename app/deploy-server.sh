#!/bin/bash
# Развёртывание Dastarhan на сервере. Тендер и бот не затрагиваются.
set -e
cd "$(dirname "$0")"

echo "── 1. Проверка .env"
[ -f .env ] || { cp .env.example .env; echo "  создан .env — впиши JWT_SECRET и запусти снова"; exit 1; }
grep -q "смени-на-случайную" .env && { echo "  ⛔ впиши настоящий JWT_SECRET в .env"; exit 1; }

echo "── 2. Сборка образов (первый раз 3–5 минут)"
docker compose -f docker-compose.server.yml build

echo "── 3. Запуск базы"
docker compose -f docker-compose.server.yml up -d db
sleep 8

echo "── 4. Схема в базу"
docker compose -f docker-compose.server.yml run --rm api \
  pnpm exec prisma db push --schema packages/db/schema.prisma --accept-data-loss

echo "── 5. Запуск API"
docker compose -f docker-compose.server.yml up -d api
sleep 12

echo "── 6. Проверка"
docker compose -f docker-compose.server.yml ps
docker exec dastarhan-api curl -fsS http://localhost:3000/api/v1/health && echo " ← API живой" || echo " ⛔ API не отвечает"
