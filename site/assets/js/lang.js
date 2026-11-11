(() => {
  const STORAGE_KEY = 'orbitnet:lang';
  const manifest = globalThis.__ORBITNET_I18N_MANIFEST__ || { ruPages: [] };
  const ruPages = new Set(manifest.ruPages || []);
  const specialPages = manifest.specialPages || {};

  function currentRel() {
    let rel = location.pathname.replace(/^\/+/, '');
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    return rel;
  }

  function hashLocale() {
    if (!specialPages[currentRel()]) return null;
    if (location.hash === '#ru') return 'ru';
    if (location.hash === '#en') return 'en';
    return null;
  }

  function isRussianPage() {
    const lang = (document.documentElement.lang || 'en').toLowerCase();
    return lang.startsWith('ru') || hashLocale() === 'ru';
  }

  function ruHref(rel) {
    if (specialPages[rel] && specialPages[rel].ru) return specialPages[rel].ru;
    if (!ruPages.has(rel)) return null;
    if (rel === 'index.html') return '/ru/';
    if (rel.endsWith('/index.html')) return '/ru/' + rel.slice(0, -'index.html'.length);
    return '/ru/' + rel;
  }

  function enHref(rel) {
    if (specialPages[rel] && specialPages[rel].en) return specialPages[rel].en;
    if (rel.startsWith('ru/')) rel = rel.slice(3);
    if (rel === 'index.html') return '/';
    if (rel.endsWith('/index.html')) return '/' + rel.slice(0, -'index.html'.length);
    return '/' + rel;
  }

  function readPreference() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value === 'ru' || value === 'en' ? value : null;
    } catch (error) {
      return null;
    }
  }

  function savePreference(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch (error) {
      // Storage can be unavailable in private mode; the switch still works
      // for this page view.
    }
  }

  function browserPrefersRussian() {
    const languages = navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language || ''];
    return languages.some(item => /^ru(?:-|$)/i.test(item));
  }

  function maybeRedirect() {
    if (isRussianPage()) return;
    if (currentRel() === 'privacy.html' && hashLocale() === 'en') return;
    const preference = readPreference();
    if (preference === 'en') return;
    if (preference !== 'ru' && !browserPrefersRussian()) return;

    const target = ruHref(currentRel());
    if (!target) return;
    const suffix = target.includes('#') ? location.search : location.search + location.hash;
    const next = target + suffix;
    if (next === location.pathname + location.search + location.hash) return;
    location.replace(next);
  }

  function addSwitcher() {
    const nav = document.querySelector('header .nav') || document.querySelector('.topbar .nav');
    if (!nav) return;

    const russian = isRussianPage();
    const rel = currentRel();
    const href = russian ? enHref(rel) : (ruHref(rel) || '/ru/');
    const code = russian ? 'en' : 'ru';
    const label = russian ? 'EN' : 'RU';

    let link = nav.querySelector('.lang-switch');
    if (!link) {
      link = document.createElement('a');
      link.className = 'lang-switch';
      link.addEventListener('click', () => savePreference(link.dataset.code));
      nav.appendChild(link);
    }
    link.href = href;
    link.hreflang = code;
    link.lang = code;
    link.dataset.code = code;
    link.textContent = label;
    link.setAttribute('aria-label', russian ? 'Switch to English' : 'Переключить на русский');
  }

  maybeRedirect();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addSwitcher);
  } else {
    addSwitcher();
  }

  window.addEventListener('hashchange', () => {
    maybeRedirect();
    addSwitcher();
  });
})();
