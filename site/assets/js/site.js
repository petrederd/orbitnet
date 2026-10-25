(() => {
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  function legacyCopy(text) {
    const area = document.createElement('textarea');
    area.value = text;
    if (typeof area.setAttribute === 'function') area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    const selection = typeof document.getSelection === 'function' ? document.getSelection() : null;
    const previous = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
    area.select();
    if (typeof area.setSelectionRange === 'function') area.setSelectionRange(0, text.length);
    let copied = false;
    try {
      copied = typeof document.execCommand === 'function' && document.execCommand('copy');
    } catch (error) {
      copied = false;
    }
    try {
      if (typeof area.remove === 'function') area.remove();
      else document.body.removeChild(area);
    } catch (error) {
      // The temporary element is already detached.
    }
    if (selection && previous &&
        typeof selection.removeAllRanges === 'function' &&
        typeof selection.addRange === 'function') {
      selection.removeAllRanges();
      selection.addRange(previous);
    }
    return copied;
  }

  async function copyText(value) {
    const text = String(value == null ? '' : value);
    if (!text) return false;
    try {
      if (globalThis.navigator && globalThis.navigator.clipboard &&
          typeof globalThis.navigator.clipboard.writeText === 'function') {
        await globalThis.navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      // Fall through to execCommand: permission may be denied outside a
      // secure context, in an iframe, or by browser settings.
    }
    try {
      return legacyCopy(text);
    } catch (error) {
      return false;
    }
  }

  globalThis.copyText = copyText;

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
