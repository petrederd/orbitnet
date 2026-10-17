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
- ✅ **Работа в браузере** — данные обрабатываются локально

## 🚀 Живая демо

🔗 **[orbitnet.ru](https://orbitnet.ru)** (скоро будет доступен)

## 📦 Доступные инструменты

### 🌐 Сетевые инструменты (Networks)
- [x] **IPv4 Subnet Calculator** — расчет подсетей, маски, диапазонов хостов
- [ ] IP to Binary Converter
- [ ] MAC Address Guide
- [ ] CIDR/Netmask Converter

### 💻 Инструменты разработчика (Developer Tools)
- [x] **JSON Formatter & Validator** — форматирование и валидация JSON
- [ ] Base64 Encoder/Decoder
- [ ] UUID Generator
- [ ] Hash Generator (MD5, SHA-1, SHA-256)
- [ ] Regex Tester

### ⚡ Электроника (Electronics)
- [ ] Resistor Color Code Calculator
- [ ] Ohm's Law Calculator
- [ ] LED Resistor Calculator
- [ ] Voltage Divider Calculator

### 🔢 Математика и наука (Math & Science)
- [ ] Unit Converter
- [ ] Scientific Notation Converter
- [ ] Percentage Calculator
- [ ] Binary/Hex/Decimal Converter

### 📝 Текст и данные (Text & Data)
- [ ] Text Case Converter
- [ ] Word Counter
- [ ] Text Diff Checker
- [ ] Lorem Ipsum Generator

## 🏗️ Структура проекта

```
orbitnet/
├── site/                          # Frontend приложение
│   ├── index.html                 # Главная страница
│   ├── assets/
│   │   ├── css/
│   │   │   └── style.css         # Общие стили (темная тема)
│   │   └── js/
│   │       └── main.js           # Главная логика (поиск, фильтры)
│   └── tools/                     # Инструменты
│       ├── networks/              # Сетевые инструменты
│       ├── developer/             # Инструменты разработчика
│       ├── electricity/           # Электроника
│       ├── math/                  # Математика
│       └── text/                  # Текст и данные
├── docker-compose.yml             # Docker для деплоя
├── .github/workflows/
│   └── deploy.yml                 # CI/CD автодеплой
├── README.md                      # Этот файл
└── ROADMAP.md                     # План развития
```

## 🛠️ Технологии

- **Vanilla JavaScript** — без фреймворков, чистый JS
- **Modern CSS** — CSS Grid, Custom Properties, темная тема
- **Semantic HTML5** — доступность и SEO
- **Docker** — контейнеризация для деплоя
- **GitHub Actions** — автоматический деплой

## 🚀 Локальный запуск

### Вариант 1: Прямо из файловой системы
Просто откройте `site/index.html` в браузере. Всё работает без сервера!

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
- Темная тема с оранжевым акцентом (#d46b15)
- Геометрические формы, четкие границы
- Минималистичный подход
- Читаемые шрифты, высокий контраст

### UX принципы
1. Мгновенная работа без загрузки
2. Клиент-сайд обработка (приватность)
3. Кнопки копирования для результатов
4. Клавиатурные шорткаты где уместно
5. Понятные сообщения об ошибках

## 🎯 Дорожная карта

Смотрите подробный план в [ROADMAP.md](ROADMAP.md)

**Ближайшие цели:**
- ✅ Главная страница с дизайн-системой
- ✅ IPv4 Subnet Calculator
- ✅ JSON Formatter & Validator
- 🚧 Base64 Encoder/Decoder
- 🚧 UUID Generator
- 📅 Resistor Color Code Calculator
- 📅 12+ инструментов к концу 2026

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
