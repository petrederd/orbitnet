# OrbitNet

> **Open tools, no noise** — коллекция бесплатных практичных веб-инструментов для сетей, электроники, разработки и математики

[![License: MIT](https://img.shields.io/badge/License-MIT-orange.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-active-success.svg)]()
[![Made with Love](https://img.shields.io/badge/made%20with-❤-red.svg)]()

## 🌟 О проекте

**OrbitNet** — это open-source коллекция полезных веб-инструментов, созданная для специалистов и любознательных людей. Проект построен на простых принципах:

- ✅ **Без рекламы** — никаких баннеров или спонсорских размещений
- ✅ **Без трекинга** — ваши данные не собираются и не отправляются на серверы
- ✅ **Без регистрации** — все инструменты доступны сразу
- ✅ **Open source** — весь код открыт для изучения и улучшения
- ✅ **Приватность** — вычисления выполняются локально, а сетевые проверки (DNS, порты, whois) идут через собственный бэкенд, без сторонних сервисов

## 🚀 Живая демо

🔗 **[orbitnet.ru](https://orbitnet.ru)** (скоро будет доступен)

## 📦 Доступные инструменты

### 🌐 Сетевые инструменты (Networks)
- [x] **IPv4 Subnet Calculator** — расчет подсетей, маски, диапазонов хостов
- [x] **IP Lookup** — ваш публичный IP и reverse DNS (через собственный бэкенд)
- [x] **DNS Lookup** — записи A, AAAA, MX, TXT, NS, CNAME, SOA, CAA
- [x] **Port Checker** — проверка TCP-порта на хосте
- [x] **IP & Domain Info** — DNS-записи, reverse DNS и whois для IP/домена
- [x] **Site Info** — IP, HTTP-статус, сервер, заголовок и время отклика сайта
- [x] **CIDR / Netmask Converter** — конвертация prefix ↔ маска ↔ wildcard
- [x] **IP / Binary Converter** — IPv4 ↔ binary/decimal/hex
- [x] **MAC Address Converter** — форматы MAC, тип адреса и OUI
- [x] **Reverse IP Lookup** — PTR-запись для IP (через бэкенд)

### 💻 Инструменты разработчика (Developer Tools)
- [x] **JSON Formatter & Validator** — форматирование и валидация JSON
- [x] **Base64 Encoder/Decoder**
- [x] **UUID Generator**
- [x] **Password Generator** — генерация паролей и оценка стойкости
- [x] **Hash Generator** — MD5, SHA-1, SHA-256, SHA-384, SHA-512
- [x] **Timestamp Converter** — Unix ↔ ISO 8601 ↔ локальное время
- [x] **Regex Tester** — проверка регулярок с флагами и группами
- [x] **Color Converter** — HEX ↔ RGB ↔ HSL

### ⚡ Электроника (Electronics)
- [x] **Ohm's Law Calculator**
- [x] **NE555 Timer Calculator**
- [ ] Resistor Color Code Calculator
- [ ] LED Resistor Calculator
- [ ] Voltage Divider Calculator

### 🔢 Математика и наука (Math & Science)
- [x] **Quadratic Equation Solver**
- [x] **Percentage Calculator**
- [x] **Unit Converter**
- [x] **Number Base Converter** — binary/octal/decimal/hex
- [x] **Scientific Notation Converter** — scientific и engineering notation
- [x] **Statistics Calculator** — mean, median, mode, variance, quartiles
- [x] **Prime Number Checker** — простота, факторизация, ближайшие простые

### 📝 Текст и данные (Text & Data)
- [x] **Case Converter** — регистр, camelCase, snake_case, kebab-case и др.
- [x] **Word Counter** — слова, символы, время чтения, частые слова
- [x] **Text Diff Checker** — построчное сравнение двух текстов
- [x] **Lorem Ipsum Generator** — placeholder-текст

## 🏗️ Структура проекта

```
orbitnet/
├── site/                          # Frontend приложение (nginx)
│   ├── index.html                 # Главная страница
│   ├── assets/
│   │   ├── css/
│   │   │   └── style.css         # Общие стили (темная тема)
│   │   └── js/
│   │       └── main.js           # Главная логика (поиск, фильтры, IP-виджет)
│   └── tools/                     # Инструменты
│       ├── networks/              # Сетевые инструменты
│       ├── developer/             # Инструменты разработчика
│       ├── electricity/           # Электроника
│       ├── math/                  # Математика
│       └── text/                  # Текст и данные
├── backend/                       # Node.js API (DNS, порты, whois, site info)
│   ├── server.js                  # HTTP-сервер без внешних зависимостей
│   ├── package.json
│   └── Dockerfile
├── nginx.conf                     # Конфиг nginx (статика + прокси /api/)
├── docker-compose.yml             # Docker для деплоя (site + api)
├── .github/workflows/
│   └── deploy.yml                 # CI/CD автодеплой
├── README.md                      # Этот файл
├── STRUCTURE.md                   # Структура проекта
└── ROADMAP.md                     # План развития
```

## 🛠️ Технологии

- **Vanilla JavaScript** — без фреймворков, чистый JS
- **Modern CSS** — CSS Grid, Custom Properties, темная тема
- **Semantic HTML5** — доступность и SEO
- **Node.js** — легкий API-бэкенд только на встроенных модулях (dns, net, http, https)
- **nginx** — раздача статики и проксирование `/api/` на бэкенд
- **Docker** — контейнеризация для деплоя
- **GitHub Actions** — автоматический деплой

## 🔌 API бэкенда

Бэкенд не использует внешних зависимостей и отдаёт JSON:

| Endpoint | Описание |
|----------|----------|
| `GET /health` | проверка доступности |
| `GET /api/ip` | IP клиента, версия и reverse DNS |
| `GET /api/dns?host=&type=` | DNS-записи (A, AAAA, MX, TXT, NS, CNAME, SOA, CAA) |
| `GET /api/port?host=&port=` | проверка TCP-порта |
| `GET /api/whois?host=` | whois-данные для домена или IP |
| `GET /api/site?host=` | HTTP-статус, сервер, заголовок и время отклика сайта |

## 🚀 Локальный запуск

### Вариант 1: Прямо из файловой системы
Просто откройте `site/index.html` в браузере. Инструменты, работающие на клиенте, будут работать сразу. Сетевые инструменты (DNS, порты, whois, site info, IP-виджет) требуют запущенного бэкенда.

### Вариант 2: Локальный веб-сервер (рекомендуется)

**Python:**
```bash
cd site
python3 -m http.server 8000
# Откройте http://localhost:8000
```

**Node.js:**
```bash
npm install -g http-server
cd site
http-server -p 8000
```

**PHP:**
```bash
cd site
php -S localhost:8000
```

### Вариант 2b: Бэкенд (для сетевых инструментов)

```bash
cd backend
node server.js
# API поднимется на http://localhost:3000
```

При запуске через `docker-compose` nginx сам проксирует `/api/` на бэкенд, поэтому отдельный запуск не нужен.

### Вариант 3: Docker

```bash
docker-compose up -d
# Откройте http://localhost:8081
```

## 🤝 Как внести вклад

Мы приветствуем любые улучшения! Вот как можно помочь:

### 1. Сообщить об ошибке (Bug Report)
Создайте [issue](https://github.com/yourusername/orbitnet/issues) с описанием проблемы.

### 2. Предложить новый инструмент
1. Проверьте [ROADMAP.md](ROADMAP.md) — возможно, идея уже запланирована
2. Создайте issue с описанием:
   - Какую проблему решает инструмент?
   - Кто целевая аудитория?
   - Примеры использования

### 3. Добавить код
1. Форкните репозиторий
2. Создайте ветку: `git checkout -b feature/new-tool`
3. Следуйте структуре существующих инструментов:
   - Используйте общий CSS из `assets/css/style.css`
   - Vanilla JavaScript (без зависимостей)
   - Мобильный responsive дизайн
   - Добавьте документацию прямо на странице инструмента
4. Протестируйте на мобильных и десктопе
5. Коммит: `git commit -am 'Add: New Tool Name'`
6. Пуш: `git push origin feature/new-tool`
7. Создайте Pull Request

### Стиль кода
- **JavaScript**: используйте современный ES6+, избегайте jQuery
- **CSS**: следуйте существующим CSS-переменным для цветов
- **HTML**: семантичные теги, ARIA-метки для доступности
- **Комментарии**: документируйте сложную логику

## 📋 Принципы дизайна

### Визуальный стиль
- Тёмная тема с зелёным акцентом (#6ecfa0)
- Геометрические формы, четкие границы
- Минималистичный подход
- Читаемые шрифты, высокий контраст, без эмодзи

### UX принципы
1. Мгновенная работа без загрузки
2. Клиент-сайд обработка (приватность)
3. Кнопки копирования для результатов
4. Клавиатурные шорткаты где уместно
5. Понятные сообщения об ошибках

## 🎯 Дорожная карта

Смотрите подробный план в [ROADMAP.md](ROADMAP.md)

**Ближайшие цели:**
- ✅ Главная страница с дизайн-системой (тёмная тема)
- ✅ Базовая коллекция: Subnet, JSON, Base64, UUID, Password
- ✅ Сетевые: DNS Lookup, Port Checker, IP & Domain Info, Site Info, CIDR/Netmask, IP/Binary, MAC, Reverse IP
- ✅ Developer: Hash Generator, Timestamp Converter, Regex Tester, Color Converter
- ✅ Math: Number Base, Scientific Notation, Statistics, Prime Checker
- ✅ Text: Case Converter, Word Counter, Text Diff, Lorem Ipsum
- ✅ Node.js API-бэкенд
- 📅 Resistor Color Code Calculator
- 📅 40+ инструментов к концу 2026

## 📄 Лицензия

MIT License (планируется) — свободно используйте, модифицируйте и распространяйте.

```
Copyright (c) 2026 OrbitNet Team

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software...
```

## 🌟 Поддержка проекта

Если проект полезен для вас:
- ⭐ Поставьте звезду на GitHub
- 🐦 Расскажите друзьям и коллегам
- 🛠️ Предложите новый инструмент или улучшение
- 💬 Оставьте отзыв в issues

## 📞 Контакты

- **Website**: [orbitnet.ru](https://orbitnet.ru)
- **Issues**: [GitHub Issues](https://github.com/yourusername/orbitnet/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/orbitnet/discussions)

---

**Made with ❤️ by OrbitNet Team**  
*Open source. No ads. No tracking.*
