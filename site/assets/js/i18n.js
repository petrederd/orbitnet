(() => {
  const lang = (document.documentElement.lang || 'en').toLowerCase();
  const isRussian = lang.startsWith('ru');
  const dictionary = globalThis.__ORBITNET_I18N__ || {};

  function t(source, params) {
    const key = String(source == null ? '' : source);
    let value = isRussian && Object.prototype.hasOwnProperty.call(dictionary, key)
      ? dictionary[key]
      : key;
    if (params) {
      value = value.replace(/\{(\w+)\}/g, (match, name) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match);
    }
    return value;
  }

  function formatNumber(value, options) {
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    return number.toLocaleString(isRussian ? 'ru-RU' : 'en-US', options);
  }

  function formatDate(value, options) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString(isRussian ? 'ru-RU' : 'en-US', options);
  }

  globalThis.t = t;
  globalThis.formatNumber = formatNumber;
  globalThis.formatDate = formatDate;
  globalThis.orbitnetLocale = () => (isRussian ? 'ru' : 'en');
})();
