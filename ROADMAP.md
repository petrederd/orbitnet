# OrbitNet — Roadmap

> Планы развития коллекции веб-инструментов и технической платформы.

**Версия:** 0.4.0
**Обновлено:** 22 октября 2026
**Статус:** активная разработка

## Сейчас

| Параметр | Значение |
|---|---|
| Инструментов | 55 |
| Категорий | 5 (сети, разработка, математика, текст, электроника) |
| Frontend | статические HTML/CSS/JS без сборщика |
| Backend | Node.js API (DNS, TCP, TLS, HTTP, whois, GeoIP) |
| Деплой | Docker Compose + nginx + GitHub Actions |
| SEO | canonical, Open Graph, Twitter Card, sitemap |

### Что сделано

- [x] Главная страница с поиском, фильтрами и сортировкой.
- [x] Тёмная тема и общие UI-компоненты.
- [x] 23 сетевых инструмента.
- [x] 18 инструментов разработчика.
- [x] 7 математических инструментов.
- [x] 5 инструментов для текста.
- [x] 2 калькулятора электроники.
- [x] Node.js API с защитой от SSRF, таймаутами и rate limiting.
- [x] Локальная геолокация и ASN через MaxMind GeoLite2.
- [x] Docker Compose и CI/CD-деплой.
- [x] `robots.txt`, `sitemap.xml`, canonical и Open Graph для всех страниц.
- [x] Исправлен режим маски в Subnet Calculator (unsigned 32-bit).
- [x] Исправлена оценка распространённых паролей в Password Generator.
- [x] Prime Checker: детерминированная проверка до 2^64, вероятностная для больших чисел, лимиты времени и размера ввода.
- [x] Anonymity Check: proxy-заголовки, Tor/хостинг/PTR-сигналы, timezone mismatch, WebRTC и опциональная проверка портов только своего IP.
- [x] Базовые тесты, локальный pre-push hook и live-проверка canonical/og-image.
- [x] Юнит-тесты для timestamp, color, scientific notation, statistics, unit converter, Base64 и regex worker.
- [x] Playwright smoke-тест всех 55 страниц: консольные ошибки, CSP, реальный Web Worker и избранное.
- [x] Axe-проверка ключевых страниц (контраст, ссылки, доступность) без serious/critical нарушений.
- [x] Внутренний `/health` с in-process метриками API (запросы, ошибки, rate limit, источники, внешние вызовы) и минимальный публичный `/api/health`.
- [x] JSON-LD `SoftwareApplication` на всех инструментах, `WebSite` + `SearchAction` + `FAQPage` на главной.
- [x] Избранные инструменты в LocalStorage, фильтр «Favorites» и поиск по `?q=`.
- [x] Подробный раздел о приватности на `about.html`.
- [x] JWT Decoder: локальная проверка HS256/HS384/HS512 и подсветка `exp`/`nbf`/`iat`.
- [x] URL Encoder/Decoder, URL Parser, Cron Expression Parser.
- [x] YAML ↔ JSON, JSON → CSV и структурный JSON Diff.
- [x] Redirect Generator, robots.txt Generator и Security Headers Sanitizer.
- [x] IPv6 Subnet Calculator и IPv6 Converter.
- [x] Unicode Inspector с code points, UTF-8, нормализацией и поиском невидимых символов.
- [x] Spam Blacklist Check: IP, домен и email по публичным DNSBL/URIBL, MX-адреса домена, отличие «blocked» от листинга, кэш и лимиты.
 - [x] Website Security Audit: HTTPS, security-заголовки, HSTS preload, security.txt, cookie-флаги, mixed content и оценка A–F с header-only fallback в Worker.
- [x] SSL/TLS deep scan: поддерживаемые версии TLS, набор шифров с пометкой слабых, OCSP stapling и CAA-записи в дополнение к сертификату и цепочке.

## Фаза 1 — Стабилизация

**Цель:** сделать существующие 55 инструментов предсказуемыми и проверяемыми.

- [x] Автоматический smoke-тест всех страниц после изменений.
- [ ] Единые правила валидации ввода и сообщений об ошибках.
- [ ] Проверка клавиатурной навигации и фокус-состояний.
- [ ] Аудит мобильной вёрстки на 375px, 768px и 1024px.
- [x] Проверять SEO-теги, JSON-LD и sitemap автотестами.
- [ ] Описать ограничения тяжёлых вычислений прямо в интерфейсе.
- [ ] Убрать оставшиеся дубли разметки в шаблонах страниц.

## Фаза 2 — Новые инструменты

**Ориентир:** конец 2026 — начало 2027.

### Электроника

- [ ] Resistor Color Code Calculator.
- [ ] LED Resistor Calculator.
- [ ] Voltage Divider Calculator.
- [ ] Power Supply Calculator.
- [ ] Capacitor / RC Calculator.

### Разработка

- [x] URL Encoder / Decoder.
- [x] URL Parser.
- [x] Cron Expression Helper.
- [ ] HTML Entity Encoder / Decoder.
- [x] JSON ↔ YAML Converter.
- [x] JSON → CSV Converter.
- [ ] Расширенный Color Picker с палитрами.
- [x] Diff для JSON-объектов.
- [x] Redirect / robots.txt / Security Headers generators.

### Сети

- [x] IPv6 Subnet Calculator.
- [x] IPv6 Converter (compress/expand, hex, decimal, binary, reverse DNS).
- [x] Spam / DNSBL blacklist checker.
- [x] Website Security Audit (заголовки, HSTS preload, security.txt, cookies, mixed content, A–F).
- [x] TLS deep scan (версии, шифры, OCSP stapling) и проверка CAA.
- [ ] Whois для IP-блоков.
- [ ] HTTP/2 и HTTP/3 индикаторы.
- [ ] Проверка DNSSEC.
- [ ] Калькулятор VLAN и wildcard-масок.

### Математика и текст

- [ ] GCD / LCM Calculator.
- [ ] Matrix Calculator.
- [ ] Markdown Preview.
- [ ] Slug Generator.
- [x] Unicode Inspector (code points, UTF-8, normalization, invisible controls).
- [ ] Генератор CSV / JSON из таблиц.

## Фаза 3 — Платформа и UX

**Ориентир:** 2027.

- [ ] Переключатель тёмной и светлой темы.
- [ ] Сохранение последних настроек в LocalStorage.
- [ ] История недавних инструментов.
- [ ] Экспорт результатов в JSON, CSV и TXT.
- [ ] PWA и офлайн-доступ к клиентским инструментам.
- [ ] Мультиязычность RU/EN.
- [ ] Публичная документация API.
- [ ] Улучшенная навигация между связанными инструментами.
- [ ] Горячие клавиши для частых действий внутри инструментов.

## Фаза 4 — Качество и сообщество

**Ориентир:** после стабилизации платформы.

- [x] Автотесты для чистых функций (`ipToInt`, `maskToCidr`, `evaluate`, `isPrime`).
- [x] E2E smoke-тесты всех страниц и ключевых сценариев (Playwright).
- [ ] ESLint / Stylelint / Prettier в CI.
- [x] Автоматическая проверка canonical, OG, sitemap и `og-image.png` (локально и после деплоя).
- [ ] Автоматическое обновление счётчиков инструментов.
- [ ] Система плагинов или единый реестр инструментов.
- [ ] Встраиваемые версии инструментов для сторонних сайтов.
- [ ] Анонимная статистика использования — только по явному согласию.
- [ ] Туториалы и примеры для сложных инструментов.

## Технический долг

- Дублирование шапки, подвала и метатегов между HTML-файлами.
- Базовые тесты есть; не хватает линтеров и более широкого покрытия сетевых страниц.
- Часть сетевых страниц требует ручной проверки при изменении API.
- Нужна единая политика лимитов для тяжёлых клиентских вычислений.
- Счётчики категорий на главной обновляются вручную.
- Нужен регламент обновления GeoLite2 и проверки доступности API.

## Принципы

1. **Приватность по умолчанию.** Клиентские вычисления не покидают браузер.
2. **Понятные ограничения.** Если алгоритм вероятностный или ограничен по времени, интерфейс говорит об этом прямо.
3. **Минимум зависимостей.** Vanilla JS и встроенные модули Node.js там, где этого достаточно.
4. **Быстрый отклик.** Тяжёлые операции должны иметь лимиты, а не подвешивать страницу.
5. **Доступность.** Клавиатурная навигация, семантический HTML и читаемый контраст.
6. **Открытость.** Код, roadmap и структура проекта доступны для сообщества.

## Метрики

- [x] 55 работающих инструментов.
- [x] Все публичные страницы имеют canonical, OG и запись в sitemap.
- [ ] Lighthouse Performance / Accessibility / SEO ≥ 95 на ключевых страницах.
- [x] Нет известных ошибок в консоли на всех страницах и основных сценариях.
- [x] Время ответа API для типовых запросов укладывается в установленные таймауты (проверяется smoke/live).
- [x] 100% клиентских инструментов работают без бэкенда.

## Как предложить изменение

1. Проверьте, нет ли задачи в этом roadmap.
2. Создайте issue с описанием проблемы или инструмента.
3. Для кода используйте отдельную ветку и Pull Request.
4. Приложите шаги проверки и, если возможно, скриншоты.

---

**Последнее обновление:** 22 октября 2026
**Лицензия:** MIT
