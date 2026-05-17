(function () {
  const PRODUCTS = [
    { id: 'p-101', name: 'Pixel Phone 9', cat: 'phone',  price: 799.00, desc: 'Flagship Android phone with great camera' },
    { id: 'p-102', name: 'Galaxy S24 Ultra', cat: 'phone',  price: 1199.00, desc: '6.8" display, 200MP camera, S Pen' },
    { id: 'p-201', name: 'MacBook Air 15"', cat: 'laptop', price: 1299.00, desc: 'M3, 16GB RAM, 512GB SSD' },
    { id: 'p-202', name: 'ThinkPad X1 Carbon', cat: 'laptop', price: 1499.00, desc: 'i7, 32GB, business laptop' },
    { id: 'p-301', name: 'Sony WH-1000XM5', cat: 'audio',  price: 399.00, desc: 'Industry-leading noise cancellation' },
    { id: 'p-302', name: 'AirPods Pro 2', cat: 'audio',  price: 249.00, desc: 'Adaptive audio, USB-C case' }
  ];

  const params = new URLSearchParams(location.search);
  const shake = params.get('shake') === '1';
  const seed = parseInt(params.get('seed') || '0', 10);
  const delay = parseInt(params.get('delay') || '0', 10);

  let cart = [];
  let lastQuery = '';
  let lastCat = '';

  function $(sel) { return document.querySelector(sel); }
  function toast(msg, kind) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show ' + (kind || '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.className = 'toast'; }, 1800);
  }

  // Seeded PRNG so ?seed=1 gives stable "shake" output, useful for tests/healer fixtures
  function mulberry32(a) {
    return function () { let t = a += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  const rng = mulberry32(seed || Math.floor(Math.random() * 1e6));

  function rand(n) { return Math.floor(rng() * n); }
  function rid() { return 'x' + rand(1e9).toString(36); }

  function maybeShake(stableId, stableClass) {
    if (!shake) return { id: stableId, cls: stableClass };
    return {
      id: stableId + '-' + rid(),
      cls: stableClass + ' ' + rid()
    };
  }

  function render() {
    const grid = $('#productGrid');
    grid.innerHTML = '';
    $('#modeBadge').textContent = shake ? 'shake mode (UI drift)' : 'stable mode';
    $('#modeBadge').dataset.mode = shake ? 'shake' : 'stable';

    const filtered = PRODUCTS.filter(p => {
      const matchesQ = !lastQuery || p.name.toLowerCase().includes(lastQuery.toLowerCase());
      const matchesC = !lastCat || p.cat === lastCat;
      return matchesQ && matchesC;
    });

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.id = 'noResults';
      empty.dataset.testid = 'no-results';
      empty.textContent = 'No products found.';
      empty.style.color = 'var(--muted)';
      grid.appendChild(empty);
      return;
    }

    filtered.forEach((p) => {
      const card = document.createElement('div');
      const sh = maybeShake(p.id, 'card');
      card.className = sh.cls;
      card.id = sh.id;
      card.dataset.testid = 'product-' + p.id;
      card.dataset.productId = p.id;
      card.dataset.productName = p.name;
      card.setAttribute('role', 'listitem');
      card.setAttribute('aria-label', p.name);

      const title = document.createElement('div');
      title.className = 'title';
      title.dataset.testid = 'product-name-' + p.id;
      title.textContent = p.name;

      const price = document.createElement('div');
      price.className = 'price';
      price.dataset.testid = 'product-price-' + p.id;
      price.textContent = '$' + p.price.toFixed(2);

      const desc = document.createElement('div');
      desc.className = 'desc';
      desc.textContent = p.desc;

      const addBtn = document.createElement('button');
      const addSh = maybeShake('add-' + p.id, 'add-btn');
      addBtn.className = addSh.cls;
      addBtn.id = addSh.id;
      addBtn.dataset.testid = 'add-to-cart-' + p.id;
      addBtn.dataset.productId = p.id;
      addBtn.setAttribute('aria-label', 'Add ' + p.name + ' to cart');
      addBtn.textContent = 'Add to Cart';
      addBtn.addEventListener('click', () => addToCart(p));

      card.append(title, price, desc, addBtn);
      grid.appendChild(card);
    });
  }

  function addToCart(p) {
    const existing = cart.find(c => c.id === p.id);
    if (existing) existing.qty += 1;
    else cart.push({ id: p.id, name: p.name, price: p.price, qty: 1 });
    renderCart();
    toast('Added "' + p.name + '" to cart', 'success');
  }

  function renderCart() {
    const lines = $('#cartLines');
    lines.innerHTML = '';
    let total = 0;
    cart.forEach(line => {
      const div = document.createElement('div');
      div.className = 'cart-line';
      div.dataset.testid = 'cart-line-' + line.id;
      const lineTotal = line.price * line.qty;
      total += lineTotal;
      div.innerHTML = '<span>' + line.qty + ' x ' + line.name + '</span><span>$' + lineTotal.toFixed(2) + '</span>';
      lines.appendChild(div);
    });
    $('#cartCount').textContent = cart.reduce((s, c) => s + c.qty, 0);
    $('#cartTotal').textContent = 'Total: $' + total.toFixed(2);
  }

  function bind() {
    $('#searchBtn').addEventListener('click', () => {
      lastQuery = $('#searchInput').value.trim();
      lastCat = $('#categoryFilter').value;
      render();
    });
    $('#searchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#searchBtn').click(); });
    $('#shakeBtn').addEventListener('click', () => {
      const url = new URL(location.href);
      url.searchParams.set('shake', '1');
      url.searchParams.set('seed', Math.floor(Math.random() * 1e6));
      location.href = url.toString();
    });
    $('#resetBtn').addEventListener('click', () => {
      location.href = location.pathname;
    });
  }

  function boot() {
    bind();
    if (delay > 0) {
      setTimeout(render, Math.min(delay, 10000));
    } else {
      render();
    }
  }

  // Hooks for automated tests / healer experiments
  window.ZAC_DEMO = {
    getProducts: () => PRODUCTS.slice(),
    getCart: () => cart.slice(),
    addToCartById: (id) => { const p = PRODUCTS.find(x => x.id === id); if (p) addToCart(p); },
    rerender: render
  };

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', boot)
    : boot();
})();
