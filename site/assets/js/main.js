/**
 * OrbitNet — Main application logic
 * Handles search, filtering, sorting, keyboard shortcuts, and the IP widget.
 */

(() => {
  const input = document.getElementById('searchInput');
  const cards = [...document.querySelectorAll('.tool-card')];
  const filters = [...document.querySelectorAll('.filter-btn')];
  const grid = document.getElementById('toolGrid');
  const results = document.getElementById('resultsCount');
  const empty = document.getElementById('emptyState');
  const sort = document.getElementById('sortSelect');

  let activeFilter = 'all';

  function update() {
    const q = input.value.trim().toLowerCase();
    let visible = 0;

    cards.forEach(card => {
      const haystack = (
        card.dataset.name + ' ' +
        card.innerText + ' ' +
        card.dataset.category
      ).toLowerCase();

      const matchesQuery = !q || haystack.includes(q);
      const matchesFilter = activeFilter === 'all' || card.dataset.category === activeFilter;
      const show = matchesQuery && matchesFilter;

      card.hidden = !show;
      if (show) visible++;
    });

    if (q && visible === 0) {
      results.textContent = `No tools found for "${q}"`;
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

  sort.addEventListener('change', () => {
    const sorted = [...cards];

    if (sort.value === 'az') {
      sorted.sort((a, b) => a.dataset.name.localeCompare(b.dataset.name));
    } else if (sort.value === 'category') {
      sorted.sort((a, b) =>
        a.dataset.category.localeCompare(b.dataset.category) ||
        a.dataset.name.localeCompare(b.dataset.name)
      );
    } else {
      sorted.sort((a, b) => Number(a.dataset.order) - Number(b.dataset.order));
    }

    sorted.forEach(card => grid.appendChild(card));
  });

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
      })
      .catch(() => {
        valueEl.textContent = 'Unable to fetch';
        metaEl.textContent = 'Try the IP Lookup tool instead.';
      });
  }

  loadIP();
  update();
})();