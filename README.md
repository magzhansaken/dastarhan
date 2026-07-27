# Dastarhan — сайт

Коммерческий сайт системы автоматизации для Казахстана.

## Что внутри

```
site/           готовый сайт (22 страницы: 11 × ru/kk)
src/            исходники: шаблоны + генератор
Caddyfile       конфиг веб-сервера
docker-compose.yml
update.sh       обновление на сервере одной командой
```

## Развёрнуто

https://dastarhan.duckdns.org:8443

## Обновление сайта

**На компьютере:** правишь `src/_*.template.html`, затем:
```bash
cd src && node build.mjs && cp -r dist/* ../site/
git add -A && git commit -m "правки" && git push
```

**На сервере:**
```bash
/opt/dastarhan/update.sh
```

## Страницы

| Путь | Что |
|---|---|
| `/` | главная |
| `/pricing.html` | тарифы с калькулятором |
| `/pages/cafe.html` | кафе и ресторан |
| `/pages/fastfood.html` | фастфуд |
| `/pages/shop.html` | магазин |
| `/pages/billiard.html` | бильярд и клуб |
| `/pages/salon.html` | салон красоты |
| `/pages/integrations.html` | интеграции |
| `/pages/partners.html` | партнёрам |
| `/pages/demo.html` | живое демо |
| `/pages/register.html` | регистрация |
| `/kk/...` | всё то же на казахском |
