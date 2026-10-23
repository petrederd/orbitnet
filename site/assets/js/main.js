(() => {
  const input = document.getElementById('searchInput');
  const cards = [...document.querySelectorAll('.tool-card')];
  const filters = [...document.querySelectorAll('.filter-btn')];
  const grid = document.getElementById('toolGrid');
  const results = document.getElementById('resultsCount');
  const empty = document.getElementById('emptyState');
  const sort = document.getElementById('sortSelect');

  let activeFilter = 'all';

  const FAVORITES_KEY = 'orbitnet:favorites';
  let favorites = new Set();
  try {
    const stored = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    if (Array.isArray(stored)) {
      favorites = new Set(stored.filter(item => typeof item === 'string'));
    }
  } catch (e) {
    // localStorage may be disabled; favorites simply won't persist.
  }

  const favoritesCount = document.getElementById('favoritesCount');

  function saveFavorites() {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
    } catch (e) {
      // Ignore storage failures (private mode, quota).
    }
  }

  function updateFavoritesCount() {
    if (favoritesCount) favoritesCount.textContent = favorites.size;
  }

  function syncFavButton(btn, href, name) {
    const active = favorites.has(href);
    btn.textContent = active ? '★' : '☆';
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
    btn.setAttribute('aria-label', (active ? 'Remove from favorites: ' : 'Add to favorites: ') + name);
    btn.title = active ? 'Remove from favorites' : 'Add to favorites';
  }

  function addFavoriteButton(card) {
    const href = card.getAttribute('href');
    const wrap = document.createElement('div');
    wrap.className = 'tool-card-wrap';
    card.parentNode.insertBefore(wrap, card);
    wrap.appendChild(card);
    card._wrap = wrap;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fav-btn';
    btn.dataset.href = href;
    wrap.appendChild(btn);
    syncFavButton(btn, href, card.dataset.name);

    btn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (favorites.has(href)) favorites.delete(href);
      else favorites.add(href);
      saveFavorites();
      updateFavoritesCount();
      cards.forEach(item => {
        const itemBtn = item._wrap && item._wrap.querySelector('.fav-btn');
        if (itemBtn) syncFavButton(itemBtn, item.getAttribute('href'), item.dataset.name);
      });
      update();
    });
  }

  function setCardVisible(card, visible) {
    card.hidden = !visible;
    if (card._wrap) card._wrap.hidden = !visible;
  }

  const aliases = {
    'tools/networks/subnet-calculator.html': 'subnet subnetting netmask net mask cidr ipv4 network broadcast host hosts address calculator подсеть маска сеть адрес',
    'tools/developer/json-formatter.html': 'json format formatter beautify prettify validate validator lint minify pretty print форматирование валидатор',
    'tools/networks/ip-lookup.html': 'ip lookup my address public geolocation location provider isp reverse dns hostname адрес геолокация провайдер мой',
    'tools/electricity/ohms-law.html': 'ohm ohms law voltage current resistance resistor power watts electrical electronics закон ома напряжение ток сопротивление мощность',
    'tools/electricity/ne555-calculator.html': 'ne555 555 timer astable monostable resistor capacitor frequency duty cycle electronics таймер частота',
    'tools/developer/base64.html': 'base64 base 64 encode decode encoder decoder btoa atob кодирование декодирование',
    'tools/developer/uuid-generator.html': 'uuid guid unique id identifier generator v4 генератор идентификатор',
    'tools/math/quadratic-solver.html': 'quadratic equation solver roots root discriminant parabola квадратное уравнение корни',
    'tools/math/percentage-calculator.html': 'percentage percent calculate calculator discount increase decrease change проценты процент скидка',
    'tools/math/unit-converter.html': 'unit converter convert conversion length width weight mass temperature area volume speed metric imperial единицы конвертер температура вес длина',
    'tools/networks/dns-lookup.html': 'dns lookup record records a aaaa mx txt ns cname soa caa resolver domain днс запись домен',
    'tools/networks/port-checker.html': 'port check checker tcp open closed scan scanner порт проверка',
    'tools/networks/ip-info.html': 'ip domain info whois dns reverse geolocation provider registrar информация домен',
    'tools/networks/site-info.html': 'site website info inspect http status server title response time сайт информация',
    'tools/developer/password-generator.html': 'password passphrase generator random strong secure entropy пароль генератор надежный',
    'tools/networks/cidr-netmask.html': 'cidr netmask subnet mask wildcard prefix converter маска подсеть префикс',
    'tools/networks/ip-binary-converter.html': 'ip binary decimal hex hexadecimal converter address ipv4 бинарный двоичный шестнадцатеричный',
    'tools/networks/mac-converter.html': 'mac address converter oui vendor format mac адрес',
    'tools/networks/reverse-ip.html': 'reverse ip ptr hostname lookup обратный ptr',
    'tools/text/case-converter.html': 'case convert upper lower title sentence camel snake kebab text регистр текст',
    'tools/text/word-counter.html': 'word character count counter text sentences paragraphs reading time keywords words characters слова символы текст',
    'tools/text/text-diff-checker.html': 'diff compare text difference checker merge сравнение текст различия',
    'tools/text/lorem-ipsum-generator.html': 'lorem ipsum placeholder dummy text generator paragraphs sentences рыба заглушка',
    'tools/math/number-base-converter.html': 'number base binary octal decimal hexadecimal convert radix система счисления',
    'tools/math/scientific-notation.html': 'scientific notation engineering convert exponent number научная нотация степень',
    'tools/math/statistics-calculator.html': 'statistics stats mean median mode variance standard deviation quartile average статистика среднее медиана дисперсия',
    'tools/math/prime-checker.html': 'prime number checker factorization factor nearest numbers простое число факторизация',
    'tools/developer/hash-generator.html': 'hash md5 sha sha1 sha256 sha512 checksum digest хэш хеш',
    'tools/developer/timestamp-converter.html': 'timestamp unix epoch time date iso 8601 convert конвертер время дата',
    'tools/developer/regex-tester.html': 'regex regexp regular expression test tester pattern match groups регулярные выражения',
    'tools/developer/color-converter.html': 'color colour hex rgb hsl converter picker цвет конвертер',
    'tools/networks/ssl-checker.html': 'ssl tls certificate cert https validity issuer chain сертификат проверка',
    'tools/networks/http-headers.html': 'http headers response hsts csp security server заголовки',
    'tools/networks/email-dns-checker.html': 'email dns mx spf dmarc dkim ptr mail почта домен проверка',
    'tools/networks/dns-propagation.html': 'dns propagation propagate resolver public resolvers распространение днс',
    'tools/networks/redirect-checker.html': 'redirect chain http status url редирект перенаправление',
    'tools/networks/website-health.html': 'website health check dns tls reachability security headers сайт здоровье проверка',
    'tools/networks/network-diagnostics.html': 'network diagnostics dns reverse tcp port check диагностика сеть',
    'tools/networks/email-deliverability.html': 'email deliverability mx spf dmarc dkim mail spam доставляемость почта',
    'tools/developer/jwt-decoder.html': 'jwt json web token decode decoder header payload claims токен декодер',
    'tools/networks/anonymity-check.html': 'anonymity anonymous proxy tor vpn webrtc leak privacy ip timezone анонимность прокси утечка',
    'tools/networks/spam-blacklist-check.html': 'spam blacklist dnsbl rbl rbls uribl surbl blocklist reputation spamhaus spamcop barracuda mail blacklist спам черный список репутация рассылка',
  };

  function normalize(value) {
    return value.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  }

  const stopWords = new Set([
    'a', 'an', 'and', 'are', 'at', 'be', 'by', 'do', 'for', 'from', 'how', 'i', 'in',
    'is', 'it', 'me', 'my', 'of', 'on', 'or', 'the', 'to', 'what', 'with',
    'в', 'во', 'для', 'как', 'меня', 'мне', 'мой', 'моя', 'мое', 'на', 'по', 'у', 'что', 'это',
  ]);

  function tokenize(value, stripStopWords = false) {
    const words = normalize(value).split(' ').filter(Boolean);
    return stripStopWords ? words.filter(word => !stopWords.has(word)) : words;
  }

  function editDistance(a, b, limit) {
    if (Math.abs(a.length - b.length) > limit) return limit + 1;

    const width = b.length + 1;
    let twoBack = new Array(width).fill(0);
    let previous = Array.from({ length: width }, (_, i) => i);
    let current = new Array(width);

    for (let i = 1; i <= a.length; i++) {
      current[0] = i;
      let rowMin = i;
      const code = a.charCodeAt(i - 1);

      for (let j = 1; j <= b.length; j++) {
        const cost = code === b.charCodeAt(j - 1) ? 0 : 1;
        let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);

        if (i > 1 && j > 1 && code === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) {
          value = Math.min(value, twoBack[j - 2] + 1);
        }

        current[j] = value;
        if (value < rowMin) rowMin = value;
      }

      if (rowMin > limit) return limit + 1;
      [twoBack, previous, current] = [previous, current, twoBack];
    }

    return previous[b.length];
  }

  cards.forEach(addFavoriteButton);
  updateFavoritesCount();

  const searchIndex = new Map(cards.map(card => {
    const name = card.dataset.name;
    const description = card.querySelector('p')?.textContent || '';
    const extra = aliases[card.getAttribute('href')] || '';
    const nameTokens = tokenize(name);
    const allText = name + ' ' + description + ' ' + card.dataset.category + ' ' + extra;

    return [card, {
      tokens: [...new Set(tokenize(allText))],
      nameTokens: new Set(nameTokens),
      nameNorm: normalize(name),
      allNorm: normalize(allText),
    }];
  }));

  function matchScore(index, queryTokens, phrase) {
    let total = 0;

    for (const query of queryTokens) {
      let best = 0;

      for (const token of index.tokens) {
        let score = 0;

        if (token === query) {
          score = 100;
        } else if (query.length >= 3 && token.startsWith(query)) {
          score = 80;
        } else if (query.length >= 3 && token.includes(query)) {
          score = 55;
        } else if (query.length >= 5) {
          const limit = query.length >= 8 ? 2 : 1;
          const distance = editDistance(query, token, limit);
          if (distance <= limit) score = 45 - distance * 10;
        }

        if (score && index.nameTokens.has(token)) score += 25;
        if (score > best) best = score;
        if (best >= 125) break;
      }

      if (!best) return 0;
      total += best;
    }

    if (queryTokens.length > 1 && index.nameNorm.includes(phrase)) total += 150;
    else if (index.allNorm.includes(phrase)) total += 80;

    return total;
  }

  function compareCards(a, b) {
    if (sort.value === 'az') {
      return a.dataset.name.localeCompare(b.dataset.name);
    }

    if (sort.value === 'category') {
      return a.dataset.category.localeCompare(b.dataset.category) ||
        a.dataset.name.localeCompare(b.dataset.name);
    }

    return Number(a.dataset.order) - Number(b.dataset.order);
  }

  function sortCards(list) {
    return [...list].sort(compareCards);
  }

  function update() {
    const rawQuery = input.value.trim();
    const phrase = normalize(rawQuery);
    let queryTokens = tokenize(rawQuery, true);
    if (!queryTokens.length) queryTokens = tokenize(rawQuery);
    const scores = new Map();
    let visible = 0;

    cards.forEach(card => {
      const matchesFilter = activeFilter === 'all' ||
        (activeFilter === 'favorites'
          ? favorites.has(card.getAttribute('href'))
          : card.dataset.category === activeFilter);
      const score = queryTokens.length ? matchScore(searchIndex.get(card), queryTokens, phrase) : 1;
      const show = matchesFilter && score > 0;

      setCardVisible(card, show);
      if (show) {
        visible++;
        if (queryTokens.length) scores.set(card, score);
      }
    });

    if (queryTokens.length) {
      const ranked = cards
        .filter(card => !card.hidden)
        .sort((a, b) => scores.get(b) - scores.get(a) || compareCards(a, b));
      ranked.forEach(card => grid.appendChild(card._wrap || card));
    } else {
      sortCards(cards).forEach(card => grid.appendChild(card._wrap || card));
    }

    if (activeFilter === 'favorites' && !favorites.size && !queryTokens.length) {
      results.textContent = 'No favorites yet — tap ☆ on any tool card.';
    } else if (queryTokens.length && visible === 0) {
      results.textContent = `No tools found for "${rawQuery}"`;
    } else {
      results.textContent = `Showing ${visible} of ${cards.length} tools`;
    }

    empty.style.display = visible ? 'none' : 'block';
    grid.style.display = visible ? 'grid' : 'none';
  }

  filters.forEach(btn => btn.addEventListener('click', () => {
    activeFilter = btn.dataset.filter;
    filters.forEach(b => b.classList.toggle('active', b === btn));
    update();
  }));

  input.addEventListener('input', update);

  document.getElementById('searchForm').addEventListener('submit', e => {
    e.preventDefault();
    update();
  });

  sort.addEventListener('change', update);

  document.addEventListener('keydown', e => {
    if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      input.focus();
    }
    if (e.key === 'Escape' && document.activeElement === input) {
      input.value = '';
      input.blur();
      update();
    }
  });

  document.getElementById('year').textContent = new Date().getFullYear();

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function renderGeo(geo) {
    const el = document.getElementById('ipGeo');
    if (!el) return;

    if (!geo) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }

    const rows = [];
    const place = [geo.city, geo.region, geo.country].filter(Boolean).join(', ');
    if (place) rows.push(['Location', place]);
    if (geo.timezone) rows.push(['Timezone', geo.timezone]);
    if (geo.asnOrganization) {
      rows.push(['Provider', geo.asnOrganization + (geo.asn ? ' (AS' + geo.asn + ')' : '')]);
    }

    if (!rows.length) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }

    el.innerHTML = rows.map(([label, value]) =>
      '<div class="ip-geo-item"><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>'
    ).join('');
    el.hidden = false;
  }

  function loadIP() {
    const valueEl = document.getElementById('ipValue');
    const metaEl = document.getElementById('ipMeta');

    fetch('/api/ip')
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        valueEl.textContent = data.ip || 'Unknown';
        const parts = [];
        parts.push('IPv' + data.version);
        if (data.hostname) parts.push(data.hostname);
        metaEl.textContent = parts.join(' · ');
        renderGeo(data.geo);
      })
      .catch(() => {
        valueEl.textContent = 'Unable to fetch';
        metaEl.textContent = 'Try the IP Lookup tool instead.';
        renderGeo(null);
      });
  }

  try {
    const initialQuery = new URLSearchParams(location.search).get('q');
    if (initialQuery) input.value = initialQuery;
  } catch (e) {
    // Ignore malformed or unavailable location.search.
  }

  loadIP();
  update();
})();