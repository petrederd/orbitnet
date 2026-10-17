/**
 * OrbitNet — Main application logic
 * Handles search, filtering, sorting, and keyboard shortcuts
 */

(() => {
  // DOM elements
  const input = document.getElementById('searchInput');
  const cards = [...document.querySelectorAll('.tool-card')];
  const filters = [...document.querySelectorAll('.filter-btn')];
  const grid = document.getElementById('toolGrid');
  const results = document.getElementById('resultsCount');
  const empty = document.getElementById('emptyState');
  const sort = document.getElementById('sortSelect');
  
  let activeFilter = 'all';

  /**
   * Update the visible tools based on search query and active filter
   */
  function update() {
    const q = input.value.trim().toLowerCase();
    let visible = 0;
    let matchedCards = [];
    
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
      if (show) {
        visible++;
        matchedCards.push(card.dataset.name);
      }
    });
    
    // Show different messages based on search state
    if (q && visible > 0) {
      results.innerHTML = `<strong>Found ${visible} tool${visible > 1 ? 's' : ''}:</strong> ${matchedCards.join(', ')}`;
    } else if (q && visible === 0) {
      results.textContent = `No tools found for "${q}"`;
    } else {
      results.textContent = `Showing ${visible} of ${cards.length} tools`;
    }
    
    empty.style.display = visible ? 'none' : 'block';
    grid.style.display = visible ? 'grid' : 'none';
  }

  /**
   * Handle filter button clicks
   */
  filters.forEach(btn => btn.addEventListener('click', () => {
    activeFilter = btn.dataset.filter;
    filters.forEach(b => b.classList.toggle('active', b === btn));
    update();
  }));

  /**
   * Handle search input changes
   */
  input.addEventListener('input', update);

  /**
   * Handle search form submission
   */
  document.getElementById('searchForm').addEventListener('submit', e => {
    e.preventDefault();
    document.getElementById('tools').scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
    update();
  });

  /**
   * Handle sorting changes
   */
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

  /**
   * Keyboard shortcuts
   */
  document.addEventListener('keydown', e => {
    // Focus search on "/" key
    if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      input.focus();
    }
    
    // Clear search and blur on Escape
    if (e.key === 'Escape' && document.activeElement === input) {
      input.value = '';
      input.blur();
      update();
    }
  });

  /**
   * Handle tool links (planned tools)
   */
  document.querySelectorAll('[data-tool]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const name = link.dataset.tool;
      const target = document.getElementById('tool-request');
      
      target.querySelector('h2').textContent = `${name} — coming soon`;
      target.querySelector('p').textContent = 
        `This is currently a planned tool in the OrbitNet collection. ` +
        `The next step is to implement ${name} as a working, tested utility.`;
      
      target.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    });
  });

  /**
   * Set current year in footer
   */
  document.getElementById('year').textContent = new Date().getFullYear();

  /**
   * Initialize on page load
   */
  update();
})();
