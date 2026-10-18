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
│       │   └── site-info.html               Готов
│       │
│       ├── developer/             #  Инструменты разработчика
│       │   ├── json-formatter.html          Готов
│       │   ├── base64.html                  Готов
│       │   ├── uuid-generator.html          Готов
│       │   └── password-generator.html      Готов
│       │
│       ├── electricity/           # Электроника
│       │   ├── ohms-law.html                Готов
│       │   └── ne555-calculator.html        Готов
│       │
│       ├── math/                  # Математика
│       │   ├── quadratic-solver.html        Готов
│       │   ├── percentage-calculator.html   Готов
│       │   └── unit-converter.html          Готов
│       │
│       └── text/                  # Текст и данные
│           ├── case-converter.html          Запланирован
│           └── word-counter.html            Запланирован
│
├── backend/                       # Node.js API-бэкенд (без внешних зависимостей)
│   ├── server.js                  # HTTP-сервер: /api/ip, /api/dns, /api/port, /api/whois, /api/site
│   ├── package.json
│   └── Dockerfile                 # node:20-alpine
│
├── nginx.conf                     # Раздача статики + проксирование /api/ на backend
├── docker-compose.yml             # Docker конфигурация (site + api)
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

- **IP Lookup** (`ip-lookup.html`) — публичный IP клиента и reverse DNS (через `/api/ip`)
- **DNS Lookup** (`dns-lookup.html`) — записи A, AAAA, MX, TXT, NS, CNAME, SOA, CAA (через `/api/dns`)
- **Port Checker** (`port-checker.html`) — проверка TCP-порта (через `/api/port`)
- **IP & Domain Info** (`ip-info.html`) — DNS, reverse DNS и whois (через `/api/dns`, `/api/whois`)
- **Site Info** (`site-info.html`) — IP, HTTP-статус, сервер, заголовок, время отклика (через `/api/site`)

---

### 7. Инструменты разработчика (дополнительно)
**Статус**: Готовы
**Пути**: `site/tools/developer/*.html`

- **Base64 Encoder/Decoder** (`base64.html`) — клиентское кодирование/декодирование
- **UUID Generator** (`uuid-generator.html`) — генерация UUID
- **Password Generator** (`password-generator.html`) — генерация паролей и оценка стойкости (энтропия, время подбора); полностью клиентский

---

### 8. API-бэкенд (`backend/server.js`)
**Статус**: Готов

**Возможности**:
- HTTP-сервер только на встроенных модулях Node (`http`, `dns`, `net`, `https`)
- Эндпоинты: `/health`, `/api/ip`, `/api/dns`, `/api/port`, `/api/whois`, `/api/site`
- Валидация хостов и портов, таймауты, ограничение размера ответа whois
- CORS, `Cache-Control: no-store`
- Без внешних зависимостей и сторонних сервисов

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
docker-compose up -d
```
- `orbitnet-site`: `nginx:alpine`, монтирует `./site` read-only и `./nginx.conf`
- `orbitnet-api`: `backend/Dockerfile` (node:20-alpine), слушает порт 3000
- nginx проксирует `/api/` на `http://orbitnet-api:3000/api/`
- Оба контейнера в сети `caddy_net` (external)
- Сайт доступен на `localhost:8081`

### GitHub Actions
**Файл**: `.github/workflows/deploy.yml`

**Триггер**: Push в `main` ветку

**Процесс**:
1. SSH подключение к серверу
2. `git pull origin main`
3. `docker compose up -d --force-recreate`

**Секреты** (нужно настроить в GitHub):
- `SERVER_HOST`
- `SERVER_USER`
- `SERVER_SSH_KEY`

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
HTML:  ~2200 строк (главная + 15 инструментов + шаблон)
CSS:   ~600 строк  (темная тема, компоненты)
JS:    ~900 строк  (главная + инструменты)
Node:  ~300 строк  (бэкенд)
───────────────────
Всего: ~4000 строк кода
```

### Готовность инструментов
-  **15 готовых** (6 networks, 4 developer, 2 electricity, 3 math)
-  **Запланированы**: text-инструменты, hash generator, regex tester и др.
-  **Цель**: 20+ к концу 2026 года

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

**Последнее обновление**: 18 октября 2026
**Автор**: PetrederdS
