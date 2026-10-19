# OrbitNet — Структура проекта

> Документация по организации кодовой базы

**Дата**: 17 октября 2026
**Версия**: 0.1.0

---

## Структура каталогов

```
orbitnet/
├── .git/                          # Git репозиторий
├── .github/
│   └── workflows/
│       └── deploy.yml             # CI/CD автодеплой на сервер
│
├── site/                          # Frontend приложение (публичная директория)
│   ├── index.html                 # Главная страница
│   │
│   ├── assets/                    # Статические ресурсы
│   │   ├── css/
│   │   │   └── style.css         # Общие стили (темная тема, компоненты)
│   │   └── js/
│   │       └── main.js           # Логика главной страницы (фильтры, поиск)
│   │
│   └── tools/                     # Коллекция инструментов
│       ├── _template.html         # Шаблон для новых инструментов
│       │
│       ├── networks/              # Сетевые инструменты
│       │   ├── subnet-calculator.html       Готов
│       │   ├── ip-lookup.html               Готов
│       │   ├── dns-lookup.html              Готов
│       │   ├── port-checker.html            Готов
│       │   ├── ip-info.html                 Готов
│       │   ├── site-info.html               Готов
│       │   ├── cidr-netmask.html            Готов
│       │   ├── ip-binary-converter.html     Готов
│       │   ├── mac-converter.html           Готов
│       │   └── reverse-ip.html              Готов
│       │
│       ├── developer/             #  Инструменты разработчика
│       │   ├── json-formatter.html          Готов
│       │   ├── base64.html                  Готов
│       │   ├── uuid-generator.html          Готов
│       │   ├── password-generator.html      Готов
│       │   ├── hash-generator.html          Готов
│       │   ├── timestamp-converter.html     Готов
│       │   ├── regex-tester.html            Готов
│       │   └── color-converter.html         Готов
│       │
│       ├── electricity/           # Электроника
│       │   ├── ohms-law.html                Готов
│       │   └── ne555-calculator.html        Готов
│       │
│       ├── math/                  # Математика
│       │   ├── quadratic-solver.html        Готов
│       │   ├── percentage-calculator.html   Готов
│       │   ├── unit-converter.html          Готов
│       │   ├── number-base-converter.html   Готов
│       │   ├── scientific-notation.html     Готов
│       │   ├── statistics-calculator.html   Готов
│       │   └── prime-checker.html           Готов
│       │
│       └── text/                  # Текст и данные
│           ├── case-converter.html          Готов
│           ├── word-counter.html            Готов
│           ├── text-diff-checker.html       Готов
│           └── lorem-ipsum-generator.html   Готов
│
├── backend/                       # Node.js API-бэкенд (зависимость только maxmind)
│   ├── server.js                  # HTTP-сервер: 12 эндпоинтов (ip, geo, dns, port, whois, site, headers, tls, email, propagation, redirect, health)
│   ├── package.json
│   └── Dockerfile                 # node:20-alpine
│
├── data/geoip/                    # GeoLite2 базы (не в git)
│   ├── GeoLite2-City.mmdb
│   └── GeoLite2-ASN.mmdb
├── nginx.conf                     # Раздача статики + проксирование /api/ на backend
├── docker-compose.yml             # Docker конфигурация (site + api + geoip-updater)
├── .env.example                   # Шаблон ключей MaxMind
├── README.md                      # Основная документация
├── ROADMAP.md                     # Дорожная карта развития
└── STRUCTURE.md                   # Этот файл
```

---

##  Реализованные компоненты

### 1. Главная страница (`site/index.html`)
**Статус**:  Готова

**Возможности**:
- Hero секция с поиском
- Фильтрация по категориям (сети, электроника, разработка, математика, текст)
- Карточки инструментов с живым поиском
- Сортировка (Featured, A-Z, Category)
- Адаптивный дизайн (мобильные, планшеты, десктоп)
- Клавиатурные шорткаты (`/` для поиска, `Esc` для сброса)

**Технологии**: HTML5, Vanilla JS, CSS Grid

---

### 2. Общие стили (`site/assets/css/style.css`)
**Статус**:  Готовы

**Возможности**:
- Темная тема по умолчанию
- CSS переменные для кастомизации
- Компоненты: карточки, кнопки, формы, панели результатов
- Responsive breakpoints (850px, 580px)
- Accessibility (focus states, semantic HTML)

**Цветовая схема**:
```css
--paper: #16161a      /* Фон */
--paper-2: #1e1e24    /* Вторичный фон */
--ink: #e8e8ea        /* Текст */
--muted: #9a9aa2      /* Приглушённый текст */
--accent: #6ecfa0     /* Акцент (зелёный) */
--accent-dim: #14382a /* Приглушённый акцент */
--line: #2c2c33       /* Границы */
--card: #1c1c21       /* Карточки */
--radius: 8px         /* Радиус скругления */
```

---

### 3. Главная логика (`site/assets/js/main.js`)
**Статус**:  Готова

**Функции**:
- `update()` — обновление списка инструментов по фильтрам/поиску
- Обработка фильтров категорий
- Сортировка инструментов (Featured, A-Z, Category)
- Клавиатурные шорткаты
- Динамический счетчик результатов

---

### 4. IPv4 Subnet Calculator
**Статус**:  Готов
**Путь**: `site/tools/networks/subnet-calculator.html`

**Возможности**:
- Расчет сетевого адреса
- Broadcast адрес
- Первый/последний используемый хост
- Количество хостов (всего и используемых)
- Конвертация CIDR ↔ Subnet Mask
- Валидация входных данных

**Алгоритмы**:
- Побитовые операции для расчета сетей
- Поддержка всех CIDR префиксов (/0 - /32)
- Обработка edge cases (/31, /32)

---

### 5. JSON Formatter & Validator
**Статус**:  Готов
**Путь**: `site/tools/developer/json-formatter.html`

**Возможности**:
- Валидация JSON синтаксиса
- Форматирование с настройкой отступов (2/4 spaces, tab)
- Минификация JSON
- Копирование в буфер обмена
- Скачивание файла
- Статистика (строки, символы, байты, объекты, массивы)
- Auto-format при вводе

**Безопасность**: Вся обработка в браузере, данные не отправляются на сервер

---

### 6. Сетевые инструменты (Networks)
**Статус**: Готовы
**Пути**: `site/tools/networks/*.html`

- **IPv4 Subnet Calculator** (`subnet-calculator.html`) — подсети, маски, хосты (клиентский)
- **IP Lookup** (`ip-lookup.html`) — публичный IP, геолокация, провайдер и reverse DNS (через `/api/ip`)
- **DNS Lookup** (`dns-lookup.html`) — записи A, AAAA, MX, TXT, NS, CNAME, SOA, CAA (через `/api/dns`)
- **Port Checker** (`port-checker.html`) — проверка TCP-порта (через `/api/port`)
- **IP & Domain Info** (`ip-info.html`) — DNS, reverse DNS, whois, геолокация и провайдер (через `/api/dns`, `/api/whois`, `/api/geo`)
- **Site Info** (`site-info.html`) — IP, HTTP-статус, сервер, заголовок, время отклика (через `/api/site`)
- **CIDR / Netmask Converter** (`cidr-netmask.html`) — prefix ↔ маска ↔ wildcard, таблица префиксов (клиентский)
- **IP / Binary Converter** (`ip-binary-converter.html`) — IPv4 ↔ binary/decimal/hex (клиентский)
- **MAC Address Converter** (`mac-converter.html`) — форматы MAC, I/G и U/L биты, OUI (клиентский)
- **Reverse IP Lookup** (`reverse-ip.html`) — PTR-запись для IP/домена (через `/api/dns?type=PTR`)
- **SSL/TLS Checker** (`ssl-checker.html`) — срок, издатель, SAN, цепочка, совпадение имени (через `/api/tls`)
- **HTTP Headers Inspector** (`http-headers.html`) — заголовки ответа и предупреждения по security-заголовкам (через `/api/headers`)
- **Email DNS Checker** (`email-dns-checker.html`) — MX, SPF, DMARC, DKIM и PTR (через `/api/email`)
- **DNS Propagation Checker** (`dns-propagation.html`) — ответы нескольких публичных резолверов (через `/api/propagation`)
- **Redirect Checker** (`redirect-checker.html`) — цепочка перенаправлений и конечный адрес (через `/api/redirect`)
- **Website Health Check** (`website-health.html`) — объединённый отчёт DNS/TLS/доступность/заголовки (через `/api/dns`, `/api/site`, `/api/tls`, `/api/headers`)
- **Network Diagnostics** (`network-diagnostics.html`) — прямой/обратный DNS и TCP-порт (через `/api/ip`, `/api/dns`, `/api/port`)
- **Email Deliverability Check** (`email-deliverability.html`) — разбор почтовых DNS-настроек с пояснениями (через `/api/email`)

---

### 7. Инструменты разработчика (дополнительно)
**Статус**: Готовы
**Пути**: `site/tools/developer/*.html`

- **Base64 Encoder/Decoder** (`base64.html`) — клиентское кодирование/декодирование
- **UUID Generator** (`uuid-generator.html`) — генерация UUID
- **Password Generator** (`password-generator.html`) — генерация паролей и оценка стойкости (энтропия, время подбора)
- **Hash Generator** (`hash-generator.html`) — MD5 (собственная реализация) + SHA-1/256/384/512 (Web Crypto)
- **Timestamp Converter** (`timestamp-converter.html`) — Unix ↔ ISO 8601 ↔ локальное время, live-часы
- **Regex Tester** (`regex-tester.html`) — тест регулярок с флагами, подсветкой и группами
- **Color Converter** (`color-converter.html`) — HEX ↔ RGB ↔ HSL
- **JWT Decoder** (`jwt-decoder.html`) — разбор header/payload/claims JWT локально в браузере (клиентский, без отправки токена)

---

### 7b. Математика и текст (дополнительно)
**Статус**: Готовы

- Math: `number-base-converter.html`, `scientific-notation.html`, `statistics-calculator.html`, `prime-checker.html`
- Text: `case-converter.html`, `word-counter.html`, `text-diff-checker.html`, `lorem-ipsum-generator.html`

---

### 8. API-бэкенд (`backend/server.js`)
**Статус**: Готов

**Возможности**:
- HTTP-сервер на встроенных модулях Node (`http`, `https`, `tls`, `dns`, `net`) + `maxmind` для GeoLite2
- Эндпоинты: `/health`, `/api/ip` (IP, reverse DNS, гео, провайдер), `/api/geo` (гео и ASN для IP/домена), `/api/dns` (A, AAAA, MX, TXT, NS, CNAME, SOA, CAA, PTR для IP), `/api/port`, `/api/whois`, `/api/site`, `/api/headers`, `/api/tls`, `/api/email`, `/api/propagation`, `/api/redirect`
- GeoIP: чтение `GeoLite2-City.mmdb`/`GeoLite2-ASN.mmdb` из `GEOIP_DIR`; ленивая загрузка и перечитывание при изменении mtime (раз в `GEO_RECHECK_MS`, по умолчанию 60 000 мс) — обновление баз не требует перезапуска
- Защита от SSRF: разрешены только валидные домены и публичные IP; отклоняются loopback, RFC 1918, link-local, CGNAT, multicast, Teredo, 6to4, NAT64, IPv4-mapped/-compatible и другие непубличные диапазоны IPv4/IPv6 через `net.BlockList`; проверяются все адреса из DNS; соединение идёт на проверенный IP (защита от DNS-rebinding); в `/api/redirect` каждый переход проверяется отдельно и приватный адрес прерывает цепочку
- Редиректы в `/api/site` и `/api/headers` не следуются, небезопасные схемы отбрасываются
- TLS-сертификаты проверяются штатно (без `rejectUnauthorized: false`) для `/api/site` и `/api/headers`; `/api/tls` намеренно подключается без проверки, чтобы показать просроченные/самоподписанные сертификаты, и явно сообщает результат (`authorized`, `authorizationError`, совпадение имени, срок)
- Таймауты (включая DNS-запросы `/api/email`), ограничение числа одновременных исходящих проверок с ограниченной очередью (503) и лимит частоты запросов (429), включая `/api/ip`; `MAX_CONCURRENT`/`MAX_QUEUE` валидируются при старте
- Строгая валидация порта (1-65535, только цифры) и DKIM-селектора
- `/api/propagation` опрашивает фиксированный список публичных резолверов (не пользовательский)
- IPv4-mapped IPv6 нормализуется в IPv4 в любой нотации (защита от обхода блок-листа)
- Определение IP клиента по `X-Real-IP` (выставляет nginx); в продакшене цепочка `Cloudflare → Caddy → nginx`, реальный IP берётся из `CF-Connecting-IP` (`real_ip_header`) с доверием диапазонам Cloudflare и локальным прокси; `X-Forwarded-For` — только запасной вариант
- Валидация хостов, ограничение размера ответа whois
- CORS, `Cache-Control: no-store`
- Без обращений к сторонним сервисам: GeoIP считается локально по базам MaxMind GeoLite2

---

### 9. Шаблон инструмента (`site/tools/_template.html`)
**Статус**: Готов

**Использование**: Копировать и адаптировать для новых инструментов

**Включает**:
- Готовую разметку (header, breadcrumbs, panels)
- Стили для форм, результатов, ошибок
- JavaScript скелет с функциями:
  - `calculate()` — основная логика
  - `displayResults()` — отображение результатов
  - `showError()` — обработка ошибок
  - `reset()` — сброс состояния

---

##  Deployment

### Docker
```bash
docker compose up -d
# с автообновлением GeoLite2 (нужны ключи MaxMind в .env):
docker compose --profile geoip up -d
```
- `orbitnet-site`: `nginx:alpine`, монтирует `./site` read-only и `./nginx.conf`
- `orbitnet-api`: `backend/Dockerfile` (node:20-alpine), слушает порт 3000, монтирует `./data/geoip` в `/data/geoip:ro`
- `geoip-updater`: `ghcr.io/maxmind/geoipupdate` (профиль `geoip`), обновляет `GeoLite2-City`/`GeoLite2-ASN` каждые 24 ч в `./data/geoip`
- nginx проксирует `/api/` на `http://orbitnet-api:3000/api/`, выставляет `X-Real-IP` и базовые защитные заголовки
- Оба контейнера в дефолтной сети проекта (внешняя `caddy_net` не навязывается)
- Сайт доступен на `localhost:8081`

### GitHub Actions
**Файл**: `.github/workflows/deploy.yml`

**Триггер**: Push в `main` ветку

**Процесс**:
1. SSH подключение к серверу
2. `git pull origin main`
3. `docker compose up -d --force-recreate`
4. Если в серверном `.env` есть непустые `MAXMIND_ACCOUNT_ID`/`MAXMIND_LICENSE_KEY` — `docker compose --profile geoip up -d` (обновление GeoLite2), иначе шаг пропускается

**Секреты** (нужно настроить в GitHub):
- `SERVER_HOST`
- `SERVER_USER`
- `SERVER_SSH_KEY`

**Секреты на сервере** (не в git, создаются вручную рядом с `docker-compose.yml`):
- `.env` с `MAXMIND_ACCOUNT_ID` и `MAXMIND_LICENSE_KEY` (для `geoip-updater`)

---

## 🛠️ Как добавить новый инструмент

### Шаг 1: Копировать шаблон
```bash
cp site/tools/_template.html site/tools/[category]/[tool-name].html
```

### Шаг 2: Настроить метаданные
- Обновить `<title>`, `<meta name="description">`
- Изменить breadcrumb path
- Добавить название инструмента в `<h1>`

### Шаг 3: Создать UI
- Добавить поля ввода в "Input" панель
- Настроить кнопки (Calculate, Reset, Copy, etc.)
- Определить структуру результатов

### Шаг 4: Реализовать логику
- Написать функцию `calculate()`
- Добавить валидацию входных данных
- Реализовать основной алгоритм
- Отобразить результаты через `displayResults()`

### Шаг 5: Добавить на главную
В `site/index.html` добавить карточку:
```html
<article class="tool-card" data-category="[category]" data-name="[Tool Name]" data-order="[number]">
  <div class="tool-top">
    <span class="tool-icon">[icon]</span>
    <span class="pill">[Category]</span>
  </div>
  <h3>[Tool Name]</h3>
  <p>[Description]</p>
  <div class="tool-bottom">
    <span class="status-label">Ready</span>
    <a class="open" href="tools/[category]/[tool-name].html">Open</a>
  </div>
</article>
```

### Шаг 6: Обновить счетчики
- Обновить счетчик категории в фильтрах
- Обновить общий счетчик инструментов

---

## 📊 Текущий статус

### Статистика кода (оценка)
```
HTML:  ~6000 строк (главная + 40 инструментов + шаблон)
CSS:   ~600 строк  (темная тема, компоненты)
JS:    ~3000 строк (главная + инструменты)
Node:  ~600 строк  (бэкенд)
───────────────────
Всего: ~10200 строк кода
```

### Готовность инструментов
-  **40 готовых** (18 networks, 9 developer, 2 electricity, 7 math, 4 text)
-  **Запланированы**: electronics-инструменты (resistor, LED, voltage divider) и др.
-  **Цель**: 40+ к концу 2026 года (достигнута)

### Производительность
- Главная страница: ~100KB (HTML + CSS + JS)
- Инструменты: ~50-80KB каждый
- Время загрузки: <1 секунда
- Lighthouse Score: 95+ (цель)

---

## 🔧 Технические детали

### Принципы архитектуры
1. **No Build Step** — прямой запуск из браузера
2. **Vanilla JS** — без фреймворков и зависимостей
3. **Client-side first** — большинство вычислений в браузере; сетевые проверки (DNS, порты, whois, IP) — через собственный бэкенд без сторонних сервисов
4. **Progressive Enhancement** — работает без JS (статическая версия)
5. **Mobile First** — адаптивность из коробки

### Стандарты кода
- **HTML**: Semantic HTML5, ARIA labels
- **CSS**: BEM-like naming, CSS Grid/Flexbox
- **JavaScript**: ES6+, strict mode, JSDoc комментарии
- **Accessibility**: WCAG 2.1 Level AA

### Браузерная поддержка
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

---

## 📚 Полезные ссылки

- [README.md](README.md) — основная документация
- [ROADMAP.md](ROADMAP.md) — план развития
- [Главная страница](site/index.html) — точка входа
- [Шаблон инструмента](site/tools/_template.html) — для разработки

---

## 🔄 История изменений

### v0.5.0 (19 октября 2026)
- GeoIP через MaxMind GeoLite2: новый эндпоинт `/api/geo` и расширенный `/api/ip` (локация, часовой пояс, координаты, провайдер/ASN); базы читаются локально из `data/geoip` с горячим перечитыванием по mtime
- Главная: IP-виджет показывает местоположение, часовой пояс и провайдера
- `ip-lookup` и `ip-info`: вывод гео-данных и расширенное описание полей с атрибуцией MaxMind
- Автообновление баз: сервис `geoip-updater` в `docker-compose.yml` (профиль `geoip`, каждые 24 ч), `.env.example` с ключами MaxMind
- SEO: добавлены `robots.txt` и `sitemap.xml`
- Кроссбраузерность: хардненинг CSS (`color-scheme`, `text-size-adjust`, критический инлайн-стиль), исправлен светлый `theme-color`
- Реальный IP клиента за Cloudflare: nginx читает `CF-Connecting-IP` (`real_ip_header`) и доверяет диапазонам Cloudflare и локальным прокси (Caddy отбрасывает входящий `X-Forwarded-For`)

### v0.4.0 (18 октября 2026)
- Добавлены 9 инструментов: SSL/TLS Checker, HTTP Headers Inspector, Email DNS Checker, DNS Propagation Checker, Redirect Checker, Website Health Check, Network Diagnostics, Email Deliverability Check (Networks) и JWT Decoder (Developer)
- Новые эндпоинты: `/api/headers`, `/api/tls`, `/api/email`, `/api/propagation`, `/api/redirect`; все под SSRF-защитой, таймаутами и rate-limit
- `/api/tls` намеренно подключается без проверки сертификата, чтобы показывать проблемные сертификаты, и явно сообщает результат проверки
- `/api/redirect` проверяет каждую точку перенаправления отдельно (до 10 хопов), приватные адреса прерывают цепочку
- `/api/propagation` опрашивает 7 фиксированных публичных резолверов параллельно
- DNS-запросы `/api/email` ограничены таймаутом
- Главная страница: 40 карточек, счётчики all=40, networks=18, developer=9

### v0.3.3 (18 октября 2026)
- `normalizeIp` схлопывает IPv4-mapped IPv6 в любой нотации (включая полную форму `0:0:0:0:0:ffff:c0a8:0101`)
- `MAX_CONCURRENT`/`MAX_QUEUE` валидируются при старте (положительные целые, иначе выход с ошибкой)
- Rate-limit: удаляются только просроченные записи; при заполнении таблицы новые клиенты отсекаются без сброса всех счётчиков

### v0.3.2 (18 октября 2026)
- SSRF: проверка IPv6 переведена на `net.BlockList` (добавлены Teredo, 6to4, NAT64, IPv4-mapped/-compatible, ORCHID, discard-only и др.; hex-форма IPv4-mapped нормализуется)
- Ограничена очередь исходящих запросов (503 при переполнении), `/api/ip` включён в лимит частоты
- Строгая валидация порта (только цифры, 1-65535); PTR-запросы поддерживают IPv6
- Доверие к IP клиента: nginx через `real_ip` выставляет `X-Real-IP`, который и используется бэкендом
- nginx: базовые защитные заголовки (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`)
- Шаблон инструмента: экранирование вывода и безопасный `showError`
- `reverse-ip` распознаёт IPv6; формулировки о приватности в `ip-lookup` согласованы с README
- GitHub Actions: `appleboy/ssh-action` закреплён по commit SHA

### v0.3.1 (18 октября 2026)
- Безопасность бэкенда: защита от SSRF в `/api/port` и `/api/site` (только публичные адреса, проверка всех DNS-адресов, подключение к проверенному IP), отключены следование редиректам и `rejectUnauthorized: false`
- Добавлены таймауты, ограничение одновременных проверок и лимит частоты запросов
- Исправлено определение IP посетителя по `X-Forwarded-For`
- Экранирование данных в сетевых инструментах (`dns-lookup`, `port-checker`, `site-info`, `ip-info`) — вывод через `textContent`/экранирование
- README: убраны эмодзи, уточнены приватность и лицензия, добавлен раздел о безопасности

### v0.3.0 (18 октября 2026)
- Добавлены 16 инструментов: Text (case, word count, diff, lorem), Math (number base, scientific, statistics, prime), Networks (CIDR/netmask, IP/binary, MAC, reverse IP), Developer (hash, timestamp, regex, color)
- Обновлены главная страница (31 карточка) и счётчики фильтров
- MD5 реализован вручную, остальные хеши — через Web Crypto

### v0.2.0 (18 октября 2026)
- Тёмная чистая тема без эмодзи и анимаций; упрощённая главная страница
- Добавлен Node.js API-бэкенд (`/api/ip`, `/api/dns`, `/api/port`, `/api/whois`, `/api/site`)
- Добавлены инструменты: IP Lookup, DNS Lookup, Port Checker, IP & Domain Info, Site Info, Password Generator
- `nginx.conf` с проксированием `/api/`; `docker-compose` обновлён (site + api)
- IP-виджет на главной и IP Lookup переведены на собственный бэкенд (убран `ipapi.co`)

### v0.1.0 (17 октября 2026)
- Создана модульная структура проекта
- Разделены HTML, CSS, JS
- Реализованы IPv4 Subnet Calculator и JSON Formatter
- Создан шаблон для новых инструментов
- Написана документация (README, ROADMAP, STRUCTURE)

---

**Последнее обновление**: 19 октября 2026
**Автор**: PetrederdS
