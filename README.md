# OrbitNet

> **Open tools, no noise** - коллекция бесплатных практичных веб-инструментов для сетей, разработки, математики, текста и электроники.

[![License: MIT](https://img.shields.io/badge/License-MIT-orange.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-active-success.svg)]()

**Сайт:** [orbitnet.ru](https://orbitnet.ru)

## О проекте

OrbitNet — открытый набор небольших инструментов, которые решают конкретные задачи без регистрации, рекламы и лишнего интерфейса.

- **Без рекламы** - никаких баннеров и спонсорских блоков.
- **Без трекинга** - нет пользовательских профилей и сторонней аналитики.
- **Без регистрации** - инструменты доступны сразу.
- **Приватность** - вычисления выполняются локально в браузере; сетевые проверки идут через собственный бэкенд, а при блокировке — через Cloudflare Worker и публичные DNS-over-HTTPS резолверы (только для затронутой проверки).
- **Open source** - код открыт для изучения, форка и улучшений.

> Технические логи веб-сервера, reverse-proxy и хостинга могут содержать IP-адрес, время и путь запроса. Это стандартные логи инфраструктуры, а не профилирование пользователей.

## Что уже работает

Сейчас в коллекции **41 инструмент** в пяти категориях.

### Сети — 19

| Инструмент | Что делает |
|---|---|
| IPv4 Subnet Calculator | Network/broadcast, маска, диапазон и количество хостов |
| IP Lookup | Публичный IP, reverse DNS, геолокация и провайдер |
| IP & Domain Info | DNS, PTR, whois, геолокация и ASN |
| DNS Lookup | Записи A, AAAA, MX, TXT, NS, CNAME, SOA, CAA |
| Reverse IP Lookup | PTR-запись для IP-адреса |
| Port Checker | Проверка TCP-порта на доступность |
| Site Info | HTTP-статус, сервер, заголовок и время ответа |
| CIDR / Netmask Converter | CIDR ↔ маска ↔ wildcard |
| IP / Binary Converter | IPv4 ↔ binary/decimal/hex |
| MAC Address Converter | Форматы MAC, тип адреса и OUI |
| SSL/TLS Checker | Срок сертификата, издатель, SAN, цепочка и имя |
| HTTP Headers Inspector | Заголовки ответа и security-подсказки |
| Email DNS Checker | MX, SPF, DMARC, DKIM и PTR |
| Email Deliverability Check | Разбор почтовых DNS-настроек и ошибок |
| DNS Propagation Checker | Сравнение ответов нескольких резолверов |
| Redirect Checker | Цепочка редиректов, коды и конечный адрес |
| Website Health Check | DNS + TLS + доступность + заголовки одним отчётом |
| Network Diagnostics | Прямой/обратный DNS и проверка порта на одной странице |
| Anonymity Check | Proxy-заголовки, Tor/хостинг/PTR-сигналы, timezone mismatch, WebRTC и опциональная проверка портов своего IP |

### Разработка — 9

JSON Formatter & Validator, Base64 Encoder/Decoder, UUID Generator, Password Generator, Hash Generator (MD5/SHA-1/SHA-256/SHA-384/SHA-512), Timestamp Converter, Regex Tester, Color Converter (HEX/RGB/HSL), JWT Decoder.

### Математика — 7

Quadratic Equation Solver, Percentage Calculator, Unit Converter, Number Base Converter, Scientific Notation Converter, Statistics Calculator, Prime Number Checker.

### Текст — 4

Case Converter, Word Counter, Text Diff Checker, Lorem Ipsum Generator.

### Электроника — 2

Ohm's Law Calculator, NE555 Timer Calculator.

## Архитектура

```
Браузер
  ├── статические HTML/CSS/JS  ──► nginx (site/)
  └── fetch('/api/...')        ──► nginx ──► Node.js API (backend/)
                                            ├── DNS / TCP / TLS / HTTP
                                            ├── whois
                                            ├── MaxMind GeoLite2 (data/geoip/)
                                            └── Cloudflare Worker (fallback only)
```

- **Frontend** — статические страницы без сборщика и фреймворков. Каждый инструмент — отдельный HTML-файл с общим `assets/css/style.css`.
- **Backend** — небольшой HTTP-сервис на встроенных модулях Node.js. Единственная внешняя зависимость — `maxmind` для чтения GeoLite2.
- **nginx** — раздаёт статику и проксирует `/api/` на бэкенд.
- **Docker Compose** — поднимает `site`, `api` и опциональный `geoip-updater`.

## Структура репозитория

```
orbitnet/
├── site/                          # Публичная статика
│   ├── index.html                 # Каталог инструментов
│   ├── about.html
│   ├── robots.txt
│   ├── sitemap.xml
│   ├── icons/favicon.svg
│   ├── assets/
│   │   ├── css/style.css
│   │   ├── js/main.js             # Поиск, фильтры, сортировка, IP-виджет
│   │   └── og-image.png           # Open Graph превью
│   └── tools/
│       ├── _template.html         # Шаблон нового инструмента
│       ├── networks/              # 19 инструментов
│       ├── developer/             # 9 инструментов
│       ├── math/                  # 7 инструментов
│       ├── text/                  # 4 инструмента
│       └── electricity/           # 2 инструмента
├── backend/
│   ├── server.js                  # API на Node.js
│   ├── external-check.js          # fallback-клиент Cloudflare Worker
│   ├── package.json
│   └── Dockerfile
├── worker/                        # Cloudflare Worker для внешней проверки
│   ├── src/index.js
│   ├── wrangler.toml
│   └── README.md
├── data/geoip/                    # GeoLite2 (не коммитится)
├── nginx.conf                     # Статика + прокси /api/
├── docker-compose.yml
├── .env.example
├── .github/workflows/deploy.yml
├── README.md
├── ROADMAP.md
└── STRUCTURE.md
```

Подробное описание файлов и соглашений — в [STRUCTURE.md](STRUCTURE.md).

## Технологии

- Vanilla JavaScript, HTML5, современный CSS (Grid, Custom Properties).
- Node.js без фреймворков; `maxmind` для GeoIP.
- nginx, Docker Compose, GitHub Actions.
- SEO: `canonical`, Open Graph, Twitter Card, `sitemap.xml`, `robots.txt`.

## Локальный запуск

### Только статические инструменты

```bash
cd site
python3 -m http.server 8000
# http://localhost:8000
```

Так работают клиентские инструменты. Сетевые проверки требуют бэкенда и проксирования `/api/`.

### Бэкенд отдельно

```bash
cd backend
npm install
node server.js
# API: http://localhost:3000
```

### Docker (рекомендуется)

```bash
docker compose up -d --build
# Сайт: http://localhost:8081
```

В этом режиме nginx сам проксирует `/api/` на бэкенд. Для сетевых инструментов положите базы GeoLite2 в `data/geoip/` или включите автообновление:

```bash
cp .env.example .env
# укажите MAXMIND_ACCOUNT_ID и MAXMIND_LICENSE_KEY
docker compose --profile geoip up -d
```

### Внешняя проверка доступности (Cloudflare Worker)

Если сайт или DNS недоступны с сервера, но работают извне (например, из-за
блокировок в России), включите fallback через Cloudflare Worker. Локальная
проверка всегда выполняется первой; Worker используется, когда локально не
удалось получить HTTP-ответ или цепочку редиректов, когда локальный HTTP-ответ
выглядит как блокировка провайдера (403/451 или заглушка), а также при
транспортных сбоях DNS. Для DNS `ENOTFOUND` всегда перепроверяется через
Worker (провайдеры часто подменяют блокировку на NXDOMAIN), а `ENODATA` — только
если локальный резолвер не проходит контрольный запрос. Успешные ответы Worker
кэшируются на 60 секунд, поэтому повторные проверки не расходуют лимиты.
Email-fallback срабатывает на транспортные ошибки и на NXDOMAIN при поиске MX,
но не на обычное отсутствие DMARC/DKIM.

Worker умеет:

- HTTP(S): статус, реальные заголовки, `title`, до 10 редиректов;
- DNS: A, AAAA, CNAME, MX, TXT, NS, SOA, CAA, PTR через DNS-over-HTTPS;
- propagation: сравнение Cloudflare, Google и AdGuard DoH;
- email: MX, SPF, DMARC, DKIM и PTR основного MX.

Не покрываются: TLS-сертификат (`/api/tls`), WHOIS и произвольные TCP-порты —
для них нужен raw TCP, которого у Worker нет. Страницы блокировки провайдера
определяются по характерным заголовкам; заглушка с нейтральным `title` может
остаться незамеченной.

1. Задеплойте Worker из `worker/` и задайте секрет — подробно в
   [worker/README.md](worker/README.md).
2. В серверном `.env` (gitignored) укажите:

```dotenv
CHECKER_URL=https://orbitnet-site-checker.<account>.workers.dev/
CHECKER_SECRET=<секрет из wrangler secret put>
# необязательно, миллисекунды; диапазон 1000–20000, по умолчанию 20000
CHECKER_TIMEOUT=20000
```

3. Перезапустите API:

```bash
docker compose up -d --build --force-recreate orbitnet-api
```

Секрет хранится только в серверном `.env` и в Cloudflare Worker Secret; в
репозиторий, GitHub Actions и клиентский JavaScript он не попадает.

Когда fallback действительно срабатывает, домен или IP этой проверки
отправляется в Cloudflare Worker. Для DNS Worker обращается к публичным
DNS-over-HTTPS резолверам Cloudflare, Google и AdGuard; для HTTP — напрямую к
проверяемому сайту. Обычные успешные локальные проверки в Worker не уходят.
Запросы к Worker ограничены отдельно на клиента и суммарно на процесс, а
время ожидания вычитается из общего бюджета запроса.

## API

| Endpoint | Назначение |
|---|---|
| `GET /health` | Проверка доступности API |
| `GET /api/ip` | IP клиента, версия, reverse DNS, геолокация, ASN |
| `GET /api/geo?ip=` / `?host=` | Геолокация и провайдер; для домена при сбое локального DNS — fallback в Worker |
| `GET /api/dns?host=&type=` | DNS-записи; при сетевой ошибке — fallback в Worker (`source`) |
| `GET /api/captcha` | Одноразовая числовая капча (нужна для каждой третьей проверки порта) |
| `POST /api/port` | Проверка TCP-порта; `host`, `port`, `captcha`, `answer` передаются в JSON-теле (не более 3 проверок в минуту с одного IP) |
| `GET /api/whois?host=` | whois для домена или IP |
| `GET /api/site?host=` | HTTP-статус, сервер, заголовок, время ответа; при сетевой ошибке или 403/451 — fallback в Worker (`source`) |
| `GET /api/headers?host=` | Заголовки HTTP-ответа; при сетевой ошибке или 403/451 — fallback в Worker (`source`) |
| `GET /api/tls?host=&port=` | Данные TLS-сертификата; порт ограничен списком 443, 465, 993, 995, 8443 |
| `GET /api/email?host=&selector=` | MX, SPF, DMARC, DKIM, PTR; при транспортной ошибке DNS — fallback в Worker (`source`) |
| `GET /api/propagation?host=&type=` | Ответы нескольких DNS-резолверов; при транспортном отказе всех локальных — fallback в Worker (`source`) |
| `GET /api/redirect?host=` | Цепочка перенаправлений; при сетевой ошибке или 403/451 первого шага — fallback в Worker (`source`) |
| `GET /api/anonymity` | Пассивные сигналы анонимности для IP клиента |
| `GET /api/anonymity/ports?ip=` | TCP-порты прокси/VPN только для собственного публичного IP |
| `GET /api/anonymity/ping?nonce=` | Двусторонний ping для оценки задержки и jitter |

Ответы — JSON. Для исходящих проверок действуют таймауты, ограничение очереди и лимит частоты запросов. В `/api/dns` поля `nxdomain` и `nodata` различают несуществующий домен и отсутствие записи конкретного типа; для Worker-ответов также сохраняется `source: "worker"`.

Anonymity Check сравнивает IP с публичным Tor bulk exit list, который скачивается с `check.torproject.org` и кэшируется на сервере на один час. После неудачной попытки загрузки повторные попытки не предпринимаются в течение двух минут (negative cache), поэтому недоступный внешний сервис не тормозит каждый запрос `/api/anonymity`. Если список недоступен, проверка Tor возвращает `unknown`, а не «не Tor». Необязательный STUN-тест WebRTC обращается к публичному STUN-серверу Google только после явного согласия; по умолчанию собираются только локальные ICE-кандидаты. Активная проверка портов принимает только IP самого посетителя.

## Безопасность сетевых проверок

`/api/port`, `/api/site`, `/api/headers`, `/api/tls`, `/api/redirect` и `/api/anonymity/ports` инициируют соединения по запросу посетителя, поэтому бэкенд защищён от SSRF:

- принимаются только корректные доменные имена и публичные IP;
- блокируются loopback, приватные сети (RFC 1918), link-local, CGNAT, multicast, Teredo, 6to4, NAT64, IPv4-mapped/-compatible и другие непубличные диапазоны;
- проверяются все IP, полученные через DNS, а не только имя хоста;
- в цепочке редиректов каждая точка проверяется отдельно;
- небезопасные схемы отбрасываются;
- TLS проверяется штатно, кроме `/api/tls`, который намеренно показывает просроченные и самоподписанные сертификаты;
- `/api/tls` принимает только порты из списка 443, 465, 993, 995, 8443, поэтому через него нельзя сканировать произвольные TCP-порты;
- `/api/dns` и `/api/propagation` возвращают HTTP 400 на неподдерживаемый тип записи вместо молчаливой подмены на A;
- `/api/anonymity/ports` дополнительно разрешает проверку только того IP, с которого пришёл запрос; сканировать произвольные адреса через него нельзя;
- действуют таймауты и rate limiting; у исходящих HTTP-запросов есть общий дедлайн и лимит размера тела, после которого сокет закрывается, — слоу-сервер не может удерживать слот лимитера;
- каждая третья проверка `/api/port` требует одноразовую капчу: ответ хранится только на сервере, привязан к IP, живёт 5 минут и не может быть использован повторно;
- `/api/port` принимает параметры только через POST и JSON-тело, поэтому ответ и идентификатор капчи не попадают в URL и access-логи.

IP посетителя определяется по `X-Real-IP`, который выставляет nginx. В продакшене цепочка выглядит так: `Cloudflare → Caddy → nginx → API`. nginx доверяет `CF-Connecting-IP` только от диапазонов Cloudflare и локальных прокси. Список диапазонов Cloudflare вынесен в `cloudflare-ips.conf` и автоматически обновляется при деплое (`scripts/update-cloudflare-ips.sh`).

> **Важно: origin должен быть закрыт от прямых подключений.** Если к Caddy можно обратиться напрямую, в обход Cloudflare, клиент может сам задать `CF-Connecting-IP`. nginx доверяет этому заголовку (Caddy для него — локальный прокси), поэтому такой клиент подменяет свой IP и обходит rate limit, а также ограничение «только свой IP» в `/api/anonymity/ports`. Полностью это лечится на уровне инфраструктуры: закройте origin файрволом для всех, кроме [диапазонов Cloudflare](https://www.cloudflare.com/ips/), или включите Cloudflare Authenticated Origin Pulls. Дополнительно настройте Caddy так, чтобы он читал реальный IP из `CF-Connecting-IP` только для доверенных источников — пример в `deploy/Caddyfile.example`; в этом случае nginx нужно переключить на `real_ip_header X-Forwarded-For` (см. комментарий в примере).

## GeoIP

Геолокация и ASN определяются локально по базам MaxMind GeoLite2 — без сторонних геосервисов.

- Базы лежат в `data/geoip/` и не коммитятся.
- Путь задаётся через `GEOIP_DIR`.
- API автоматически подхватывает обновлённые `.mmdb` без перезапуска.
- MaxMind требует обновлять GeoLite2 не реже одного раза в 30 дней.
- Сервис `geoip-updater` обновляет базы каждые 24 часа.

> This product includes GeoLite2 data created by MaxMind, available from https://www.maxmind.com.

## SEO

У всех публичных страниц есть:

- `<link rel="canonical">`;
- Open Graph (`og:title`, `og:description`, `og:url`, `og:image`);
- Twitter Card;
- общий `site/sitemap.xml`, включённый в `robots.txt`.

При добавлении страницы обновите `sitemap.xml` и используйте блок метатегов из `site/tools/_template.html`.

## Разработка

### Добавить инструмент

1. Скопируйте `site/tools/_template.html` в нужную категорию.
2. Заполните `<title>`, `description`, `canonical` и Open Graph.
3. Используйте общий CSS и существующие компоненты.
4. Добавьте карточку инструмента в `site/index.html`.
5. Проверьте мобильные размеры, клавиатурную навигацию и обработку ошибок.
6. Добавьте URL в `site/sitemap.xml`.

### Стиль кода

- ES6+, без jQuery и тяжёлых зависимостей.
- Чистые функции для вычислений, понятные сообщения об ошибках.
- Семантический HTML и ARIA-атрибуты там, где это нужно.
- Цвета и отступы — через CSS-переменные.

### Тесты и pre-push

```bash
npm test          # быстрые локальные проверки
npm run test:live # проверка опубликованного сайта и og-image.png
npm run hooks:install
```

`npm run hooks:install` включает локальный Git-хук `.githooks/pre-push`, который автоматически запускает `npm test` перед каждым `git push`. Тесты проверяют Subnet Calculator (`/0`, `/24`, `/31`, `/32`, режим маски), Password Generator (обычный, распространённый и длинный пароль), Prime Checker (0, 1, 2, 97, 561, большие простые и составные числа), canonical/Open Graph, sitemap и параметры `og-image.png`.

`npm run test:live` обращается к `https://orbitnet.ru`, проверяет доступность всех canonical URL и `og-image.png`. Он запускается в CI после деплоя и требует сети.

Тест backend-эвристик в `tests/anonymity.test.js` подключает `backend/server.js`, поэтому ему нужны зависимости бэкенда. В CI перед тестами выполняется `npm ci --prefix backend`; локально выполните ту же команду, иначе этот тест будет пропущен.

### Git

```bash
git checkout -b feature/tool-name
git commit -m "feat: add Tool Name"
git push origin feature/tool-name
```

Перед PR стоит проверить страницу в браузере и убедиться, что инструмент не ломает существующие стили.

## Планы

Ближайшие задачи и технический долг - в [ROADMAP.md](ROADMAP.md). Структура и правила разработки - в [STRUCTURE.md](STRUCTURE.md).

## Лицензия

MIT - см. [LICENSE](LICENSE).

## Контакты

- Сайт: [orbitnet.ru](https://orbitnet.ru)
- Issues: [github.com/petrederd/orbitnet/issues](https://github.com/petrederd/orbitnet/issues)
- Discussions: [github.com/petrederd/orbitnet/discussions](https://github.com/petrederd/orbitnet/discussions)

---

**OrbitNet** - open source. No ads. No tracking.
