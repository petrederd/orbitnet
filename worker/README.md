# OrbitNet external checker (Cloudflare Worker)

Worker выполняет проверки из сети Cloudflare. Нужен потому, что сервер в России
не всегда может достучаться до сайта или получить DNS-ответ (блокировки,
фильтрация DNS, недоступный маршрут), хотя из остального мира ресурс работает.

Worker вызывается **только бэкендом** (`backend/external-check.js`) и только
как fallback. Локальная проверка всегда выполняется первой.

## Контракт

```
POST /
Authorization: Bearer <CHECKER_SECRET>
Content-Type: application/json

{"type":"http","host":"example.com","follow":false}
{"type":"dns","host":"example.com","recordType":"A"}
{"type":"propagation","host":"example.com","recordType":"A"}
{"type":"email","host":"example.com","selector":"default"}
```

`example.com` здесь — только пример. Поле `host` принимает любой публичный
домен, который ввёл пользователь в интерфейсе; Worker не привязан к
`example.com`.

`type` по умолчанию — `http`. `follow` по умолчанию — `true`; для Site Info и
HTTP Headers бэкенд передаёт `false`, для Redirect Checker — `true`.

Все успешные проверки возвращают HTTP 200 и `{"ok":true,...}`. Недоступная
цель — тоже HTTP 200, но `{"ok":false,"error":"..."}`: это результат проверки,
а не сбой Worker. Ошибки запроса: `405` — не POST, `401` — неверный секрет,
`400` — неподдерживаемый тип/запись, `413` — слишком большое тело.

### HTTP

```json
{
  "ok": true,
  "type": "http",
  "host": "example.com",
  "reachable": true,
  "status": 200,
  "protocol": "https",
  "finalUrl": "https://example.com/",
  "redirects": [
    {"url": "https://example.com/", "status": 200, "location": "", "ms": 123}
  ],
  "responseMs": 123,
  "title": "Example Domain",
  "server": "nginx",
  "contentType": "text/html; charset=utf-8",
  "contentLength": 1256,
  "headers": [
    {"name": "server", "value": "nginx"},
    {"name": "strict-transport-security", "value": "max-age=31536000"}
  ],
  "securityHeaders": {
    "strictTransportSecurity": "present",
    "contentSecurityPolicy": "missing",
    "xContentTypeOptions": "present",
    "xFrameOptions": "missing",
    "referrerPolicy": "present",
    "permissionsPolicy": "missing"
  },
  "source": "Cloudflare Worker"
}
```

- HTTPS, при ошибке соединения — повтор первого шага по HTTP; весь HTTP-поход ограничен 12 секундами, включая редиректы.
- При `follow: true` — до 10 редиректов, каждый шаг с статусом, `Location` и
  временем. Редирект на приватный/непубличный адрес отклоняется.
- Отдаются настоящие значения заголовков, а не только факт их наличия.
- HTML читается не более 200 КБ; чтение прекращается после `</title>`, поэтому обычные страницы не расходуют лимит целиком. Кодировка берётся из `Content-Type` или `<meta charset>`, поэтому windows-1251 не ломает `title`.

### DNS

```json
{
  "ok": true,
  "type": "dns",
  "host": "example.com",
  "recordType": "A",
  "records": ["192.0.2.1"],
  "nxdomain": false,
  "resolver": "Cloudflare 1.1.1.1",
  "source": "Cloudflare Worker"
}
```

Поддерживаются `A`, `AAAA`, `CNAME`, `MX`, `TXT`, `NS`, `SOA`, `CAA`, `PTR`.
Запросы идут через DNS-over-HTTPS: Cloudflare, при сбое — Google, затем
AdGuard. `PTR` принимает только публичный IP и запрашивает обратное имя
(`in-addr.arpa`/`ip6.arpa`), а не сырой IP. `nxdomain` отличает NXDOMAIN от
пустого ответа (`records: []`). Формат записей совпадает с локальным
`dnsLookup`: MX — `{priority,host}`, SOA — объект, CAA — `{flag,tag,value}`,
TXT — строка.

### Propagation

```json
{
  "ok": true,
  "type": "propagation",
  "host": "example.com",
  "recordType": "A",
  "resolvers": [
    {"server": "Cloudflare 1.1.1.1", "records": ["192.0.2.1"]},
    {"server": "Google 8.8.8.8", "records": ["192.0.2.1"]},
    {"server": "AdGuard 94.140.14.14", "records": ["192.0.2.1"]}
  ],
  "source": "Cloudflare Worker"
}
```

Сравниваются три независимых DoH-резолвера. Если резолвер недоступен, в его
элементе будет `error` вместо `records`.

### Email

```json
{
  "ok": true,
  "type": "email",
  "host": "example.com",
  "mx": [{"priority": 10, "host": "mail.example.com"}],
  "spf": "v=spf1 -all",
  "dmarc": "v=DMARC1; p=none",
  "dkim": ["v=DKIM1; k=rsa; p=..."],
  "mxPtr": {"ip": "192.0.2.10", "hostnames": ["mail.example.com"]},
  "errors": {},
  "source": "Cloudflare Worker"
}
```

MX, SPF, DMARC, DKIM и PTR основного MX собираются из DoH-запросов. Ошибки по
отдельным полям возвращаются в `errors`, как в локальном `/api/email`.

## Что нужно

- Аккаунт Cloudflare (бесплатного плана достаточно).
- Node.js и `npx wrangler`.
- Домен или `*.workers.dev` — главное, чтобы Worker был доступен по HTTPS.

## Деплой

Все команды выполняются в каталоге `worker/`:

```bash
cd worker

# 1. Войти в Cloudflare (или задать CLOUDFLARE_API_TOKEN).
npx wrangler login

# 2. Задеплоить Worker. Имя в wrangler.toml — orbitnet-site-checker,
#    поэтому URL останется прежним, если Worker уже был задеплоен.
npx wrangler deploy

# 3. Задать общий секрет. Придумайте длинную случайную строку:
#    openssl rand -hex 32
npx wrangler secret put CHECKER_SECRET
```

Секрет хранится в Cloudflare как Worker Secret. В `wrangler.toml` его нет, в
репозиторий и клиентский JavaScript он не попадает.

Cloudflare Workers хранит один загруженный скрипт, а не дерево файлов
репозитория. После `wrangler deploy` в dashboard обновляется содержимое
скрипта, но отдельные файлы `worker/src/index.js` там не появляются — это
нормально.

## Настройка сервера

На сервере, в каталоге проекта, откройте `.env` (он в `.gitignore`) и укажите:

```dotenv
CHECKER_URL=https://orbitnet-site-checker.<account>.workers.dev/
# ровно то, что ввели в wrangler secret put, без < > и кавычек
CHECKER_SECRET=та-же-строка-что-и-в-wrangler-secret-put
# необязательно, миллисекунды
CHECKER_TIMEOUT=20000
```

`CHECKER_URL` и `CHECKER_SECRET` уже проброшены в контейнер через
`docker-compose.yml`. После изменения `.env`:

```bash
docker compose up -d --build --force-recreate orbitnet-api
```

Проверка настроек внутри контейнера:

```bash
docker compose exec orbitnet-api node -e 'console.log(process.env.CHECKER_URL ? "url set" : "url missing", process.env.CHECKER_SECRET ? "secret set" : "secret missing")'
```

## Проверка Worker напрямую

```bash
CHECKER_URL='https://orbitnet-site-checker.<account>.workers.dev/'
CHECKER_SECRET='...'

curl -sS -X POST "$CHECKER_URL" \
  -H "Authorization: Bearer $CHECKER_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"type":"http","host":"example.com","follow":false}'

curl -sS -X POST "$CHECKER_URL" \
  -H "Authorization: Bearer $CHECKER_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"type":"dns","host":"example.com","recordType":"A"}'

curl -sS -X POST "$CHECKER_URL" \
  -H "Authorization: Bearer $CHECKER_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"type":"email","host":"example.com","selector":"default"}'
```

Без правильного `Authorization` Worker вернёт `401`.

## Когда бэкенд использует Worker

- `/api/site`, `/api/headers`: локальная проверка не получила HTTP-статус
  (DNS/TCP/TLS/таймаут), получила 403/451 или заголовок похож на страницу
  блокировки провайдера. Обычные ответы, включая 404/500 и редиректы,
  остаются локальными.
- `/api/redirect`: первый шаг локальной цепочки не соединился или вернул
  403/451.
- `/api/dns`: транспортная ошибка (`ETIMEOUT`, `ESERVFAIL`, `ECONNREFUSED`,
  `EREFUSED`, `ECONNRESET`), `ENOTFOUND` (возможная подмена NXDOMAIN
  провайдером) или `ENODATA` при локальном резолвере, который не проходит
  контрольный запрос. Успешный ответ Worker кэшируется на 60 секунд.
- `/api/email`: транспортная ошибка DNS или `ENOTFOUND` при поиске MX. Обычное
  отсутствие DMARC/DKIM (`ENODATA`) — нормальный ответ и не повод звать Worker.
- `/api/propagation`: все локальные резолверы вернули транспортную ошибку или
  `ENOTFOUND`, а не обычный пустой ответ.
- `/api/tls`: локальный резолвер вернул `Cannot resolve` или локальный
  handshake не прошёл. Worker через `propagation` отдаёт A/AAAA со всех
  DoH-резолверов, бэкенд проверяет публичность адресов и пробует несколько из
  них параллельно. Сертификат Worker не видит, handshake делает бэкенд.
- `/api/geo`: локальный резолвер вернул `Cannot resolve`. Worker отдаёт A/AAAA,
  бэкенд проверяет публичность адресов и делает geo lookup.
- Заблокированные локальным SSRF-guard адреса в Worker не отправляются.
- Для fallback действуют отдельные лимиты на клиента и на процесс; при
  занятости очереди возвращается `503`, а Worker не вызывается. Для
  неоднозначных `ENOTFOUND`-повторов есть отдельный, меньший бюджет
  (`EXTERNAL_NXDOMAIN_RATE_MAX`, `EXTERNAL_NXDOMAIN_GLOBAL_MAX`), чтобы
  случайные имена не исчерпывали общий лимит.

## Если fallback не срабатывает

- `External checker authentication failed` или `401` — `CHECKER_SECRET` в
  серверном `.env` не совпадает с секретом Worker. `wrangler secret list`
  показывает только имена, но не значения, поэтому просто «secret set» ничего
  не доказывает. Проще всего скопировать значение из серверного `.env` и
  выполнить `npx wrangler secret put CHECKER_SECRET`, вставив его в prompt.
- `source: "local"` и `workerError: "External check unavailable"` — локальная
  проверка не удалась, а fallback тоже не отработал. Подробная причина
  (секрет, URL, сеть) пишется только в серверный лог `[external-check]`, а не
  отдаётся клиенту.
- `source: "local"` без `workerError` — локальная проверка завершилась
  успешно, Worker для неё не нужен.

## Ограничения

- Worker не отдаёт TLS-сертификат: `getPeerCertificate` в Workers не
  реализован. SSL Checker (`/api/tls`) использует Worker только для A/AAAA при
  локальном `Cannot resolve` или сетевой ошибке; рукопожатие и сертификат
  читает бэкенд. Бэкенд пробует несколько адресов параллельно, но если
  недоступны все, TLS-проверка завершится ошибкой соединения.
- Worker не умеет raw TCP: WHOIS (порт 43) и Port Checker (произвольные порты)
  остаются локальными. HTTP/HTTPS-порты 80/443 проверяются только косвенно,
  через обычный `fetch`.
- Для DNS используются публичные DoH-резолверы, а не те же IP, что в локальном
  `/api/propagation`; набор резолверов и их кэш могут отличаться.
- Бесплатный план Cloudflare имеет дневной лимит запросов и subrequests.
  Успешные fallback-ответы кэшируются на бэкенде на 60 секунд, но при больших
  нагрузках стоит рассмотреть платный план.
- `CHECKER_TIMEOUT` на бэкенде — от 1000 до 20000 мс, по умолчанию 20000.
  Фактический таймаут Worker — минимум из этой настройки и остатка общего
  бюджета запроса (`REQUEST_BUDGET_MS`, по умолчанию 22000 мс). nginx ждёт
  ответ до 25 секунд, поэтому увеличивать таймаут выше 20000 без изменения
  nginx нельзя.
- Cloudflare Workers бесплатного плана имеют лимит CPU на запрос (10 мс).
  HTML ограничен 200 КБ, но чтение останавливается после `</title>`; страницы
  без заголовка всё равно могут привести к ошибке 1102. Такие случаи видны в
  логах Cloudflare.
- При срабатывании fallback домен/IP уходит в Cloudflare, а DNS-запросы — в
  Cloudflare, Google и AdGuard DoH. Это происходит только для проверки,
  которой не удалась локально; остальные данные остаются на сервере.
