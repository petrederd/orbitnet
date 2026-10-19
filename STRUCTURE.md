# OrbitNet — Структура проекта

> Организация кода, соглашения и точки расширения.

**Обновлено:** 19 октября 2026
**Версия:** 0.4.0

## Общая схема

```
Пользователь
    │
    ▼
nginx  ──► site/ (статические HTML, CSS, JS)
    │
    └── /api/* ──► backend/server.js
                       ├── dns / net / tls / http / https
                       ├── whois
                       └── MaxMind GeoLite2 (data/geoip/)
```

Проект намеренно разделён на статический фронтенд и небольшой API. Клиентские инструменты работают без бэкенда; сетевые функции обращаются к `/api/`.

## Дерево репозитория

```
orbitnet/
├── .github/
│   └── workflows/
│       └── deploy.yml             # Деплой по push в main через SSH
│
├── site/                          # Публичная директория nginx
│   ├── index.html                 # Каталог 40 инструментов + IP-виджет
│   ├── about.html                 # О проекте
│   ├── robots.txt                 # Индексация и ссылка на sitemap
│   ├── sitemap.xml                # 42 URL: главная, about, 40 инструментов
│   │
│   ├── icons/
│   │   └── favicon.svg
│   │
│   ├── assets/
│   │   ├── css/
│   │   │   └── style.css          # Общая тема и UI-компоненты
│   │   ├── js/
│   │   │   └── main.js            # Поиск, фильтры, сортировка, IP-виджет
│   │   └── og-image.png           # Превью 1200×630 для Open Graph
│   │
│   └── tools/
│       ├── _template.html         # Шаблон новой страницы
│       │
│       ├── networks/              # 18 инструментов
│       │   ├── subnet-calculator.html
│       │   ├── ip-lookup.html
│       │   ├── ip-info.html
│       │   ├── dns-lookup.html
│       │   ├── reverse-ip.html
│       │   ├── port-checker.html
│       │   ├── site-info.html
│       │   ├── cidr-netmask.html
│       │   ├── ip-binary-converter.html
│       │   ├── mac-converter.html
│       │   ├── ssl-checker.html
│       │   ├── http-headers.html
│       │   ├── email-dns-checker.html
│       │   ├── email-deliverability.html
│       │   ├── dns-propagation.html
│       │   ├── redirect-checker.html
│       │   ├── website-health.html
│       │   └── network-diagnostics.html
│       │
│       ├── developer/             # 9 инструментов
│       │   ├── json-formatter.html
│       │   ├── base64.html
│       │   ├── uuid-generator.html
│       │   ├── password-generator.html
│       │   ├── hash-generator.html
│       │   ├── timestamp-converter.html
│       │   ├── regex-tester.html
│       │   ├── color-converter.html
│       │   └── jwt-decoder.html
│       │
│       ├── math/                  # 7 инструментов
│       │   ├── quadratic-solver.html
│       │   ├── percentage-calculator.html
│       │   ├── unit-converter.html
│       │   ├── number-base-converter.html
│       │   ├── scientific-notation.html
│       │   ├── statistics-calculator.html
│       │   └── prime-checker.html
│       │
│       ├── text/                  # 4 инструмента
│       │   ├── case-converter.html
│       │   ├── word-counter.html
│       │   ├── text-diff-checker.html
│       │   └── lorem-ipsum-generator.html
│       │
│       └── electricity/           # 2 инструмента
│           ├── ohms-law.html
│           └── ne555-calculator.html
│
├── backend/
│   ├── server.js                  # HTTP API, 12 маршрутов
│   ├── package.json               # Единственная зависимость: maxmind
│   ├── package-lock.json
│   └── Dockerfile                 # node:20-alpine
│
├── data/
│   └── geoip/                     # GeoLite2, не коммитится
│       ├── GeoLite2-City.mmdb
│       └── GeoLite2-ASN.mmdb
│
├── nginx.conf                     # Статика + proxy_pass /api/
├── docker-compose.yml             # site + api + geoip-updater (profile)
├── .env.example                   # Шаблон ключей MaxMind
├── .gitignore
├── LICENSE
├── README.md                      # Обзор проекта и запуск
├── ROADMAP.md                     # Планы развития
└── STRUCTURE.md                   # Этот файл
```

## Frontend

### Страница инструмента

Каждый инструмент — самостоятельный HTML-файл. Общая структура:

1. `<!doctype html>` и `<html lang="en">`.
2. `<head>`: кодировка, viewport, description, theme-color, title.
3. SEO-блок: canonical, Open Graph, Twitter Card.
4. Favicon и общий `style.css`.
5. Шапка с навигацией.
6. `main.tool-page`:
   - breadcrumb;
   - заголовок и краткое описание;
   - панель ввода;
   - панель результата;
   - информационный блок с пояснениями.
7. Подвал с годом и ссылками.
8. Встроенный `<script>` с логикой инструмента.

### Обязательный SEO-блок

После `</title>` должны идти:

```html
<link rel="canonical" href="https://orbitnet.ru/tools/<category>/<tool>.html">
<meta property="og:type" content="website">
<meta property="og:site_name" content="OrbitNet">
<meta property="og:title" content="<title>">
<meta property="og:description" content="<description>">
<meta property="og:url" content="https://orbitnet.ru/tools/<category>/<tool>.html">
<meta property="og:locale" content="en_US">
<meta property="og:image" content="https://orbitnet.ru/assets/og-image.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="OrbitNet — open tools, no noise">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="<title>">
<meta name="twitter:description" content="<description>">
<meta name="twitter:image" content="https://orbitnet.ru/assets/og-image.png">
```

Для главной canonical — `https://orbitnet.ru/`, для `about.html` — `https://orbitnet.ru/about.html`. В `_template.html` URL нужно заменить на реальный путь нового инструмента.

### Стили

`site/assets/css/style.css` содержит:

- CSS-переменные темы;
- сетку и контейнеры;
- карточки, кнопки, поля, панели результатов;
- адаптивные breakpoints;
- состояния ошибок, предупреждений и успеха.

Основные переменные:

```css
--paper: #16161a;
--paper-2: #1e1e24;
--ink: #e8e8ea;
--muted: #9a9aa2;
--line: #2c2c33;
--accent: #6ecfa0;
--accent-dim: #14382a;
--card: #1c1c21;
--danger: #f28b82;
--warning: #f5c66b;
--radius: 8px;
```

Новые инструменты не должны вводить собственные цвета вне этих переменных без необходимости.

### Главная страница

`site/assets/js/main.js`:

- ищет карточки `.tool-card`;
- фильтрует по `data-category`;
- сортирует по `data-order`, имени или категории;
- обрабатывает `/` для фокуса поиска и `Esc` для сброса;
- загружает IP-виджет через `/api/ip`;
- обновляет год в подвале.

Карточки инструментов добавляются в `site/index.html` вручную.

## Backend

`backend/server.js` — CommonJS-приложение на встроенных модулях Node.js. Внешняя зависимость только `maxmind`.

### Маршруты

| Маршрут | Модули | Назначение |
|---|---|---|
| `GET /health` | — | Healthcheck |
| `GET /api/ip` | dns, geo | IP клиента, PTR, геолокация, ASN |
| `GET /api/geo` | dns, maxmind | Геолокация по IP или домену |
| `GET /api/dns` | dns | DNS-записи |
| `GET /api/port` | net | TCP-проверка |
| `GET /api/whois` | net | whois-запрос |
| `GET /api/site` | http/https | Статус, сервер, title, время ответа |
| `GET /api/headers` | http/https | Заголовки ответа |
| `GET /api/tls` | tls | Сертификат и цепочка |
| `GET /api/email` | dns | MX, SPF, DMARC, DKIM, PTR |
| `GET /api/propagation` | dns | Несколько публичных резолверов |
| `GET /api/redirect` | http/https | Цепочка редиректов |

### Защита

- Проверка публичности IP до соединения.
- Проверка всех адресов, полученных через DNS.
- Блокировка приватных и служебных диапазонов.
- Отдельная проверка каждого шага редиректа.
- Таймауты и ограниченная очередь исходящих запросов.
- Rate limiting с ответом HTTP 429.

IP клиента берётся из `X-Real-IP`, который выставляет nginx. nginx доверяет `CF-Connecting-IP` только от Cloudflare и локальных прокси.

### GeoIP

- `GEOIP_DIR` задаёт каталог с `.mmdb`.
- В Docker это `/data/geoip`.
- При изменении mtime файлы перечитываются без рестарта.
- `geoip-updater` — опциональный сервис Docker Compose с профилем `geoip`.

## Docker и деплой

`docker-compose.yml`:

- `orbitnet-site` — nginx, статика из `./site`, порт `127.0.0.1:8081`.
- `orbitnet-api` — Node.js, внутренний порт `3000`.
- `geoip-updater` — профиль `geoip`, обновляет базы раз в 24 часа.

`nginx.conf`:

- отдаёт статику;
- проксирует `/api/` на `orbitnet-api:3000`;
- добавляет базовые security-заголовки;
- корректно определяет реальный IP.

`.github/workflows/deploy.yml` по push в `main`:

1. подключается к серверу по SSH;
2. делает `git pull`;
3. пересобирает контейнеры;
4. запускает `geoip-updater`, если в `.env` есть ключи MaxMind.

## SEO и индексация

- `site/sitemap.xml` содержит главную, `about.html` и все 40 инструментов.
- `site/robots.txt` разрешает индексацию и указывает на sitemap.
- У всех страниц есть canonical и Open Graph.
- Общее превью — `site/assets/og-image.png` (1200×630).

При добавлении страницы:

1. добавьте canonical с её реальным URL;
2. заполните `og:title`, `og:description`, `og:url`;
3. добавьте URL в `sitemap.xml`;
4. проверьте, что карточка есть на главной.

## Соглашения для нового инструмента

1. Скопируйте `site/tools/_template.html` в нужную категорию.
2. Назовите файл в kebab-case: `led-resistor.html`.
3. Заполните title, description, canonical и Open Graph.
4. Переиспользуйте классы `tool-panel`, `input-group`, `result-box`, `btn`.
5. Валидируйте входные данные и показывайте понятные ошибки.
6. Не отправляйте пользовательские данные на сервер без необходимости.
7. Для тяжёлых алгоритмов задавайте лимиты по размеру ввода и времени.
8. Проверьте мобильную вёрстку, клавиатуру и консоль браузера.
9. Добавьте карточку в `site/index.html` и URL в `site/sitemap.xml`.

## Что стоит знать перед изменениями

- Фронтенд не использует сборщик: пути к CSS и ассетам относительные от страницы.
- В `site/tools/**` путь к общим ассетам — `../../assets/...`.
- Все страницы должны оставаться рабочими при прямом открытии через локальный HTTP-сервер.
- Сетевые инструменты без Docker требуют отдельного проксирования `/api/`.
- Backend не хранит пользовательские данные; логи инфраструктуры — ответственность хостинга.
- При изменении API обновите таблицу маршрутов здесь и раздел API в README.
