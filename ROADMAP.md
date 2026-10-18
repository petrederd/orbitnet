# OrbitNet — Roadmap

> **Дорожная карта проекта**: планирование развития коллекции веб-инструментов

## 📋 Текущий статус

| Параметр | Значение |
|----------|----------|
| **Версия** | 0.3.0 (октябрь 2026) |
| **Статус** | Активная разработка |
| **Инструментов готово** | 31 |
| **Реализовано** | Главная страница (тёмная тема), 31 инструмент, Node.js API-бэкенд |

---

## 🗺️ Фазы разработки

### Фаза 0: Основа ✓ (завершена)
- [x] Создание дизайн-системы и UI компонентов
- [x] Разработка главной страницы
- [x] Настройка Docker-окружения
- [x] GitHub Actions для автодеплоя
- [x] Модульная структура проекта (HTML/CSS/JS)

### Фаза 1: Первые инструменты ✓ (завершена)
**Статус**: 31 инструмент готов и работает

#### ✓ Базовые инструменты
- [x] **IPv4 Subnet Calculator**, **JSON Formatter**, **IP Lookup**, **Ohm's Law**, **NE555 Timer**
- [x] **Base64**, **UUID Generator**, **Quadratic Solver**, **Percentage**, **Unit Converter**

#### ✓ Сетевые инструменты (через API-бэкенд и клиентские)
- [x] **DNS Lookup**, **Port Checker**, **IP & Domain Info**, **Site Info**
- [x] **CIDR / Netmask Converter**, **IP / Binary Converter**, **MAC Address Converter**, **Reverse IP Lookup**

#### ✓ Developer
- [x] **Password Generator**, **Hash Generator**, **Timestamp Converter**, **Regex Tester**, **Color Converter**

#### ✓ Math
- [x] **Number Base Converter**, **Scientific Notation**, **Statistics Calculator**, **Prime Checker**

#### ✓ Text
- [x] **Case Converter**, **Word Counter**, **Text Diff Checker**, **Lorem Ipsum Generator**

### Фаза 2: Электроника и расширение 📅
**Срок**: Ноябрь-декабрь 2026
**Цель**: 40+ инструментов во всех категориях

#### ⚡ Electronics Tools (электроника)
- [x] **Ohm's Law Calculator**
- [x] **NE555 Timer Calculator**
- [ ] Resistor Color Code Calculator
- [ ] LED Resistor Calculator
- [ ] Voltage Divider Calculator
- [ ] Power Supply Calculator

#### 👨‍💻 Developer Tools (инструменты разработчика)
- [ ] Color Picker (полноценный)
- [ ] Cron Expression Helper
- [ ] JWT Decoder
- [ ] URL Encoder / Decoder

#### 🌐 Networking Tools (сетевые инструменты)
- [ ] HTTP Header Checker
- [ ] IPv6 tools
- [ ] Whois for IP blocks

#### 🧮 Math & Science (математика)
- [ ] Binary/Hex/Decimal (расширенный)
- [ ] GCD / LCM Calculator

#### 📝 Text & Data (текст и данные)
- [ ] Markdown Preview
- [ ] Slug Generator

### Фаза 3: Продвинутые возможности 🎨
**Срок**: Q1 2027

- [ ] Темная/светлая тема (переключатель)
- [ ] Сохранение настроек в LocalStorage
- [ ] История использования инструментов
- [ ] Экспорт результатов (JSON, CSV, TXT)
- [ ] PWA поддержка (работа офлайн)
- [ ] Мультиязычность (RU/EN)
- [ ] API документация для инструментов

### Фаза 4: Сообщество и масштабирование 🚀
**Срок**: Q2-Q3 2027

- [ ] Система плагинов для добавления инструментов
- [ ] Возможность встраивания инструментов на сторонние сайты
- [ ] Сборка статистики использования (анонимная, опционально)
- [ ] Форум или секция обсуждений
- [ ] Видео-туториалы для сложных инструментов
- [ ] Интеграция с GitHub для community-contributions

---

## 🏗️ Архитектура проекта

```
orbitnet/
├── site/                          # Frontend приложение
│   ├── index.html                 # Главная страница
│   ├── assets/
│   │   ├── css/
│   │   │   └── style.css         # Основные стили (тёмная тема)
│   │   └── js/
│   │       └── main.js           # Главная логика
│   ├── icons/
│   │   └── favicon.svg           # Иконка проекта
│   └── tools/                     # Инструменты
│       ├── networks/              # Сетевые инструменты
│       │   ├── subnet-calculator.html
│       │   ├── ip-lookup.html
│       │   ├── dns-lookup.html
│       │   ├── port-checker.html
│       │   ├── ip-info.html
│       │   ├── site-info.html
│       │   ├── cidr-netmask.html
│       │   ├── ip-binary-converter.html
│       │   ├── mac-converter.html
│       │   └── reverse-ip.html
│       ├── developer/             # Инструменты разработчика
│       │   ├── json-formatter.html
│       │   ├── base64.html
│       │   ├── uuid-generator.html
│       │   ├── password-generator.html
│       │   ├── hash-generator.html
│       │   ├── timestamp-converter.html
│       │   ├── regex-tester.html
│       │   └── color-converter.html
│       ├── electricity/           # Электроника
│       │   ├── ohms-law.html
│       │   └── ne555-calculator.html
│       ├── math/                  # Математика
│       │   ├── quadratic-solver.html
│       │   ├── percentage-calculator.html
│       │   ├── unit-converter.html
│       │   ├── number-base-converter.html
│       │   ├── scientific-notation.html
│       │   ├── statistics-calculator.html
│       │   └── prime-checker.html
│       ├── text/                  # Текст и данные
│       │   ├── case-converter.html
│       │   ├── word-counter.html
│       │   ├── text-diff-checker.html
│       │   └── lorem-ipsum-generator.html
│       └── _template.html         # Шаблон для новых инструментов
├── backend/                       # Node.js API-бэкенд
│   ├── server.js
│   ├── package.json
│   └── Dockerfile
├── nginx.conf                     # nginx: статика + прокси /api/
├── docker-compose.yml             # Docker конфигурация (site + api)
├── .github/
│   └── workflows/
│       └── deploy.yml             # CI/CD pipeline
├── README.md                      # Документация проекта
└── ROADMAP.md                     # Этот файл
```

---

## 🎨 Принципы дизайна

### Визуальный стиль
- **Тёмная тема по умолчанию**
  - Фон: `#16161a`
  - Акцент: `#6ecfa0` (зелёный)
  - Текст: `#e8e8ea`
- **Геометрические формы** и четкие границы
- **Минимализм**: без эмодзи, анимаций и лишних элементов
- **Читаемость**: крупные шрифты, высокая контрастность

### UX принципы
1. **Мгновенная работа**: клиентские инструменты работают в браузере
2. **Нет авторизации**: доступ без регистрации
3. **Приватность**: вычисления локально; сетевые проверки — через собственный бэкенд без сторонних сервисов
4. **Одно-клик копирование**: каждый результат легко копировать
5. **Клавиатурные шорткаты**: `/` для поиска, `Esc` для сброса

### Технические требования
- ✓ Vanilla JavaScript (без фреймворков)
- ✓ Responsive дизайн (mobile-first)
- ✓ Accessibility (ARIA-метки, семантичный HTML)
- ✓ SEO-friendly (meta-теги, структурированные данные)
- ✓ Быстрая загрузка (<100KB для главной страницы)

---

## 📊 Метрики успеха

### Технические метрики
- [ ] Lighthouse Score > 95
- [ ] Время загрузки главной страницы < 2 сек
- [ ] Размер главной страницы < 500KB
- [ ] Поддержка браузеров: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+

### Пользовательские метрики
- [x] 31 работающий инструмент (октябрь 2026)
- [ ] 40+ инструментов к концу 2026
- [ ] Документация для каждого инструмента
- [ ] Примеры использования для всех инструментов
- [ ] 95%+ положительных отзывов

---

## 🤝 Контрибуция

### Как добавить новый инструмент

**1️⃣ Планирование**
- Определите проблему, которую решает инструмент
- Проверьте, нет ли дубликатов в коллекции
- Создайте issue в GitHub с описанием

**2️⃣ Разработка**
- Используйте файл `tools/_template.html` как основу
- Создайте папку в нужной категории: `networks/`, `developer/`, и т.д.
- Следуйте текущей системе цветов и стилей
- Напишите чистый, задокументированный код

**3️⃣ Тестирование**
- Проверьте на мобильных устройствах (375px, 768px, 1024px)
- Валидация входных данных и обработка ошибок
- Accessibility проверка (клавиатурная навигация)
- Lighthouse проверка

**4️⃣ Документация**
- Добавьте инструмент в `index.html` (tool-grid)
- Обновите счетчики категорий
- Добавьте описание в ROADMAP.md

---

## 🎯 Долгосрочное видение

**OrbitNet** должен стать:
- 📚 **Справочником** для инженеров и разработчиков
- 🎓 **Образовательным ресурсом** с объяснениями формул и концепций
- ⚡ **Повседневным инструментом** для быстрых расчётов
- 💎 **Open-source примером** качественного кода

### 💪 Ценности проекта
1. **Прозрачность** — весь код открыт и доступен
2. **Приватность** — вычисления не покидают браузер, а сетевые запросы идут через собственный бэкенд без сторонних сервисов
3. **Качество** — каждый инструмент тщательно проверен
4. **Простота** — минимум зависимостей, чистый JavaScript
5. **Доступность** — бесплатно, без рекламы, без трекинга

---

## ⚙️ Заметки

### Технический долг
- Рассмотреть Vite для оптимизации бундла
- Добавить E2E тесты (Cypress/Playwright)
- Настроить линтеры (ESLint, Stylelint, Prettier)
- Автоматическое обновление счетчиков инструментов

### Идеи для будущего
- 🎥 Интерактивные туториалы для каждого инструмента
- 📱 Мобильное приложение на React Native
- 🔌 Браузерное расширение для быстрого доступа
- 💾 Экспорт набора инструментов для офлайн использования
- 🌍 Интеграция с npm для CLI версии
- 📈 Анонимная аналитика использования (Plausible, Umami)

---

## 📝 Процесс разработки

### Git Workflow
```bash
# Новый инструмент или фича
git checkout -b feature/tool-name

# Commit чистого кода
git commit -m "feat: add Tool Name instrument"

# PR на review перед мержем в main
git push origin feature/tool-name
```

### Стиль кода
- **HTML**: Семантичный, WCAG 2.1 AA compliant
- **CSS**: Mobile-first, CSS переменные для тем
- **JavaScript**: ES6+, чистые функции, комментарии для сложной логики

---

**Последнее обновление**: 18 октября 2026  
**Автор**: Petrederd  
**Лицензия**: MIT
