# OrbitNet — Структура проекта

> Организация кода, соглашения и точки расширения.

**Обновлено:** 22 октября 2026
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
                       ├── MaxMind GeoLite2 (data/geoip/)
                       └── external-check.js ──► Cloudflare Worker (fallback)
```

Проект намеренно разделён на статический фронтенд и небольшой API. Клиентские инструменты работают без бэкенда; сетевые функции обращаются к `/api/`.

## Дерево репозитория

```
orbitnet/
├── .github/
│   └── workflows/
│       └── deploy.yml             # Тесты → деплой по push в main → live-проверка
│
├── .githooks/
│   └── pre-push                   # Локальный запуск npm test перед push
│
├── tests/
│   ├── helpers.js                 # Загрузка inline-скриптов инструментов в vm
│   ├── calculators.test.js        # timestamp, color, scientific, statistics, unit, Base64, regex worker
│   ├── tools-extra.test.js        # cron, URL, YAML/JSON/CSV, diff, redirects, robots, headers, IPv6, Unicode, JWT
│   ├── smoke.test.js              # Playwright: все страницы, CSP, Worker, избранное, axe
│   ├── health.test.js             # /health + метрики, публичный /api/health
│   ├── subnet.test.js             # /0, /24, /31, /32 и режим маски
│   ├── password.test.js           # обычный, распространённый и длинный пароль
│   ├── prime.test.js              # 0, 1, 2, 97, 561, большие числа
│   ├── uuid.test.js               # crypto fallback для UUID
│   ├── anonymity.test.js          # timezone, private IP, score, WebRTC
│   ├── spam.test.js               # DNSBL: reverse-метка, коды ответов, IP/домен/email
│   ├── security.test.js           # аудит: парсеры HSTS/security.txt/cookies/mixed, оценка A-F
│   ├── external-check.test.js     # Worker-клиент: HTTP/DNS/propagation/email
│   ├── worker.test.js             # сам Cloudflare Worker с mock fetch
│   ├── seo.test.js                # canonical, OG, JSON-LD, sitemap, og-image.png
│   └── live-check.js              # проверка опубликованного сайта
│
├── site/                          # Публичная директория nginx
│   ├── index.html                 # Каталог 55 инструментов + IP-виджет
│   ├── about.html                 # О проекте
│   ├── 404.html                   # Кастомная страница «не найдено»
│   ├── robots.txt                 # Индексация и ссылка на sitemap
│   ├── sitemap.xml                # 57 URL: главная, about, 55 инструментов
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
│       ├── networks/              # 23 инструмента
│       │   ├── subnet-calculator.html
│       │   ├── ipv6-subnet-calculator.html
│       │   ├── ipv6-converter.html
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
│       │   ├── network-diagnostics.html
│       │   ├── anonymity-check.html
│       │   ├── spam-blacklist-check.html
│       │   └── security-audit.html
│       │
│       ├── developer/             # 18 инструментов
│       │   ├── json-formatter.html
│       │   ├── base64.html
│       │   ├── uuid-generator.html
│       │   ├── password-generator.html
│       │   ├── hash-generator.html
│       │   ├── timestamp-converter.html
│       │   ├── regex-tester.html
│       │   ├── color-converter.html
│       │   ├── jwt-decoder.html
│       │   ├── cron-parser.html
│       │   ├── url-encoder.html
│       │   ├── url-parser.html
│       │   ├── yaml-json.html
│       │   ├── json-csv.html
│       │   ├── json-diff.html
│       │   ├── redirect-generator.html
│       │   ├── robots-generator.html
│       │   └── security-headers.html
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
│       ├── text/                  # 5 инструментов
│       │   ├── case-converter.html
│       │   ├── word-counter.html
│       │   ├── text-diff-checker.html
│       │   ├── lorem-ipsum-generator.html
│       │   └── unicode-inspector.html
│       │
│       └── electricity/           # 2 инструмента
│           ├── ohms-law.html
│           └── ne555-calculator.html
│
├── backend/
│   ├── server.js                  # HTTP API, 15 маршрутов
│   ├── external-check.js          # клиент Worker, нормализация ответов
│   ├── package.json               # Единственная зависимость: maxmind
│   ├── package-lock.json
│   └── Dockerfile                 # node:22-alpine, non-root, healthcheck
│
├── worker/
│   ├── src/index.js               # Cloudflare Worker: HTTP, DNS, propagation, email + SSRF-защита
│   ├── package.json
│   ├── wrangler.toml
│   └── README.md                  # деплой и настройка секрета
│
├── data/
│   └── geoip/                     # GeoLite2, не коммитится
│       ├── GeoLite2-City.mmdb
│       └── GeoLite2-ASN.mmdb
│
├── nginx.conf                     # Статика + proxy_pass /api/
├── cloudflare-ips.conf            # Диапазоны Cloudflare (автообновление)
├── deploy/
│   └── Caddyfile.example          # Пример trusted_proxies для Caddy
├── scripts/
│   └── update-cloudflare-ips.sh   # Обновление cloudflare-ips.conf
├── docker-compose.yml             # site + api + geoip-updater (profile)
├── .env.example                   # Шаблон ключей MaxMind и Worker
├── .gitignore
├── LICENSE
├── package.json                   # npm test, test:smoke, test:live, hooks:install
├── package-lock.json              # devDependencies: Playwright, axe-core и js-yaml
├── README.md                      # Обзор проекта и запуск
├── ROADMAP.md                     # Планы развития
└── STRUCTURE.md                   # Этот файл
```

## Тесты

Unit-, SEO- и health-тесты используют встроенный `node:test`. Браузерные тесты используют Playwright и axe-core из `devDependencies`.

```bash
npm install                       # один раз: Playwright и axe-core
npx playwright install chromium   # один раз: браузер для smoke-тестов
npm test                          # unit + SEO + health + smoke + axe
npm run test:smoke                # только браузерные проверки
npm run test:live                 # canonical URL и og-image.png на orbitnet.ru
npm run hooks:install
```

- `tests/calculators.test.js` проверяет timestamp (секунды/миллисекунды, UTC/local), color (современный синтаксис, clamp, мусор после `)`), scientific notation (запятые, 2^53), statistics (hex, малые числа), unit converter (абсолютный ноль), Base64 (UTF-8/эмодзи) и regex worker (лимит совпадений, ошибки).
- `tests/tools-extra.test.js` проверяет cron, URL encode/parse, YAML ↔ JSON, JSON → CSV, JSON diff, redirect/robots/security headers generators, IPv6, Unicode и JWT HS256 verification.
- `tests/smoke.test.js` поднимает статический сервер с CSP из `nginx.conf`, открывает все страницы, проверяет отсутствие console/page errors, реальный Web Worker, `?q=`, избранное и serious/critical нарушения axe. Без Chromium тест пропускается; в CI `REQUIRE_BROWSER_TESTS=1` делает его обязательным.
- `tests/health.test.js` проверяет подробный внутренний `/health` и минимальный публичный `/api/health`.
- `tests/subnet.test.js` загружает inline-скрипт Subnet Calculator в `vm` и проверяет `/0`, `/24`, `/31`, `/32` и ввод маски `255.255.255.0`.
- `tests/password.test.js` проверяет обычный пароль, список распространённых паролей и длинный случайный пароль.
- `tests/prime.test.js` проверяет 0, 1, 2, 97, 561, большое простое и большое составное число, факторизацию и отображение соседних простых.
- `tests/uuid.test.js` проверяет, что fallback UUID использует `crypto.getRandomValues()`, а не `Math.random()`.
- `tests/anonymity.test.js` проверяет расчёт часовых поясов, классификацию приватных IP, вклад сигналов в score, безопасное поведение без WebRTC, а также backend-эвристики для hosting/PTR/proxy-заголовков.
- `tests/spam.test.js` проверяет reverse-метку IPv4, разбор ответов DNSBL (листинг, `127.255.255.x` как blocked, NXDOMAIN как «не в списке»), разбор цели IP/домен/email и `spamCheck` с внедрённым резолвером для IP, домена и MX.
- `tests/security.test.js` проверяет парсеры HSTS `max-age`, `Set-Cookie`, `security.txt`, mixed content (игнор namespace-URL), отображение score в A–F и сборку отчёта для «хорошего», «плохого» и header-only (Worker) случая.
- `tests/seo.test.js` проверяет canonical и OG на каждой странице, уникальность URL, соответствие sitemap, JSON-LD `SoftwareApplication`/`WebSite`/`FAQPage` и размеры `og-image.png`.
- `tests/live-check.js` проверяет доступность всех canonical URL и `og-image.png` на опубликованном сайте.

`.githooks/pre-push` запускает `npm test` перед `git push`. Хук включается командой `npm run hooks:install` (устанавливает `core.hooksPath`). CI-workflow ставит root- и backend-зависимости, Chromium, запускает те же локальные тесты до деплоя и `test:live` после него.

## Frontend

### Страница инструмента

Каждый инструмент — самостоятельный HTML-файл. Общая структура:

1. `<!doctype html>` и `<html lang="en">`.
2. `<head>`: кодировка, viewport, description, theme-color, title.
3. SEO-блок: canonical, Open Graph, Twitter Card, JSON-LD `SoftwareApplication`.
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
- читает начальный запрос из `?q=`;
- хранит избранные инструменты в `localStorage` и показывает фильтр «Favorites»;
- загружает IP-виджет через `/api/ip`;
- обновляет год в подвале.

Карточки инструментов добавляются в `site/index.html` вручную.

## Backend

`backend/server.js` — CommonJS-приложение на встроенных модулях Node.js. Внешняя зависимость только `maxmind`. `backend/external-check.js` — клиент Cloudflare Worker: используется как fallback для HTTP, DNS, propagation, email и цепочек редиректов, когда локальная проверка не смогла получить ответ.

### Маршруты

| Маршрут | Модули | Назначение |
|---|---|---|
| `GET /health` | — | Внутренний healthcheck и in-process метрики (requests, errors, rateLimited, sources, external) |
| `GET /api/health` | — | Публичная проверка доступности: только `{"ok":true}` |
| `GET /api/ip` | dns, geo | IP клиента, PTR, геолокация, ASN |
| `GET /api/geo` | dns, maxmind | Геолокация по IP или домену |
| `GET /api/dns` | dns, external-check | DNS-записи; fallback в Worker при сетевой ошибке |
| `GET /api/port` | net | TCP-проверка |
| `GET /api/whois` | net | whois-запрос |
| `GET /api/site` | http/https, external-check | Статус, сервер, title, время ответа; fallback в Worker |
| `GET /api/headers` | http/https, external-check | Заголовки ответа; fallback в Worker |
| `GET /api/tls` | tls | Сертификат и цепочка |
| `GET /api/email` | dns, external-check | MX, SPF, DMARC, DKIM, PTR; fallback в Worker при сбое MX |
| `GET /api/propagation` | dns, external-check | Несколько публичных резолверов; fallback в Worker при отказе всех |
| `GET /api/redirect` | http/https, external-check | Цепочка редиректов; fallback в Worker при сетевой ошибке |
| `GET /api/spam` | dns | IP/домен/email по DNSBL/URIBL; reverse-метка, MX-адреса для домена, кэш и лимит запросов |
| `GET /api/security` | http/https, dns, external-check | Аудит безопасности с оценкой A–F; header-only fallback в Worker при отсутствии локального статуса |

### Защита

- Проверка публичности IP до соединения.
- Проверка всех адресов, полученных через DNS.
- Блокировка приватных и служебных диапазонов.
- Отдельная проверка каждого шага редиректа.
- Таймауты и ограниченная очередь исходящих запросов.
- Rate limiting с ответом HTTP 429.
- Worker-fallback для HTTP только при отсутствии HTTP-статуса; для DNS/email/propagation — при ошибке локального резолвера; заблокированные локально адреса в Worker не отправляются.
- Worker не используется для TLS-сертификата, WHOIS и произвольных TCP-портов: для них нужен raw TCP.
- `CHECKER_URL`/`CHECKER_SECRET` приходят из окружения Docker, секрет не попадает в клиентский код.

IP клиента берётся из `X-Real-IP`, который выставляет nginx. nginx доверяет `CF-Connecting-IP` только от Cloudflare и локальных прокси.

### GeoIP

- `GEOIP_DIR` задаёт каталог с `.mmdb`.
- В Docker это `/data/geoip`.
- При изменении mtime файлы перечитываются без рестарта.
- `geoip-updater` — опциональный сервис Docker Compose с профилем `geoip`.

## Docker и деплой

`docker-compose.yml`:

- `orbitnet-site` — nginx, статика из `./site`, порт `127.0.0.1:8081`.
- `orbitnet-api` — Node.js, внутренний порт `3000`; получает `CHECKER_URL`, `CHECKER_SECRET`, `CHECKER_TIMEOUT`, `EXTERNAL_RATE_MAX`, `EXTERNAL_GLOBAL_MAX`, `EXTERNAL_NXDOMAIN_RATE_MAX`, `EXTERNAL_NXDOMAIN_GLOBAL_MAX`, `REQUEST_BUDGET_MS` и `DNSBL_RESOLVER` из серверного `.env`.
- `geoip-updater` — профиль `geoip`, обновляет базы раз в 24 часа.

`nginx.conf`:

- отдаёт статику;
- проксирует `/api/` на `orbitnet-api:3000`;
- добавляет security-заголовки (включая HSTS и CSP);
- кэширует версионированные ассеты и не кэширует HTML;
- отдаёт кастомную `404.html`, в том числе для директорий без индекса;
- корректно определяет реальный IP; диапазоны Cloudflare — в `cloudflare-ips.conf`.

`.github/workflows/deploy.yml` по push в `main`:

1. ставит root-зависимости (`npm ci`) и бэкенда (`npm ci --prefix backend`);
2. устанавливает Chromium (`npx playwright install --with-deps chromium`);
3. запускает тесты с `REQUIRE_BROWSER_TESTS=1`;
4. подключается к серверу по SSH;
5. обновляет `cloudflare-ips.conf` (при наличии сети);
6. делает `git pull --ff-only`;
7. пересобирает контейнеры и ждёт готовности сайта до live-проверки;
8. запускает `geoip-updater`, если в `.env` есть ключи MaxMind.

Деплои сериализуются через `concurrency`, старые образы удаляются, а путь к
проекту на сервере задаётся переменной `DEPLOY_PATH` (по умолчанию
`/home/user/orbitnet-site`).

## SEO и индексация

- `site/sitemap.xml` содержит главную, `about.html` и все 55 инструментов.
- `site/robots.txt` разрешает индексацию и указывает на sitemap.
- У всех страниц есть canonical и Open Graph.
- У инструментов есть JSON-LD `SoftwareApplication`; на главной — `WebSite`, `SearchAction` (`/?q=`) и `FAQPage`.
- Общее превью — `site/assets/og-image.png` (1200×630).

При добавлении страницы:

1. добавьте canonical с её реальным URL;
2. заполните `og:title`, `og:description`, `og:url`;
3. добавьте JSON-LD `SoftwareApplication` (как на существующих страницах);
4. добавьте URL в `sitemap.xml`;
5. проверьте, что карточка есть на главной.

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
10. Добавьте JSON-LD `SoftwareApplication` и прогоните `npm test`.

## Что стоит знать перед изменениями

- Фронтенд не использует сборщик: пути к CSS и ассетам относительные от страницы.
- В `site/tools/**` путь к общим ассетам — `../../assets/...`.
- Все страницы должны оставаться рабочими при прямом открытии через локальный HTTP-сервер.
- Сетевые инструменты без Docker требуют отдельного проксирования `/api/`.
- Backend не хранит пользовательские данные; логи инфраструктуры — ответственность хостинга.
- При изменении API обновите таблицу маршрутов здесь и раздел API в README.
