# OrbitNet external checker (Cloudflare Worker)

Worker проверяет доступность сайта из сети Cloudflare. Нужен потому, что
сервер в России не всегда может достучаться до сайта (блокировки, фильтрация
DNS, недоступный маршрут), хотя из остального мира сайт работает.

Worker вызывается **только бэкендом** (`backend/external-check.js`) и только
как fallback: если локальная проверка не получила HTTP-ответ (DNS/TCP/TLS/
таймаут). При обычном ответе 200/404/500 запрос к Worker не делается.

## Контракт

```
POST /
Authorization: Bearer <CHECKER_SECRET>
Content-Type: application/json

{"host":"example.com"}
```

Успешный ответ (HTTP 200), в том числе для 404/500 самого сайта:

```json
{
  "host": "example.com",
  "reachable": true,
  "httpOk": true,
  "protocol": "https",
  "status": 200,
  "statusText": "OK",
  "responseMs": 123,
  "redirect": null,
  "contentType": "text/html; charset=utf-8",
  "contentLength": 1234,
  "title": "Example Domain",
  "server": "nginx",
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

Недоступный домен / таймаут — HTTP 502:

```json
{
  "host": "example.com",
  "reachable": false,
  "httpOk": false,
  "status": null,
  "responseMs": 8000,
  "error": "Connection timed out",
  "source": "Cloudflare Worker"
}
```

Ошибки запроса: `405` — не POST, `401` — неверный секрет, `400` — не публичный
домен (IP-адреса, `localhost`, `*.local`, `*.internal`, `*.test`, `*.invalid`
запрещены).

## Что нужно

- Аккаунт Cloudflare (бесплатного плана достаточно).
- Node.js и `npx wrangler` (ставится по требованию).
- Домен или `*.workers.dev` — оба подходят, главное HTTPS.

## Деплой

Все команды выполняются в каталоге `worker/`:

```bash
cd worker

# 1. Войти в Cloudflare (откроется браузер) или задать CLOUDFLARE_API_TOKEN.
npx wrangler login

# 2. Задеплоить Worker. В выводе будет URL вида
#    https://orbitnet-site-checker.<account>.workers.dev
npx wrangler deploy

# 3. Задать общий секрет. Придумайте длинную случайную строку, например:
#    openssl rand -hex 32
#    Вставьте её в приглашение wrangler (в git она не попадает).
npx wrangler secret put CHECKER_SECRET
```

Секрет хранится в Cloudflare как Worker Secret. В `wrangler.toml` его нет,
в репозиторий и в клиентский JavaScript он не попадает.

## Настройка сервера

На сервере, в каталоге проекта (там же, где `docker-compose.yml`), откройте
`.env` (он в `.gitignore`) и добавьте:

```dotenv
CHECKER_URL=https://orbitnet-site-checker.<account>.workers.dev/
CHECKER_SECRET=<та же строка, что в wrangler secret put>
# необязательно, миллисекунды
CHECKER_TIMEOUT=10000
```

`CHECKER_URL` и `CHECKER_SECRET` уже проброшены в контейнер через
`docker-compose.yml`:

```yaml
environment:
  - CHECKER_URL=${CHECKER_URL:-}
  - CHECKER_SECRET=${CHECKER_SECRET:-}
  - CHECKER_TIMEOUT=${CHECKER_TIMEOUT:-10000}
```

После изменения `.env` перезапустите API (полный деплой через GitHub Actions
тоже подхватит значения, потому что `.env` лежит на сервере и не перезаписывается):

```bash
docker compose up -d --build --force-recreate orbitnet-api
```

Проверьте, что контейнер видит настройки:

```bash
docker compose exec orbitnet-api node -e 'console.log(process.env.CHECKER_URL ? "url set" : "url missing", process.env.CHECKER_SECRET ? "secret set" : "secret missing")'
```

## Проверка Worker напрямую

Замените URL и секрет:

```bash
CHECKER_URL='https://orbitnet-site-checker.<account>.workers.dev/'
CHECKER_SECRET='...'

curl -sS -X POST "$CHECKER_URL" \
  -H "Authorization: Bearer $CHECKER_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"host":"example.com"}'
```

Ожидаемые ответы:

- рабочий сайт — `{"reachable":true,"status":200,...}`;
- HTTP 404 — `{"reachable":true,"status":404,...}` (это успешная проверка);
- недоступный домен — HTTP 502, `{"reachable":false,"error":"Connection failed"}`;
- таймаут — HTTP 502, `{"reachable":false,"error":"Connection timed out"}`.

Без правильного `Authorization` Worker вернёт `401`.

## Проверка через API OrbitNet

```bash
# source = "local" — локальная проверка сработала;
# source = "worker" — локальная не смогла, использован Worker.
curl -sS 'http://127.0.0.1:8081/api/site?host=example.com' | \
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.source,j.status,j.error||"")})'
```

Чтобы принудительно проверить fallback, возьмите домен, который недоступен
именно с сервера (но открывается извне), либо временно остановите DNS/маршрут.

## Что проверяется

- HTTPS, при ошибке соединения — повтор по HTTP (как в локальной проверке).
- Первый ответ сайта (`redirect: "manual"`), без перехода по редиректам.
- Заголовок `title` (не более 64 КБ HTML), `server`, `content-type`,
  `content-length` и наличие security-заголовков (только `present`/`missing`,
  без значений).
- SSRF-защита: запрещены IP-адреса, `localhost`, `*.local`, `*.internal`,
  `*.test`, `*.invalid`; Cloudflare не выпускает запросы в приватные сети.
- Только `POST` с `Authorization: Bearer <CHECKER_SECRET>`.

## Ограничения

- Worker не умеет отдавать TLS-сертификат, поэтому SSL Checker (`/api/tls`)
  остаётся локальным.
- Worker не проходит по редиректам и не отдаёт значения заголовков, поэтому
  Redirect Checker (`/api/redirect`) остаётся локальным, а HTTP Headers при
  внешней проверке показывает только наличие security-заголовков.
- TCP-порты, кроме 80/443, Worker проверить не может — Port Checker остаётся
  локальным.
- Бесплатный план Cloudflare имеет дневной лимит запросов; fallback вызывается
  редко, но при больших нагрузках стоит включить кэш или платный план.
