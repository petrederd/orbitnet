(() => {
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  const EVENT_TYPES = ['click', 'input', 'change', 'submit'];

  function readArgs(element) {
    const raw = element.dataset.args;
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(arg => (arg && typeof arg === 'object' && arg.$el ? element : arg));
    } catch (error) {
      return [];
    }
  }

  function dispatch(event) {
    const target = event.target && event.target.closest
      ? event.target.closest('[data-action]')
      : null;
    if (!target) return;

    const action = target.dataset.action;
    const expected = target.dataset.event || 'click';
    if (expected !== event.type) return;

    const handler = globalThis[action];
    if (typeof handler !== 'function') return;

    handler.apply(target, readArgs(target));
  }

  EVENT_TYPES.forEach(type => document.addEventListener(type, dispatch));
})();
