'use strict';
/* Smart Basket Namibia: single-page front end (no build step). */

// ------------------------------------------------------------------ helpers
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => 'N$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const uid = () => Math.random().toString(36).slice(2, 10);
const view = $('#view');
const PRIOS = [['must', 'Must have'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Nice to have']];
const QUICK = ['Maize meal', 'Bread', 'Cooking oil', 'Sugar', 'Eggs', 'Milk', 'Chicken', 'Rice', 'Washing powder', 'Toilet paper', 'Nappies', 'Soap'];

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function store(key, val) { try { if (val === undefined) return JSON.parse(localStorage.getItem(key)); localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage unavailable */ } return null; }

async function api(path, opts = {}) {
  const o = { method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'), headers: {}, credentials: 'same-origin' };
  if (opts.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
  const r = await fetch(path, o);
  let data = null;
  try { data = await r.json(); } catch { /* empty body */ }
  if (!r.ok) {
    let msg = data && data.detail;
    if (Array.isArray(msg)) msg = msg.map((d) => (d.loc ? d.loc[d.loc.length - 1] + ': ' : '') + d.msg).join('; ');
    throw new Error(msg || `Something went wrong (${r.status})`);
  }
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function fmtDate(iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', opts);
}
function daysFromToday(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const [ty, tm, td] = S.meta.today.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
}
function until(iso) {
  if (!iso) return 'while stocks last';
  const n = daysFromToday(iso);
  if (n <= 0) return 'ends today';
  if (n === 1) return 'ends tomorrow';
  return 'until ' + fmtDate(iso);
}
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ state
const S = {
  meta: null, user: null, byId: {}, items: {},
  specials: { q: '', category: '', sort: 'percent', stores: new Set(), limit: 48, data: null },
  compare: { q: '', results: [], item: null },
  cart: loadCart(), result: null, stale: false,
};

function defaultCart() {
  return { lines: [], mode: 'cheapest', budget: 500, maxStores: 3, tripCost: 0, stores: null, listId: null, listName: '' };
}
function loadCart() {
  const c = store('nsb.cart.v1');
  return c && Array.isArray(c.lines) ? { ...defaultCart(), ...c } : defaultCart();
}
function saveCart() { store('nsb.cart.v1', S.cart); updateCartCount(); }
function updateCartCount() {
  const n = S.cart.lines.reduce((a, l) => a + l.qty, 0);
  const el = $('#cart-count');
  el.textContent = n;
  el.hidden = n === 0;
}
function addToCart(e, qty = 1, quiet = false) {
  const pid = e.product_id || null;
  const ex = S.cart.lines.find((l) => l.item_id === e.item_id && (l.product_id || null) === pid);
  if (ex) ex.qty = Math.min(99, ex.qty + qty);
  else S.cart.lines.push({ key: uid(), item_id: e.item_id, product_id: pid, name: e.name, size: e.size || '', brand: e.brand || null, qty, priority: 'high' });
  S.stale = !!S.result;
  saveCart();
  if (!quiet) toast(`Added ${e.brand && pid ? e.brand + ' ' : ''}${e.name} ${e.size || ''} to your cart`);
}

const storeName = (id) => (S.byId[id] ? S.byId[id].name : id);
const logo = (id, cls = '') => `<img class="logo ${cls}" src="/logos/${encodeURIComponent(id)}.svg" alt="${h(storeName(id))}" title="${h(storeName(id))}" loading="lazy">`;
function sourceTag(x) {
  if (x.source === 'sample') return '<span class="tag sample" title="Illustrative price, not from the shop">Sample price</span>';
  if (x.source === 'community') return `<span class="tag community" title="Reported by a shopper${x.branch ? ' at ' + h(x.branch) : ''}">Reported by ${h(x.reporter || 'a shopper')}</span>`;
  if ((x.source || '').startsWith('feed:')) return '<span class="tag good">Price feed</span>';
  return '<span class="tag good">From leaflet</span>';
}
async function itemDetail(id) {
  if (!S.items[id]) S.items[id] = await api('/api/items/' + encodeURIComponent(id));
  return S.items[id];
}

// ------------------------------------------------------------------ chrome: account, notice, shop strip
function renderAccountButton() {
  const el = $('#account');
  if (S.user) {
    el.innerHTML = `<a class="btn small" href="#/account" title="My account">👤 ${h(S.user.name.split(' ')[0])}</a>`;
  } else {
    el.innerHTML = '<button class="btn small" type="button" data-signin>Sign in</button>';
  }
  $('#admin-tab').hidden = !(S.user && S.user.is_admin);
}

function renderNotice() {
  const n = $('#notice');
  if (S.meta.sample_data && !sessionStorageGet('nsb.hideSample')) {
    n.innerHTML = `<b>Sample prices:</b> prices tagged <span class="tag sample">Sample price</span> are illustrative, not real shop prices.
      Real prices come from imported leaflets, price feeds and specials reported by shoppers.
      <button class="btn small" type="button" id="hide-notice" style="margin-left:6px">Got it</button>`;
    n.hidden = false;
    $('#hide-notice').onclick = () => { sessionStorageSet('nsb.hideSample', '1'); n.hidden = true; };
  } else n.hidden = true;
}
function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } }

function renderStrip() {
  const strip = $('#store-strip');
  if (S.view !== 'specials') { strip.innerHTML = ''; return; }
  const sel = S.specials.stores;
  strip.classList.toggle('filtering', sel.size > 0);
  strip.innerHTML = S.meta.stores.map((s) => {
    const n = (S.meta.special_counts || {})[s.id] || 0;
    return `<button class="store-pill" type="button" data-store="${h(s.id)}" aria-pressed="${sel.has(s.id)}"
      title="${h(s.name)} · ${h(s.kind)}"><img src="/logos/${encodeURIComponent(s.id)}.svg" alt="${h(s.name)}"><small>${n} special${n === 1 ? '' : 's'}</small></button>`;
  }).join('');
}

// ------------------------------------------------------------------ specials view
function renderSpecials() {
  const f = S.specials;
  const cats = ['', ...S.meta.categories];
  view.innerHTML = `
    <div class="page-head"><div><h1>This week's specials</h1>
      <p class="muted" id="sp-sub">Sales and promotions at ${S.meta.stores.length} Namibian shops. Tap a shop logo above to filter.</p></div></div>
    <div class="toolbar">
      <input type="search" id="sp-q" placeholder="Search specials: maize meal, oil, nappies…" value="${h(f.q)}" aria-label="Search specials">
      <select id="sp-sort" aria-label="Sort">
        ${[['percent', 'Biggest % off'], ['saving', 'Biggest N$ saving'], ['price', 'Lowest price'], ['ending', 'Ending soonest'], ['name', 'A–Z']]
          .map(([v, t]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
    </div>
    <div class="chips" id="sp-cats">${cats.map((c) => `<button class="chip" type="button" data-cat="${h(c)}" aria-pressed="${f.category === c}">${h(c || 'All')}</button>`).join('')}</div>
    <div class="deals" id="sp-grid"><div class="loading">Loading specials…</div></div>
    <div class="more" id="sp-more"></div>`;
  $('#sp-q').addEventListener('input', debounce((e) => { f.q = e.target.value; f.limit = 48; refreshSpecials(); }, 250));
  $('#sp-sort').onchange = (e) => { f.sort = e.target.value; refreshSpecials(); };
  $('#sp-cats').onclick = (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    f.category = b.dataset.cat; f.limit = 48;
    $$('#sp-cats .chip').forEach((c) => c.setAttribute('aria-pressed', c === b));
    refreshSpecials();
  };
  refreshSpecials();
}

async function refreshSpecials() {
  const f = S.specials;
  const p = new URLSearchParams({ q: f.q, category: f.category, sort: f.sort, limit: f.limit });
  if (f.stores.size) p.set('stores', [...f.stores].join(','));
  const grid = $('#sp-grid');
  try {
    f.data = await api('/api/specials?' + p);
  } catch (e) {
    if (grid) grid.innerHTML = `<div class="empty"><b>Couldn't load specials</b>${h(e.message)}</div>`;
    return;
  }
  if (S.view !== 'specials' || !$('#sp-grid')) return;
  const d = f.data;
  const filt = [f.stores.size ? [...f.stores].map(storeName).join(', ') : '', f.category, f.q && `“${f.q}”`].filter(Boolean).join(' · ');
  $('#sp-sub').textContent = `${d.total} special${d.total === 1 ? '' : 's'} running today${filt ? ' · ' + filt : ''}. Tap a shop logo above to filter.`;
  $('#sp-grid').innerHTML = d.results.length ? d.results.map(dealCard).join('')
    : '<div class="empty" style="grid-column:1/-1"><b>No specials match</b>Try another search, category or shop.</div>';
  $('#sp-more').innerHTML = d.total > d.results.length ? `<button class="btn" type="button" id="sp-load">Show more (${d.total - d.results.length} left)</button>` : '';
  const more = $('#sp-load');
  if (more) more.onclick = () => { f.limit += 48; refreshSpecials(); };
}

function dealCard(x, i) {
  return `<article class="deal">
    <div class="deal-top">${logo(x.store_id)}<span class="pct" aria-label="${x.saving_pct} percent off">-${x.saving_pct}%</span></div>
    <div><div class="deal-brand">${h(x.brand)}</div><div class="deal-name">${h(x.name)} <small>${h(x.size)}</small></div></div>
    <div class="deal-price price"><b>${money(x.price)}</b><s class="was">${money(x.regular_price)}</s></div>
    <div class="deal-meta">${h(x.special_label || 'Special')} · ${h(until(x.valid_until))} · save ${money(x.saving)}</div>
    <div class="deal-foot">${sourceTag(x)}<button class="btn small primary" type="button" data-add-deal="${i}">+ Add</button></div>
  </article>`;
}

// ------------------------------------------------------------------ compare view
function renderCompare() {
  const c = S.compare;
  view.innerHTML = `
    <div class="page-head"><div><h1>Compare prices</h1><p class="muted">Search any product to see what it costs at every shop today, specials included.</p></div></div>
    <div class="compare">
      <div>
        <input type="search" id="cmp-q" placeholder="e.g. sugar, Sunfoil, toilet paper, 10kg maize meal" value="${h(c.q)}" aria-label="Search products">
        <div class="chips" style="margin-top:8px" id="cmp-quick">${QUICK.map((q) => `<button class="chip" type="button" data-q="${h(q)}">${h(q)}</button>`).join('')}</div>
        <div class="results" id="cmp-results"></div>
      </div>
      <div class="panel" id="cmp-detail"><div class="empty"><b>Pick a product</b>Its price at each shop will show here, cheapest first.</div></div>
    </div>`;
  const run = async () => {
    const q = c.q.trim();
    if (!q) { c.results = []; drawCompareResults(); return; }
    try {
      const d = await api('/api/search?' + new URLSearchParams({ q, limit: 20 }));
      if (q !== c.q.trim()) return;
      c.results = d.results;
      drawCompareResults();
      if (c.results.length && (!c.item || !c.results.some((r) => r.id === c.item.id))) showItem(c.results[0].id);
    } catch (e) { toast(e.message); }
  };
  $('#cmp-q').addEventListener('input', debounce((e) => { c.q = e.target.value; run(); }, 220));
  $('#cmp-quick').onclick = (e) => {
    const b = e.target.closest('[data-q]');
    if (!b) return;
    c.q = b.dataset.q; $('#cmp-q').value = c.q; c.item = null; run();
  };
  $('#cmp-results').onclick = (e) => { const b = e.target.closest('[data-item]'); if (b) showItem(b.dataset.item); };
  drawCompareResults();
  if (c.item) drawItem(c.item); else if (c.q) run();
}

function drawCompareResults() {
  const c = S.compare;
  const el = $('#cmp-results');
  if (!el) return;
  if (!c.q.trim()) { el.innerHTML = ''; return; }
  el.innerHTML = c.results.length ? c.results.map((r) => `
    <button class="result" type="button" data-item="${h(r.id)}" aria-current="${c.item && c.item.id === r.id}">
      <span><span class="r-name">${h(r.name)}</span> <span class="r-sub">${h(r.size)}</span>
        <span class="r-sub" style="display:block">${h(r.category)} · ${r.n_shops} shop${r.n_shops === 1 ? '' : 's'}${r.n_specials ? ` · <b style="color:var(--red)">${r.n_specials} on special</b>` : ''}</span></span>
      <span class="r-best">${r.best ? `from<b>${money(r.best.price)}</b>${h(r.best.store_name)}` : 'no prices yet'}</span>
    </button>`).join('') : '<div class="empty"><b>Nothing found</b>Try a simpler word, e.g. “oil” or “nappies”.</div>';
}

async function showItem(id) {
  try {
    delete S.items[id];
    S.compare.item = await itemDetail(id);
    drawItem(S.compare.item);
    drawCompareResults();
  } catch (e) { toast(e.message); }
}

function drawItem(it) {
  const el = $('#cmp-detail');
  if (!el) return;
  const best = it.prices[0];
  const rows = it.prices.map((p, i) => `
    <tr class="${p.price === best.price ? 'best' : ''}">
      <td>${logo(p.store_id, 'sm')}</td>
      <td><b>${h(p.brand)}</b><div class="muted hide-sm" style="font-size:.78rem">${sourceTag(p)}</div></td>
      <td class="num price"><b style="${p.on_special ? 'color:var(--red)' : ''}">${money(p.price)}</b>${p.on_special ? `<br><s class="was">${money(p.regular_price)}</s>` : ''}</td>
      <td class="hide-sm">${p.on_special ? `<span class="tag special">-${p.saving_pct}%</span><div class="muted" style="font-size:.75rem">${h(p.special_label || '')} · ${h(until(p.valid_until))}</div>` : '<span class="muted">-</span>'}</td>
      <td class="num hide-sm muted" style="font-size:.8rem">${money(p.unit_price)} ${h(p.unit_label)}</td>
      <td class="num"><button class="btn small" type="button" data-add-price="${i}" aria-label="Add ${h(p.brand)} to cart">+</button></td>
    </tr>`).join('');
  el.innerHTML = `
    <div class="row between" style="align-items:flex-start">
      <div><h2 style="margin:0">${h(it.name)} <span class="muted">${h(it.size)}</span></h2><div class="muted">${h(it.category)} · ${it.prices.length} price${it.prices.length === 1 ? '' : 's'} at ${new Set(it.prices.map((p) => p.store_id)).size} shops</div></div>
      <button class="btn primary" type="button" id="add-any">+ Add to cart (any brand)</button>
    </div>
    ${best ? `<div class="alert ok">Cheapest today: <b>${money(best.price)}</b> for ${h(best.brand)} at <b>${h(best.store_name)}</b>${best.on_special ? ' (on special)' : ''}.
      ${it.prices.length > 1 ? `The priciest is ${money(it.prices[it.prices.length - 1].price)}.` : ''}</div>` : '<div class="empty">No shop has a price for this yet.</div>'}
    ${rows ? `<div style="overflow-x:auto"><table class="prices"><thead><tr><th>Shop</th><th>Brand</th><th class="num">Price</th><th class="hide-sm">Special</th><th class="num hide-sm">Unit price</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}`;
  $('#add-any').onclick = () => addToCart({ item_id: it.id, name: it.name, size: it.size });
  el.querySelector('tbody')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-add-price]');
    if (!b) return;
    const p = it.prices[+b.dataset.addPrice];
    addToCart({ item_id: it.id, product_id: p.product_id, name: it.name, size: it.size, brand: p.brand });
  });
}

// ------------------------------------------------------------------ cart view
function attachSuggest(input, box, onPick) {
  let items = [], hl = -1;
  const close = () => { box.hidden = true; box.innerHTML = ''; hl = -1; };
  const draw = () => {
    box.innerHTML = items.length ? items.map((it, i) => `<button type="button" data-i="${i}" class="${i === hl ? 'hl' : ''}">
        <span><b>${h(it.name)}</b> <small>${h(it.size)}</small></span><small>${it.best ? 'from ' + money(it.best.price) : 'no prices yet'}</small></button>`).join('')
      : '<div class="empty" style="padding:12px">No match. Try another word.</div>';
    box.hidden = false;
  };
  const fetchItems = debounce(async (q) => {
    try {
      const d = await api('/api/search?' + new URLSearchParams({ q, limit: 8 }));
      if (input.value.trim() !== q) return;
      items = d.results; hl = items.length ? 0 : -1; draw();
    } catch { /* ignore */ }
  }, 180);
  const pick = (i) => { const it = items[i]; if (!it) return; close(); input.value = ''; onPick(it); };
  input.addEventListener('input', () => { const q = input.value.trim(); if (q.length < 2) { close(); return; } fetchItems(q); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault();
    if (box.hidden || !items.length) return;
    if (e.key === 'ArrowDown') { hl = Math.min(items.length - 1, hl + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { hl = Math.max(0, hl - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter') pick(hl < 0 ? 0 : hl);
    else if (e.key === 'Escape') close();
  });
  box.addEventListener('mousedown', (e) => { const b = e.target.closest('button[data-i]'); if (b) { e.preventDefault(); pick(+b.dataset.i); } });
  input.addEventListener('blur', () => setTimeout(close, 150));
}

function renderCart() {
  const c = S.cart;
  const budget = c.mode === 'budget';
  view.innerHTML = `
    <div class="page-head"><div><h1>My cart</h1><p class="muted">Add what you need. We work out where to buy each item so you pay the least.</p></div>
      ${c.lines.length ? '<button class="btn small" type="button" id="cart-clear">Clear cart</button>' : ''}</div>
    <div class="mode" role="group" aria-label="Cart type">
      <button type="button" data-mode="cheapest" aria-pressed="${!budget}"><b>🧮 Cheapest cart</b><span>Everything on your list for the lowest total price.</span></button>
      <button type="button" data-mode="budget" aria-pressed="${budget}"><b>💰 Fit my budget</b><span>Set a budget and priorities. We fill the cart with what matters most.</span></button>
    </div>
    <div class="cart-layout">
      <section class="panel" aria-labelledby="h-items">
        <h2 id="h-items">1. What do you need?</h2>
        <div class="addbox"><input type="search" id="add-q" placeholder="Add an item: bread, maize meal, soap…" autocomplete="off" aria-label="Add an item">
          <div class="suggest" id="add-suggest" hidden></div></div>
        <details class="paste" ${c.lines.length ? '' : 'open'}><summary>📝 Type or paste a whole list</summary>
          <textarea id="paste-text" placeholder="One item per line, e.g.&#10;2 x bread&#10;maize meal 10kg&#10;cooking oil&#10;18 eggs&#10;washing powder"></textarea>
          <button class="btn" type="button" id="paste-go">Match items</button>
          <div id="parsed"></div>
        </details>
        <ul class="lines" id="lines"></ul>
        ${budget ? '<p class="muted" style="font-size:.82rem;margin:.6rem 0 0"><b>Must have</b> items are always bought. Others are added by priority until the budget runs out. Extra units count for less than the first one.</p>' : ''}
      </section>
      <section class="panel" aria-labelledby="h-opts">
        <h2 id="h-opts">2. Where and how?</h2>
        <div class="opt-title">Shops you can get to</div>
        <div class="row" style="margin-bottom:6px">
          <button class="btn small" type="button" data-shops="all">All shops</button>
          ${S.user && S.user.stores.length ? '<button class="btn small" type="button" data-shops="mine">My shops</button>' : ''}
          <button class="btn small" type="button" data-shops="none">None</button>
        </div>
        <div class="store-toggles" id="cart-shops">${S.meta.stores.map((s) => `<button class="store-toggle" type="button" data-store="${h(s.id)}" aria-pressed="${!c.stores || c.stores.includes(s.id)}" title="${h(s.name)}"><img class="logo" src="/logos/${encodeURIComponent(s.id)}.svg" alt="${h(s.name)}"></button>`).join('')}</div>
        <div class="opt-title">How many shops will you visit?</div>
        <div class="seg" id="max-stores">${[[0, 'Any number'], [1, 'Just 1'], [2, 'Up to 2'], [3, 'Up to 3']].map(([v, t]) => `<button type="button" data-v="${v}" aria-pressed="${(c.maxStores || 0) === v}">${t}</button>`).join('')}</div>
        <div class="field-row" style="margin-top:12px">
          <label>Travel cost per shop <span class="muted">(taxi/fuel)</span>
            <div class="money-input"><span>N$</span><input type="number" id="trip" min="0" max="5000" step="1" inputmode="decimal" value="${h(c.tripCost || 0)}"></div></label>
          ${budget ? `<label>My budget
            <div class="money-input"><span>N$</span><input type="number" id="budget" min="1" max="1000000" step="10" inputmode="decimal" value="${h(c.budget)}"></div></label>` : ''}
        </div>
        ${budget ? `<div class="chips" id="budget-quick" style="margin:-4px 0 12px">${[200, 500, 1000, 1500, 2500].map((v) => `<button class="chip" type="button" data-b="${v}">N$${v.toLocaleString('en-US')}</button>`).join('')}</div>` : ''}
        <button class="btn primary big" type="button" id="build">${budget ? '💰 Build my budget cart' : '🧮 Find my cheapest cart'}</button>
        <p class="form-error" id="build-error"></p>
      </section>
    </div>
    <div class="result-wrap" id="result"></div>`;

  // events
  $$('.mode button').forEach((b) => b.onclick = () => { c.mode = b.dataset.mode; S.result = null; saveCart(); renderCart(); });
  const clear = $('#cart-clear');
  if (clear) clear.onclick = () => { if (confirm('Remove everything from your cart?')) { Object.assign(c, { lines: [], listId: null, listName: '' }); S.result = null; saveCart(); renderCart(); } };
  attachSuggest($('#add-q'), $('#add-suggest'), (it) => { addToCart({ item_id: it.id, name: it.name, size: it.size }, 1, true); drawLines(); });
  $('#paste-go').onclick = parsePaste;
  $('#lines').addEventListener('click', onLineClick);
  $('#lines').addEventListener('change', onLineChange);
  $('#cart-shops').onclick = (e) => {
    const b = e.target.closest('[data-store]');
    if (!b) return;
    const all = S.meta.stores.map((s) => s.id);
    let sel = c.stores ? [...c.stores] : all;
    sel = sel.includes(b.dataset.store) ? sel.filter((x) => x !== b.dataset.store) : [...sel, b.dataset.store];
    c.stores = sel.length === all.length ? null : sel;
    b.setAttribute('aria-pressed', !c.stores || c.stores.includes(b.dataset.store));
    markStale();
  };
  $$('[data-shops]').forEach((b) => b.onclick = () => {
    const k = b.dataset.shops;
    c.stores = k === 'all' ? null : k === 'none' ? [] : [...S.user.stores];
    $$('#cart-shops [data-store]').forEach((t) => t.setAttribute('aria-pressed', !c.stores || c.stores.includes(t.dataset.store)));
    markStale();
  });
  $('#max-stores').onclick = (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    c.maxStores = +b.dataset.v;
    $$('#max-stores button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    markStale();
  };
  $('#trip').oninput = (e) => { c.tripCost = Math.max(0, +e.target.value || 0); markStale(); };
  if (budget) {
    $('#budget').oninput = (e) => { c.budget = Math.max(0, +e.target.value || 0); markStale(); };
    $('#budget-quick').onclick = (e) => { const b = e.target.closest('[data-b]'); if (b) { c.budget = +b.dataset.b; $('#budget').value = c.budget; markStale(); } };
  }
  $('#build').onclick = buildCart;

  drawLines();
  loadLineDetails();
  if (S.result) drawResult();
}

function markStale() {
  saveCart();
  if (S.result && !S.stale) { S.stale = true; drawResult(); }
}

function drawLines() {
  const c = S.cart;
  const el = $('#lines');
  if (!el) return;
  const budget = c.mode === 'budget';
  if (!c.lines.length) {
    el.innerHTML = '<li class="empty"><b>Your cart is empty</b>Search above, paste a list, or add specials from the Specials page.</li>';
    updateCartCount();
    return;
  }
  el.innerHTML = c.lines.map((l) => {
    const det = S.items[l.item_id];
    const brands = det ? det.products : (l.product_id ? [{ id: l.product_id, brand: l.brand }] : []);
    const opts = '<option value="">Any brand (cheapest)</option>' + brands.map((p) => `<option value="${h(p.id)}" ${p.id === l.product_id ? 'selected' : ''}>${h(p.brand)}</option>`).join('');
    return `<li class="line" data-key="${h(l.key)}">
      <div class="line-name">${h(l.name)} <small>${h(l.size)}</small></div>
      <button class="btn small danger" type="button" data-act="remove" aria-label="Remove ${h(l.name)}">✕</button>
      <div class="line-ctrls">
        <div class="stepper"><button type="button" data-act="dec" aria-label="One less">−</button><span aria-live="polite">${l.qty}</span><button type="button" data-act="inc" aria-label="One more">+</button></div>
        <select data-act="brand" aria-label="Brand for ${h(l.name)}">${opts}</select>
        ${budget ? `<select data-act="prio" class="prio ${h(l.priority)}" aria-label="Priority for ${h(l.name)}">${PRIOS.map(([v, t]) => `<option value="${v}" ${l.priority === v ? 'selected' : ''}>${t}</option>`).join('')}</select>` : ''}
      </div></li>`;
  }).join('');
  updateCartCount();
}

async function loadLineDetails() {
  const missing = [...new Set(S.cart.lines.map((l) => l.item_id))].filter((id) => !S.items[id]);
  if (!missing.length) return;
  await Promise.allSettled(missing.map(itemDetail));
  if (S.view === 'cart') drawLines();
}

function lineFor(el) { const li = el.closest('[data-key]'); return li && S.cart.lines.find((l) => l.key === li.dataset.key); }
function onLineClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b || b.tagName === 'SELECT') return;
  const l = lineFor(b);
  if (!l) return;
  if (b.dataset.act === 'inc') l.qty = Math.min(99, l.qty + 1);
  if (b.dataset.act === 'dec') l.qty = Math.max(1, l.qty - 1);
  if (b.dataset.act === 'remove') S.cart.lines = S.cart.lines.filter((x) => x !== l);
  drawLines();
  markStale();
}
function onLineChange(e) {
  const l = lineFor(e.target);
  if (!l) return;
  if (e.target.dataset.act === 'brand') {
    l.product_id = e.target.value || null;
    const det = S.items[l.item_id];
    l.brand = l.product_id && det ? (det.products.find((p) => p.id === l.product_id) || {}).brand : null;
  }
  if (e.target.dataset.act === 'prio') { l.priority = e.target.value; e.target.className = 'prio ' + l.priority; }
  markStale();
}

async function parsePaste() {
  const text = $('#paste-text').value.trim();
  const out = $('#parsed');
  if (!text) { out.innerHTML = '<p class="muted">Type a few items first.</p>'; return; }
  let d;
  try { d = await api('/api/parse-list', { body: { text } }); } catch (e) { out.innerHTML = `<p class="form-error">${h(e.message)}</p>`; return; }
  const lines = d.lines;
  out.innerHTML = `<div class="parsed">${lines.map((l, i) => {
    const choices = [l.item, ...l.alternatives].filter(Boolean);
    return `<div><span style="min-width:2.2em;font-weight:700">${l.qty}×</span>
      ${choices.length ? `<select data-i="${i}" aria-label="Match for ${h(l.text)}">${choices.map((c) => `<option value="${h(c.id)}">${h(c.name)} ${h(c.size)}</option>`).join('')}<option value="">Skip “${h(l.text)}”</option></select>`
        : `<span class="muted">No match for “${h(l.text)}”. Try the search box.</span>`}</div>`;
  }).join('')}</div>
    <button class="btn green" type="button" id="paste-add">Add ${lines.filter((l) => l.item).length} items to cart</button>`;
  $('#paste-add').onclick = () => {
    let n = 0;
    lines.forEach((l, i) => {
      const sel = $(`#parsed select[data-i="${i}"]`);
      const id = sel ? sel.value : '';
      if (!id) return;
      const choice = [l.item, ...l.alternatives].find((c) => c && c.id === id);
      addToCart({ item_id: choice.id, name: choice.name, size: choice.size }, l.qty, true);
      n++;
    });
    toast(`Added ${n} item${n === 1 ? '' : 's'} to your cart`);
    $('#paste-text').value = '';
    out.innerHTML = '';
    $('details.paste').open = false;
    drawLines();
    loadLineDetails();
  };
}

async function buildCart() {
  const c = S.cart;
  const err = $('#build-error');
  err.textContent = '';
  if (!c.lines.length) { err.textContent = 'Add some items first.'; return; }
  if (c.stores && !c.stores.length) { err.textContent = 'Pick at least one shop.'; return; }
  if (c.mode === 'budget' && !(c.budget > 0)) { err.textContent = 'Enter your budget.'; return; }
  const btn = $('#build');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Working out the best cart…';
  try {
    S.result = await api('/api/cart/optimize', { body: {
      lines: c.lines.map((l) => ({ key: l.key, item_id: l.item_id, product_id: l.product_id, qty: l.qty, priority: c.mode === 'budget' ? l.priority : 'high' })),
      stores: c.stores, max_stores: c.maxStores || null, trip_cost: +c.tripCost || 0,
      budget: c.mode === 'budget' ? +c.budget : null,
    } });
    S.stale = false;
    drawResult();
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    err.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function drawResult() {
  const r = S.result;
  const el = $('#result');
  if (!el || !r) return;
  const lineName = (x) => `${x.brand ? h(x.brand) + ' ' : ''}${h(x.name)} <span class="muted">${h(x.size)}</span>`;
  let html = '';
  if (S.stale) html += '<div class="alert warn">Your list or options changed. Tap the build button again to update this plan.</div>';
  if (r.status === 'over_budget') {
    el.innerHTML = html + `<div class="alert bad"><b>Over budget.</b> ${h(r.message)}</div>`;
    return;
  }
  const nStores = r.stores.length;
  const tiles = [
    `<div class="tile hl"><small>${r.mode === 'budget' ? 'Cart total' : 'Cheapest total'}</small><b>${money(r.total)}</b>${r.travel ? `<span style="font-size:.8rem">incl. ${money(r.travel)} travel</span>` : `<span style="font-size:.8rem">${r.items_bought} item${r.items_bought === 1 ? '' : 's'}</span>`}</div>`,
    `<div class="tile good"><small>Specials save you</small><b>${money(r.special_savings)}</b></div>`,
    `<div class="tile"><small>Shops to visit</small><b>${nStores}</b></div>`,
  ];
  if (r.mode === 'budget') tiles.push(`<div class="tile ${r.budget_left >= 0 ? 'good' : ''}"><small>Left from ${money(r.budget)}</small><b>${money(r.budget_left)}</b></div>`);
  else if (r.saving_vs_best_single > 0.005) tiles.push(`<div class="tile good"><small>vs all at ${h(r.best_single.store_name)}</small><b>${money(r.saving_vs_best_single)}</b><span style="font-size:.8rem">cheaper</span></div>`);
  html += `<h2>Your best cart</h2><div class="tiles">${tiles.join('')}</div>`;

  if (r.mode === 'budget' && !r.left_out.length && r.status !== 'empty') html += '<div class="alert ok">Everything on your list fits your budget.</div>';
  if (r.left_out.length) html += `<div class="alert warn"><b>${r.left_out.length} item${r.left_out.length === 1 ? '' : 's'} didn't fit your budget.</b> See the list below.</div>`;
  if (r.not_covered.length) html += `<div class="alert warn"><b>Not available within ${r.max_stores} shop${r.max_stores === 1 ? '' : 's'}:</b> ${r.not_covered.map((x) => h(x.name + ' ' + x.size)).join(', ')}. Allow more shops to include them.</div>`;
  if (r.unavailable.length) html += `<div class="alert warn"><b>Not sold at your selected shops:</b> ${r.unavailable.map((x) => h(x.name + ' ' + x.size) + (x.brand ? ` (${h(x.brand)})` : '')).join(', ')}. Try “Any brand” or more shops.</div>`;

  if (r.comparison.length) {
    const max = Math.max(...r.comparison.map((x) => x.total), r.items_total);
    const cheapest = r.comparison[0];
    html += `<h3>${r.mode === 'budget' ? 'Your full list at each shop' : 'What your list costs at each shop'}</h3><div class="bars">
      ${nStores > 1 || r.mode === 'budget' ? `<div class="bar smart"><div style="font-weight:800;font-size:.8rem">This plan</div><div class="bar-track"><div class="bar-fill" style="width:${(100 * r.items_total / max).toFixed(1)}%"></div><span class="bar-label">${nStores} shop${nStores === 1 ? '' : 's'}</span></div><div class="bar-val">${money(r.items_total)}</div></div>` : ''}
      ${r.comparison.slice(0, 12).map((x) => `<div class="bar ${x === cheapest ? 'cheapest' : ''}">${logo(x.store_id)}<div class="bar-track"><div class="bar-fill" style="width:${(100 * x.total / max).toFixed(1)}%"></div>${x === cheapest ? '<span class="bar-label">cheapest single shop</span>' : ''}</div>
        <div class="bar-val">${money(x.total)}${x.missing ? `<small>${x.missing} item${x.missing === 1 ? '' : 's'} missing</small>` : ''}</div></div>`).join('')}
    </div><p class="muted" style="font-size:.8rem">Shop totals are for the items each shop stocks, before travel costs.</p>`;
  }

  if (nStores) {
    html += `<h3>Your shopping plan</h3><div class="plans">${r.stores.map((s) => `
      <section class="plan"><div class="plan-head">${logo(s.store_id, 'lg')}<div style="text-align:right"><b>${money(s.subtotal)}</b>${s.savings ? `<div class="tag good">saves ${money(s.savings)}</div>` : ''}</div></div>
        <ul>${s.items.map((x) => `<li><input type="checkbox" aria-label="Got ${h(x.name)}"><div><div class="pl-name">${x.qty} × ${lineName(x)}</div>
          <div class="pl-sub">${x.on_special ? `<span class="tag special">${h(x.special_label || 'Special')}</span> ${h(until(x.valid_until))}` : `${money(x.unit_price)} each`}${x.source === 'sample' ? ' · sample price' : ''}</div></div>
          <div class="pl-price">${money(x.line_total)}${x.on_special ? `<small><s>${money(x.regular_price * x.qty)}</s></small>` : ''}</div></li>`).join('')}</ul></section>`).join('')}</div>`;
  }

  if (r.left_out.length) {
    html += `<h3>Didn't fit your budget</h3><div class="panel leftout"><ul>${r.left_out.map((x) => `<li><span>${x.wanted - x.bought} × ${h(x.name)} <span class="muted">${h(x.size)}</span> <span class="tag">${h((PRIOS.find((p) => p[0] === x.priority) || [, ''])[1])}</span></span>
      <span class="muted">about ${money(x.extra_needed)} more</span></li>`).join('')}</ul></div>`;
  }

  html += `<div class="actions">
      <button class="btn primary" type="button" id="save-list">💾 ${S.cart.listId ? 'Update saved list' : 'Save this list'}</button>
      <a class="btn green" id="wa" target="_blank" rel="noopener">📲 Send to WhatsApp</a>
      <button class="btn" type="button" id="copy-plan">📋 Copy</button>
      <button class="btn" type="button" onclick="window.print()">🖨️ Print</button>
    </div><div id="save-box"></div>`;
  el.innerHTML = html;
  $('#wa').href = 'https://wa.me/?text=' + encodeURIComponent(planText(r));
  $('#copy-plan').onclick = async () => {
    try { await navigator.clipboard.writeText(planText(r)); toast('Shopping plan copied'); } catch { toast("Couldn't copy. Try Print instead."); }
  };
  $('#save-list').onclick = saveListPrompt;
  el.querySelectorAll('.plan input[type=checkbox]').forEach((cb) => cb.onchange = () => cb.closest('li').classList.toggle('done', cb.checked));
}

function planText(r) {
  const out = [`🛒 Smart Basket plan: ${money(r.total)}${r.travel ? ` (incl. ${money(r.travel)} travel)` : ''}`];
  r.stores.forEach((s) => {
    out.push('', `🏪 ${s.store_name}: ${money(s.subtotal)}`);
    s.items.forEach((x) => out.push(`• ${x.qty} × ${x.brand ? x.brand + ' ' : ''}${x.name} ${x.size}: ${money(x.line_total)}${x.on_special ? ' (special)' : ''}`));
  });
  if (r.special_savings) out.push('', `Specials save ${money(r.special_savings)}.`);
  if (r.left_out.length) out.push('', 'Left out (budget): ' + r.left_out.map((x) => x.name).join(', '));
  return out.join('\n');
}

function saveListPrompt() {
  if (!S.user) { openAuth('login', 'Sign in to save your lists.'); return; }
  const box = $('#save-box');
  const def = S.cart.listName || `Shopping ${fmtDate(S.meta.today, { day: 'numeric', month: 'short' })}`;
  box.innerHTML = `<form class="row" id="save-form" style="margin-top:10px;max-width:520px"><input id="list-name" maxlength="60" value="${h(def)}" aria-label="List name" style="flex:1">
    <button class="btn primary" type="submit">Save</button>${S.cart.listId ? '<button class="btn" type="button" id="save-new">Save as new</button>' : ''}</form>`;
  const doSave = async (asNew) => {
    const name = $('#list-name').value.trim() || def;
    const c = S.cart;
    const data = { lines: c.lines, mode: c.mode, budget: c.budget, maxStores: c.maxStores, tripCost: c.tripCost, stores: c.stores, total: S.result ? S.result.total : null };
    try {
      const saved = c.listId && !asNew ? await api('/api/lists/' + c.listId, { method: 'PUT', body: { name, data } })
        : await api('/api/lists', { body: { name, data } });
      c.listId = saved.id; c.listName = saved.name; saveCart();
      box.innerHTML = '';
      $('#save-list').textContent = '💾 Update saved list';
      toast(`Saved “${saved.name}”`);
    } catch (e) { toast(e.message); }
  };
  $('#save-form').onsubmit = (e) => { e.preventDefault(); doSave(false); };
  const sn = $('#save-new');
  if (sn) sn.onclick = () => doSave(true);
  $('#list-name').focus();
}

// ------------------------------------------------------------------ lists view
function needSignIn(title, why) {
  view.innerHTML = `<div class="page-head"><div><h1>${h(title)}</h1></div></div>
    <div class="panel empty"><b>Sign in to use this</b>${h(why)}<div style="margin-top:12px" class="row" ><span style="flex:1"></span>
    <button class="btn primary" type="button" data-signin>Sign in</button><button class="btn" type="button" data-register>Create a free account</button><span style="flex:1"></span></div></div>`;
}

async function renderLists() {
  if (!S.user) { needSignIn('My lists', 'Save shopping lists and budgets, then reload them any week to see the latest best cart.'); return; }
  view.innerHTML = '<div class="page-head"><div><h1>My lists</h1><p class="muted">Open a saved list to rebuild it with this week\'s prices.</p></div></div><div class="cards" id="lists"><div class="loading">Loading…</div></div>';
  let d;
  try { d = await api('/api/lists'); } catch (e) { $('#lists').innerHTML = `<div class="empty">${h(e.message)}</div>`; return; }
  const el = $('#lists');
  if (!el) return;
  el.innerHTML = d.lists.length ? d.lists.map((l) => {
    const items = (l.data.lines || []).length;
    return `<article class="card" data-id="${l.id}"><div class="row between"><b>${h(l.name)}</b><span class="tag">${l.data.mode === 'budget' ? 'Budget ' + money(l.data.budget) : 'Cheapest'}</span></div>
      <div class="muted" style="font-size:.85rem">${items} item${items === 1 ? '' : 's'}${l.data.total ? ' · last total ' + money(l.data.total) : ''} · saved ${h(fmtDate(l.updated_at))}</div>
      <div class="muted" style="font-size:.85rem">${h((l.data.lines || []).slice(0, 6).map((x) => x.name).join(', '))}${items > 6 ? '…' : ''}</div>
      <div class="row" style="margin-top:auto"><button class="btn primary small" type="button" data-open>Open in cart</button><button class="btn small danger" type="button" data-del>Delete</button></div></article>`;
  }).join('') : '<div class="panel empty" style="grid-column:1/-1"><b>No saved lists yet</b>Build a cart and tap “Save this list”.</div>';
  el.onclick = async (e) => {
    const card = e.target.closest('[data-id]');
    if (!card) return;
    const l = d.lists.find((x) => String(x.id) === card.dataset.id);
    if (e.target.closest('[data-open]')) {
      S.cart = { ...defaultCart(), ...l.data, listId: l.id, listName: l.name };
      delete S.cart.total;
      S.result = null; saveCart();
      location.hash = '#/cart';
    } else if (e.target.closest('[data-del]') && confirm(`Delete “${l.name}”?`)) {
      try { await api('/api/lists/' + l.id, { method: 'DELETE' }); if (S.cart.listId === l.id) { S.cart.listId = null; saveCart(); } renderLists(); } catch (err) { toast(err.message); }
    }
  };
}

// ------------------------------------------------------------------ report a special
async function renderReport() {
  view.innerHTML = `<div class="page-head"><div><h1>Report a special</h1><p class="muted">Saw a good price in a shop or leaflet? Share it so other shoppers save too.</p></div></div>
    <div class="two"><div id="report-form"></div><div><h2>Recently reported</h2><div class="feed" id="recent"><div class="loading">Loading…</div></div></div></div>`;
  const formBox = $('#report-form');
  if (!S.user) {
    formBox.innerHTML = `<div class="panel empty"><b>Sign in to report specials</b>A free account lets you report specials, save lists and choose your shops.
      <div class="row" style="justify-content:center;margin-top:12px"><button class="btn primary" type="button" data-signin>Sign in</button><button class="btn" type="button" data-register>Create account</button></div></div>`;
  } else drawReportForm(formBox);
  try {
    const d = await api('/api/reports/recent?limit=20');
    const el = $('#recent');
    if (!el) return;
    el.innerHTML = d.reports.length ? d.reports.map((r) => `<div class="feed-item">${logo(r.store_id, 'sm')}
      <div><b>${h(r.brand)} ${h(r.name)}</b> <span class="muted">${h(r.size)}</span><div class="muted" style="font-size:.8rem">${h(r.label || 'Special')} · until ${h(fmtDate(r.valid_until))} · by ${h(r.reporter)}${r.branch ? ' · ' + h(r.branch) : ''}</div></div>
      <div class="price" style="text-align:right"><b style="color:var(--red)">${money(r.special_price)}</b>${r.price ? `<br><s class="was">${money(r.price)}</s>` : ''}</div></div>`).join('')
      : '<div class="panel empty"><b>No reports yet</b>Be the first to share a special.</div>';
  } catch { /* ignore */ }
}

function drawReportForm(box) {
  const st = { store: null, item: null };
  box.innerHTML = `<form class="panel" id="rep" novalidate>
    <div class="opt-title">Shop</div>
    <div class="store-toggles pick" id="rep-shops" role="group" aria-label="Shop">${S.meta.stores.map((s) => `<button class="store-toggle" type="button" data-store="${h(s.id)}" aria-pressed="false" title="${h(s.name)}"><img class="logo" src="/logos/${encodeURIComponent(s.id)}.svg" alt="${h(s.name)}"></button>`).join('')}</div>
    <label style="margin-top:12px">Product
      <div class="addbox"><input type="search" id="rep-q" placeholder="Search: maize meal, Sunfoil…" autocomplete="off"><div class="suggest" id="rep-suggest" hidden></div></div>
      <div id="rep-picked"></div></label>
    <div id="rep-brand"></div>
    <div class="field-row">
      <label>Special price<div class="money-input"><span>N$</span><input type="number" id="rep-special" min="0.01" step="0.01" inputmode="decimal" required></div></label>
      <label>Normal price <span class="muted">(if shown)</span><div class="money-input"><span>N$</span><input type="number" id="rep-price" min="0.01" step="0.01" inputmode="decimal"></div></label>
    </div>
    <div class="field-row">
      <label>Deal name <span class="muted">(optional)</span><input id="rep-label" maxlength="60" placeholder="e.g. Weekend special"></label>
      <label>Ends on<input type="date" id="rep-until" value="${addDays(S.meta.today, 6)}" min="${S.meta.today}" max="${addDays(S.meta.today, 62)}"></label>
    </div>
    <label>Branch / town <span class="muted">(optional)</span><input id="rep-branch" maxlength="60" list="towns" value="${h(S.user.town || '')}"></label>
    <p class="form-error" id="rep-error" role="alert"></p>
    <button class="btn primary big" type="submit">📣 Share this special</button></form>`;
  $('#rep-shops').onclick = (e) => {
    const b = e.target.closest('[data-store]');
    if (!b) return;
    st.store = b.dataset.store;
    $$('#rep-shops [data-store]').forEach((x) => x.setAttribute('aria-pressed', x === b));
  };
  attachSuggest($('#rep-q'), $('#rep-suggest'), async (it) => {
    st.item = it;
    $('#rep-picked').innerHTML = `<div class="picked"><span>${h(it.name)} <span class="muted">${h(it.size)}</span></span><button class="btn small" type="button" id="rep-unpick">Change</button></div>`;
    $('#rep-q').hidden = true;
    $('#rep-unpick').onclick = () => { st.item = null; $('#rep-picked').innerHTML = ''; $('#rep-brand').innerHTML = ''; $('#rep-q').hidden = false; $('#rep-q').focus(); };
    const det = await itemDetail(it.id);
    $('#rep-brand').innerHTML = `<label>Brand<select id="rep-brand-sel">${det.products.map((p) => `<option value="${h(p.id)}">${h(p.brand)}</option>`).join('')}<option value="__other">Other brand…</option></select></label>
      <label id="rep-other" hidden>Brand name<input id="rep-other-in" maxlength="40"></label>`;
    $('#rep-brand-sel').onchange = (e) => { $('#rep-other').hidden = e.target.value !== '__other'; };
  });
  $('#rep').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#rep-error');
    err.textContent = '';
    if (!st.store) { err.textContent = 'Pick the shop.'; return; }
    if (!st.item) { err.textContent = 'Pick the product.'; return; }
    const sel = $('#rep-brand-sel');
    const special = parseFloat($('#rep-special').value);
    const price = parseFloat($('#rep-price').value);
    if (!(special > 0)) { err.textContent = 'Enter the special price.'; return; }
    const body = { store_id: st.store, special_price: special, price: price > 0 ? price : null, label: $('#rep-label').value.trim() || null,
      valid_until: $('#rep-until').value || null, branch: $('#rep-branch').value.trim() || null };
    if (sel && sel.value !== '__other') body.product_id = sel.value;
    else { body.item_id = st.item.id; body.brand = ($('#rep-other-in') || {}).value || ''; }
    try {
      await api('/api/reports', { body });
      toast('Thanks! Your special is live.');
      delete S.items[st.item.id];
      renderReport();
    } catch (ex) { err.textContent = ex.message; }
  };
}

// ------------------------------------------------------------------ account
function renderAccountPage() {
  if (!S.user) { needSignIn('My account', 'Create a free account to save lists, choose your shops and report specials.'); return; }
  const u = S.user;
  view.innerHTML = `<div class="page-head"><div><h1>My account</h1><p class="muted">${h(u.email)}${u.is_admin ? ' · admin' : ''}</p></div>
      <button class="btn" type="button" id="logout">Sign out</button></div>
    <div class="two">
      <form class="panel" id="profile"><h2>Profile</h2>
        <label>Name<input name="name" maxlength="60" value="${h(u.name)}"></label>
        <label>Town<input name="town" maxlength="60" list="towns" value="${h(u.town)}"></label>
        <button class="btn primary" type="submit">Save</button></form>
      <form class="panel" id="myshops"><h2>My shops</h2><p class="muted" style="margin-top:-6px">Shops you can get to. “My shops” in the cart uses these.</p>
        <div class="store-toggles">${S.meta.stores.map((s) => `<button class="store-toggle" type="button" data-store="${h(s.id)}" aria-pressed="${u.stores.includes(s.id)}" title="${h(s.name)}"><img class="logo" src="/logos/${encodeURIComponent(s.id)}.svg" alt="${h(s.name)}"></button>`).join('')}</div>
        <button class="btn primary" type="submit" style="margin-top:12px">Save my shops</button></form>
      <form class="panel" id="pw"><h2>Change password</h2>
        <label>Current password<input type="password" name="old" autocomplete="current-password"></label>
        <label>New password<input type="password" name="new" autocomplete="new-password" minlength="8"></label>
        <button class="btn" type="submit">Change password</button></form>
      <div class="panel"><h2>Delete account</h2><p class="muted">Removes your account and saved lists. Specials you reported stay, without your name.</p>
        <button class="btn danger" type="button" id="del-acc">Delete my account</button></div>
    </div>`;
  const picked = new Set(u.stores);
  $('#myshops .store-toggles').onclick = (e) => {
    const b = e.target.closest('[data-store]');
    if (!b) return;
    picked.has(b.dataset.store) ? picked.delete(b.dataset.store) : picked.add(b.dataset.store);
    b.setAttribute('aria-pressed', picked.has(b.dataset.store));
  };
  $('#myshops').onsubmit = async (e) => { e.preventDefault(); try { S.user = await api('/api/me', { method: 'PATCH', body: { stores: [...picked] } }); toast('Your shops are saved'); } catch (x) { toast(x.message); } };
  $('#profile').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { S.user = await api('/api/me', { method: 'PATCH', body: { name: f.get('name'), town: f.get('town') } }); renderAccountButton(); toast('Profile saved'); } catch (x) { toast(x.message); }
  };
  $('#pw').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api('/api/me/password', { body: { old: f.get('old'), new: f.get('new') } }); e.target.reset(); toast('Password changed'); } catch (x) { toast(x.message); }
  };
  $('#logout').onclick = async () => { await api('/api/auth/logout', { body: {} }).catch(() => {}); S.user = null; renderAccountButton(); toast('Signed out'); location.hash = '#/specials'; };
  $('#del-acc').onclick = async () => {
    if (!confirm('Delete your account and saved lists? This cannot be undone.')) return;
    try { await api('/api/me', { method: 'DELETE' }); S.user = null; renderAccountButton(); toast('Account deleted'); location.hash = '#/specials'; } catch (x) { toast(x.message); }
  };
}

// ------------------------------------------------------------------ admin
async function renderAdmin() {
  if (!S.user || !S.user.is_admin) { view.innerHTML = '<div class="panel empty"><b>Admins only</b>Ask the site owner to run <code>python -m namshop make-admin you@example.com</code>.</div>'; return; }
  view.innerHTML = '<div class="page-head"><div><h1>Admin</h1><p class="muted">Load this week\'s leaflets and keep prices fresh.</p></div></div><div id="admin"><div class="loading">Loading…</div></div>';
  let d;
  try { d = await api('/api/admin/summary'); } catch (e) { $('#admin').innerHTML = `<div class="empty">${h(e.message)}</div>`; return; }
  const fs = d.feeds_status || {};
  $('#admin').innerHTML = `<div class="two">
    <form class="panel" id="imp"><h2>Import prices &amp; specials</h2>
      <p class="muted" style="margin-top:-6px">CSV or JSON. Columns: <code>store, item, size, brand, price, special_price, special_label, valid_until</code> (also accepts <code>product_id</code> or <code>item_id</code>). Rows replace the current price for that shop and product.</p>
      <label>File<input type="file" id="imp-file" accept=".csv,.json,.txt,text/csv,application/json"></label>
      <label>…or paste<textarea id="imp-text" rows="7" placeholder="store,item,size,brand,price,special_price,special_label,valid_until&#10;Shoprite,Super maize meal,10kg,Top Score,139.99,109.99,Weekly special,${addDays(S.meta.today, 5)}"></textarea></label>
      <label>Shop for rows without a store column<select id="imp-store"><option value="">(use the store column)</option>${S.meta.stores.map((s) => `<option value="${h(s.id)}">${h(s.name)}</option>`).join('')}</select></label>
      <button class="btn primary" type="submit">Import</button><div id="imp-out" style="margin-top:10px"></div></form>
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="panel"><h2>Prices in the database</h2><table class="simple"><tr><th>Source</th><th>Rows</th><th>Latest</th></tr>
        ${d.price_rows.map((r) => `<tr><td>${h(r.source)}</td><td>${r.n}</td><td>${h(fmtDate(r.latest))}</td></tr>`).join('')}</table>
        <p class="muted" style="font-size:.85rem">${d.users} registered user${d.users === 1 ? '' : 's'}.</p></div>
      <div class="panel"><h2>Sample prices</h2><p class="muted" style="margin-top:-6px">Illustrative prices that fill gaps so the app works before real data arrives. Turn off once you import real prices.</p>
        <button class="btn ${d.sample_enabled ? 'danger' : 'green'}" type="button" id="sample-toggle">${d.sample_enabled ? 'Turn sample prices off' : 'Turn sample prices on'}</button></div>
      <div class="panel"><h2>Price feeds</h2>
        ${d.feeds.length ? `<ul>${d.feeds.map((f) => `<li><b>${h(f.name || f.url)}</b> <span class="muted">${h(f.url)}</span></li>`).join('')}</ul>`
          : '<p class="muted">No feeds yet. List CSV/JSON URLs in <code>sources.json</code> in the data folder to fetch them automatically every few hours.</p>'}
        ${fs.at ? `<p class="muted" style="font-size:.85rem">Last refresh ${h(fs.at.replace('T', ' ').slice(0, 16))}: ${fs.results.map((r) => `${h(r.name)} ${r.ok ? '✓ ' + r.imported : '✗ ' + h(r.errors[0] || '')}`).join('; ')}</p>` : ''}
        <button class="btn" type="button" id="refresh" ${d.feeds.length ? '' : 'disabled'}>Refresh feeds now</button></div>
    </div></div>`;
  $('#imp-file').onchange = async (e) => { const f = e.target.files[0]; if (f) $('#imp-text').value = await f.text(); };
  $('#imp').onsubmit = async (e) => {
    e.preventDefault();
    const out = $('#imp-out');
    const text = $('#imp-text').value;
    if (!text.trim()) { out.innerHTML = '<p class="form-error">Choose a file or paste some rows.</p>'; return; }
    try {
      const r = await api('/api/admin/import', { body: { text, store: $('#imp-store').value || null } });
      out.innerHTML = `<div class="alert ${r.errors.length ? 'warn' : 'ok'}">Imported ${r.imported} price${r.imported === 1 ? '' : 's'}.${r.errors.length ? '<br>' + r.errors.map(h).join('<br>') : ''}</div>`;
      S.items = {};
      await loadMeta();
    } catch (x) { out.innerHTML = `<p class="form-error">${h(x.message)}</p>`; }
  };
  $('#sample-toggle').onclick = async () => {
    try { await api('/api/admin/sample', { body: { enabled: !d.sample_enabled } }); S.items = {}; await loadMeta(); renderAdmin(); } catch (x) { toast(x.message); }
  };
  $('#refresh').onclick = async () => {
    try { const r = await api('/api/admin/refresh', { body: {} }); toast(`Refreshed ${r.results.length} feed(s)`); S.items = {}; await loadMeta(); renderAdmin(); } catch (x) { toast(x.message); }
  };
}

// ------------------------------------------------------------------ auth dialog
let authMode = 'login';
function openAuth(mode = 'login', why) {
  setAuthMode(mode);
  if (why) $('#auth-sub').textContent = why;
  $('#auth-error').textContent = '';
  const dlg = $('#auth-dialog');
  if (!dlg.open) dlg.showModal();
  $('#auth-form [name=' + (mode === 'register' ? 'name' : 'email') + ']').focus();
}
function setAuthMode(mode) {
  authMode = mode;
  const reg = mode === 'register';
  $$('.auth-tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.auth === mode));
  $$('#auth-form .reg-only').forEach((el) => { el.hidden = !reg; });
  $('#auth-title').textContent = reg ? 'Create your free account' : 'Welcome back';
  $('#auth-sub').textContent = reg ? 'Save lists, choose your shops and share specials with other shoppers.' : 'Sign in to save your lists, pick your shops and report specials.';
  $('#auth-submit').textContent = reg ? 'Create account' : 'Sign in';
  $('#auth-form [name=password]').autocomplete = reg ? 'new-password' : 'current-password';
}
$$('.auth-tabs button').forEach((b) => b.onclick = () => setAuthMode(b.dataset.auth));
$('#auth-form').onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const body = { email: f.get('email'), password: f.get('password') };
  if (authMode === 'register') Object.assign(body, { name: f.get('name'), town: f.get('town') || '' });
  const btn = $('#auth-submit');
  btn.disabled = true;
  try {
    S.user = await api('/api/auth/' + authMode, { body });
    $('#auth-dialog').close();
    e.target.reset();
    renderAccountButton();
    toast(authMode === 'register' ? `Welcome, ${S.user.name.split(' ')[0]}! Your account is ready.` : `Welcome back, ${S.user.name.split(' ')[0]}`);
    route();
  } catch (x) {
    $('#auth-error').textContent = x.message;
  } finally { btn.disabled = false; }
};
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-signin]')) openAuth('login');
  if (e.target.closest('[data-register]')) openAuth('register');
  const deal = e.target.closest('[data-add-deal]');
  if (deal && S.specials.data) {
    const x = S.specials.data.results[+deal.dataset.addDeal];
    addToCart({ item_id: x.item_id, product_id: x.product_id, name: x.name, size: x.size, brand: x.brand });
  }
  const pill = e.target.closest('.store-pill');
  if (pill) {
    const sel = S.specials.stores;
    sel.has(pill.dataset.store) ? sel.delete(pill.dataset.store) : sel.add(pill.dataset.store);
    renderStrip();
    refreshSpecials();
  }
});

// ------------------------------------------------------------------ routing & start
const VIEWS = { specials: renderSpecials, compare: renderCompare, cart: renderCart, lists: renderLists, report: renderReport, admin: renderAdmin, account: renderAccountPage };
function route() {
  const v = location.hash.replace(/^#\/?/, '').split('/')[0] || 'specials';
  S.view = VIEWS[v] ? v : 'specials';
  $$('#tabs a').forEach((a) => {
    const on = a.dataset.view === S.view;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  renderStrip();
  VIEWS[S.view]();
}
window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });

async function loadMeta() {
  S.meta = await api('/api/meta');
  S.user = S.meta.user;
  S.byId = Object.fromEntries(S.meta.stores.map((s) => [s.id, s]));
  renderNotice();
  renderAccountButton();
}

(async function start() {
  updateCartCount();
  try { await loadMeta(); } catch (e) {
    view.innerHTML = `<div class="panel empty"><b>Can't reach the server</b>${h(e.message)}</div>`;
    return;
  }
  route();
})();
