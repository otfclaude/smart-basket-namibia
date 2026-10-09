'use strict';
/* Smart Basket Namibia: single-page front end (no build step). Animations use Motion (motion.dev). */

// ------------------------------------------------------------------ helpers
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => 'N$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = (n) => 'N$' + Math.round(Number(n || 0)).toLocaleString('en-US');
const uid = () => Math.random().toString(36).slice(2, 10);
const view = $('#view');

// <dialog> arrived in WebKit 15.4; older macOS WebKit gets a small stand-in with the same API.
(function dialogFallback() {
  if (typeof HTMLDialogElement === 'function' && typeof HTMLDialogElement.prototype.showModal === 'function') return;
  document.documentElement.classList.add('no-dialog');
  $$('dialog').forEach((d) => {
    d.showModal = d.show = () => { d.setAttribute('open', ''); document.body.classList.add('dlg-open'); };
    d.close = () => {
      d.removeAttribute('open');
      if (!$$('dialog[open]').length) document.body.classList.remove('dlg-open');
      d.dispatchEvent(new Event('close'));
    };
    Object.defineProperty(d, 'open', { get: () => d.hasAttribute('open'), configurable: true });
    d.addEventListener('submit', (e) => {
      if ((e.target.getAttribute('method') || '').toLowerCase() === 'dialog') { e.preventDefault(); d.close(); }
    });
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $$('dialog[open]').forEach((d) => d.close()); });
})();
const PRIOS = [['must', '⭐ Must have'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Nice to have']];

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function store(key, val) {
  try { if (val === undefined) return JSON.parse(localStorage.getItem(key)); localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage off */ }
  return null;
}
function sessionGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function sessionSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } }

async function api(path, opts = {}) {
  const o = { method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'), headers: {}, credentials: 'same-origin' };
  if (opts.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
  const r = await fetch(path, o);
  let data = null;
  try { data = await r.json(); } catch { /* empty */ }
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
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
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
function ago(iso) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
}
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ product emoji
const EMOJI = [[/maize|mahangu|mielie|pap/, '🌽'], [/roll/, '🥖'], [/bread|loaf/, '🍞'], [/rice/, '🍚'], [/flour/, '🌾'], [/sugar/, '🍬'],
  [/spaghetti|macaroni|pasta/, '🍝'], [/oats|cereal|flakes/, '🥣'], [/milk|omaere|maas/, '🥛'], [/egg/, '🥚'], [/margarine|butter/, '🧈'],
  [/cheese|cheddar/, '🧀'], [/yoghurt|yogurt/, '🍦'], [/chicken/, '🍗'], [/mince|beef|stew|steak/, '🥩'], [/boerewors|wors|sausage|polony|vienna/, '🌭'],
  [/hake|fish|pilchard|tuna/, '🐟'], [/potato/, '🥔'], [/onion/, '🧅'], [/tomato sauce|ketchup/, '🥫'], [/tomato/, '🍅'], [/cabbage|spinach/, '🥬'],
  [/apple/, '🍎'], [/banana/, '🍌'], [/orange/, '🍊'], [/oil/, '🌻'], [/beans|chakalaka/, '🫘'], [/peanut/, '🥜'], [/jam/, '🍓'], [/salt/, '🧂'],
  [/soup|stock/, '🍲'], [/rooibos|tea/, '🍵'], [/coffee/, '☕'], [/juice|concentrate|cordial/, '🧃'], [/soft drink|coke|cola|soda/, '🥤'],
  [/water/, '💧'], [/nappies|nappy|diaper/, '🧷'], [/wipes/, '🧻'], [/washing powder|laundry|detergent/, '🧺'], [/dish/, '🍽️'],
  [/bleach|cleaner|handy/, '🧴'], [/refuse|bin bag/, '🗑️'], [/candle/, '🕯️'], [/match/, '🔥'], [/insect|doom/, '🦟'], [/toilet/, '🧻'],
  [/toothpaste/, '🪥'], [/soap/, '🧼'], [/lotion|jelly|vaseline/, '🧴'], [/deodorant|roll-on/, '💨'], [/pads|sanitary/, '🌸'], [/biscuit|cookie/, '🍪'],
  [/beer|wine|liquor/, '🍺'], [/snack|chips|crisps/, '🍿']];
const CAT_EMOJI = { 'Staples & grains': '🌽', Bakery: '🍞', 'Dairy & eggs': '🥛', 'Meat & fish': '🍗', 'Fruit & veg': '🍎', 'Pantry & tins': '🥫',
  Drinks: '🥤', Baby: '👶', 'Household & cleaning': '🧽', 'Personal care': '🧴' };
const CAT_COLOR = { 'Staples & grains': '#f5a623', Bakery: '#c47f3a', 'Dairy & eggs': '#3b8cff', 'Meat & fish': '#e0123a', 'Fruit & veg': '#00964b',
  'Pantry & tins': '#d35400', Drinks: '#8e44ad', Baby: '#ff6fa5', 'Household & cleaning': '#0f8b8d', 'Personal care': '#6c5ce7' };
function emojiFor(name, category) {
  const n = (name || '').toLowerCase();
  for (const [re, e] of EMOJI) if (re.test(n)) return e;
  return CAT_EMOJI[category] || '🛒';
}

// ------------------------------------------------------------------ motion
const MO = window.Motion || null;
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = [0.22, 1, 0.36, 1];
function animate(el, kf, opts) {
  if (!MO || REDUCED || !el) return null;
  try { return MO.animate(el, kf, opts); } catch { return null; }
}
function reveal(els, opts = {}) {
  els = [...els].filter(Boolean);
  if (!els.length || !MO || REDUCED) return;
  try {
    const a = MO.animate(els, { opacity: [0, 1], transform: [`translateY(${opts.y ?? 18}px) scale(${opts.scale ?? 1})`, 'translateY(0px) scale(1)'] },
      { duration: opts.duration ?? 0.5, delay: MO.stagger(opts.step ?? 0.035, { startDelay: opts.start ?? 0 }), ease: EASE });
    if (a && a.then) a.then(() => els.forEach((e) => { e.style.transform = ''; e.style.opacity = ''; }));
  } catch { /* ignore */ }
}
function countTo(el, to, fmt = (v) => String(Math.round(v))) {
  if (!el) return;
  const from = parseFloat(el.dataset.v || '0') || 0;
  el.dataset.v = to;
  if (!MO || REDUCED || from === to) { el.textContent = fmt(to); return; }
  try { MO.animate(from, to, { duration: 0.9, ease: EASE, onUpdate: (v) => { el.textContent = fmt(v); } }); } catch { el.textContent = fmt(to); }
}
function pop(el) { animate(el, { transform: ['scale(1)', 'scale(1.25)', 'scale(1)'] }, { duration: 0.4, ease: EASE }); }
function bumpCart() {
  pop($('#cart-count'));
  animate($('#cart-tab i'), { transform: ['rotate(0deg)', 'rotate(-18deg)', 'rotate(12deg)', 'rotate(0deg)'] }, { duration: 0.55 });
}
function flyToCart(fromEl, emoji) {
  const target = $('#cart-tab');
  if (!fromEl || !target || !MO || REDUCED) { bumpCart(); return; }
  const a = fromEl.getBoundingClientRect(); const b = target.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'fly'; el.textContent = emoji || '🛒';
  $('#fx').append(el);
  const x0 = a.left + a.width / 2 - 16, y0 = a.top + a.height / 2 - 16, x1 = b.left + b.width / 2 - 16, y1 = b.top + b.height / 2 - 16;
  const mx = (x0 + x1) / 2, my = Math.min(y0, y1) - 140;
  const anim = animate(el, { transform: [`translate(${x0}px,${y0}px) scale(1)`, `translate(${mx}px,${my}px) scale(1.5) rotate(-15deg)`, `translate(${x1}px,${y1}px) scale(.35) rotate(10deg)`],
    opacity: [1, 1, 0.7] }, { duration: 0.85, ease: 'easeInOut' });
  const done = () => { el.remove(); bumpCart(); };
  if (anim && anim.then) anim.then(done); else done();
}
function confetti(x = window.innerWidth / 2, y = window.innerHeight / 3, n = 80) {
  if (!MO || REDUCED) return;
  const colors = ['#e0123a', '#ffc915', '#00964b', '#1559b5', '#3b8cff', '#ffffff'];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.background = colors[i % colors.length];
    $('#fx').append(c);
    const ang = Math.random() * Math.PI * 2, v = 90 + Math.random() * 260, dx = Math.cos(ang) * v, dy = Math.sin(ang) * v - 220;
    const anim = animate(c, { transform: [`translate(${x}px,${y}px) rotate(0deg)`, `translate(${x + dx}px,${y + dy}px) rotate(${Math.random() * 720 - 360}deg)`,
      `translate(${x + dx * 1.4}px,${y + dy + 520}px) rotate(${Math.random() * 1080}deg)`], opacity: [1, 1, 0] },
    { duration: 1.5 + Math.random() * 0.9, ease: [0.2, 0.6, 0.4, 1] });
    if (anim && anim.then) anim.then(() => c.remove()); else c.remove();
  }
}
function confettiFrom(el) {
  if (!el) return confetti();
  const r = el.getBoundingClientRect();
  confetti(r.left + r.width / 2, r.top + r.height / 3);
}
// subtle 3D tilt + shine on deal cards (mouse only)
view.addEventListener('pointermove', (e) => {
  const card = e.target.closest('.deal');
  if (!card || REDUCED || e.pointerType !== 'mouse') return;
  const r = card.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
  card.style.setProperty('--ry', `${(px - 0.5) * 9}deg`);
  card.style.setProperty('--rx', `${(0.5 - py) * 9}deg`);
  card.style.setProperty('--mx', `${px * 100}%`);
  card.style.setProperty('--my', `${py * 100}%`);
});
view.addEventListener('pointerout', (e) => {
  const card = e.target.closest('.deal');
  if (card && !card.contains(e.relatedTarget)) { card.style.removeProperty('--rx'); card.style.removeProperty('--ry'); }
});

// ------------------------------------------------------------------ state
const S = {
  meta: null, user: null, byId: {}, items: {}, view: 'deals', timers: [], deals: {},
  feed: { q: '', category: '', sort: 'percent', stores: new Set(), results: [], total: 0, loading: false },
  compare: { q: '', results: [], item: null },
  cart: loadCart(), result: null, buildSeq: 0, baskets: null,
};
function defaultCart() {
  return { lines: [], mode: 'cheapest', budget: 600, maxStores: 3, tripCost: 0, stores: null, listId: null, listName: '' };
}
function loadCart() {
  const c = store('nsb.cart.v2');
  return c && Array.isArray(c.lines) ? { ...defaultCart(), ...c } : defaultCart();
}
function saveCart() { store('nsb.cart.v2', S.cart); updateCartCount(); }
function updateCartCount() {
  const n = S.cart.lines.reduce((a, l) => a + l.qty, 0);
  const el = $('#cart-count');
  el.textContent = n;
  el.hidden = n === 0;
}
function addToCart(e, qty = 1, opts = {}) {
  const pid = e.product_id || null;
  const ex = S.cart.lines.find((l) => l.item_id === e.item_id && (l.product_id || null) === pid);
  if (ex) ex.qty = Math.min(99, ex.qty + qty);
  else S.cart.lines.push({ key: uid(), item_id: e.item_id, product_id: pid, name: e.name, size: e.size || '', brand: e.brand || null,
    category: e.category || '', qty, priority: 'high' });
  saveCart();
  if (opts.from) flyToCart(opts.from, emojiFor(e.name, e.category)); else bumpCart();
  if (!opts.quiet) toast(`Added ${e.brand && pid ? e.brand + ' ' : ''}${e.name} ${e.size || ''}`);
}
function rememberDeal(x) { const k = `${x.store_id}|${x.product_id}`; S.deals[k] = x; return k; }

const storeName = (id) => (S.byId[id] ? S.byId[id].name : id);
const logo = (id, cls = '') => `<span class="logo ${cls}" title="${h(storeName(id))}"><img src="/logos/${encodeURIComponent(id)}.svg?v=${S.meta ? S.meta.logo_version : 0}" alt="${h(storeName(id))}" loading="lazy"></span>`;
function sourceTag(x) {
  const s = x.source || '';
  if (s === 'sample') return '<span class="tag sample" title="Illustrative price, not from the shop">Sample</span>';
  if (s === 'community') return `<span class="tag community" title="Reported by a shopper${x.branch ? ' at ' + h(x.branch) : ''}">👋 ${h(x.reporter || 'Shopper')}</span>`;
  if (s.startsWith('leaflet:')) return '<span class="tag leaflet" title="Read from the shop\'s pamphlet">📰 Pamphlet</span>';
  if (s.startsWith('feed:')) return '<span class="tag good">Price feed</span>';
  return '<span class="tag good">From leaflet</span>';
}
async function itemDetail(id) {
  if (!S.items[id]) S.items[id] = await api('/api/items/' + encodeURIComponent(id));
  return S.items[id];
}
function clearTimers() {  // intervals and IntersectionObservers registered by the current view
  S.timers.forEach((t) => (t && t.disconnect ? t.disconnect() : clearInterval(t)));
  S.timers = [];
}

// ------------------------------------------------------------------ chrome
function renderAccountButton() {
  const el = $('#account');
  if (S.user) {
    const ini = S.user.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
    el.innerHTML = `<a class="avatar" href="#/me" title="${h(S.user.name)}">${h(ini)}</a>`;
  } else {
    el.innerHTML = '<button class="btn small" type="button" data-signin>Sign in</button>';
  }
}
function renderNotice() {
  const n = $('#notice');
  if (S.meta.sample_data && !sessionGet('nsb.hideSample')) {
    n.innerHTML = `<span>🧪 <b>Some prices are samples</b> (tagged <span class="tag sample">Sample</span>) until real pamphlets are loaded. Tap
      <b>Refresh</b> to fetch the latest pamphlets.</span><button class="btn small" type="button" id="hide-notice">Got it</button>`;
    n.hidden = false;
    $('#hide-notice').onclick = () => { sessionSet('nsb.hideSample', '1'); animate(n, { opacity: [1, 0] }, { duration: 0.25 }); setTimeout(() => { n.hidden = true; }, 250); };
  } else n.hidden = true;
}
function lastRefreshText() {
  const lr = S.meta.last_refresh || {};
  return lr.at ? `Last checked ${ago(lr.at)}${lr.summary ? ' · ' + h(lr.summary) : ''}` : 'Pamphlets not fetched yet';
}

// ------------------------------------------------------------------ deals (home)
function dealCard(x) {
  const k = rememberDeal(x);
  const em = emojiFor(x.name, x.category);
  const pct = x.saving_pct > 0 ? `-${x.saving_pct}%` : 'DEAL';
  return `<article class="deal" data-deal="${h(k)}">
    <div class="deal-top">${logo(x.store_id, 'sm')}${sourceTag(x)}</div>
    <div class="deal-art" style="--c:${CAT_COLOR[x.category] || '#3b8cff'}"><span>${em}</span><span class="burst ${x.saving_pct > 0 ? '' : 'plain'}">${pct}</span></div>
    <div><div class="deal-brand">${h(x.brand)}</div><div class="deal-name">${h(x.name)} <small>${h(x.size)}</small></div></div>
    <div class="deal-price price"><b>${money(x.price)}</b>${x.saving > 0 ? `<s class="was">${money(x.regular_price)}</s>` : ''}</div>
    <div class="deal-meta">${h(x.special_label || 'Special')} · ${h(until(x.valid_until))}</div>
    <div class="deal-foot"><span class="deal-meta">${x.saving > 0 ? `Save ${money(x.saving)}` : h(storeName(x.store_id))}</span>
      <button class="add-btn" type="button" data-add-deal="${h(k)}" aria-label="Add ${h(x.name)} to cart">＋ Add</button></div>
  </article>`;
}

async function renderDeals() {
  const f = S.feed;
  const total = Object.values(S.meta.special_counts || {}).reduce((a, b) => a + b, 0);
  const cats = ['', ...S.meta.categories];
  view.innerHTML = `
    <section class="hero">
      <div>
        <h1>Pay less for groceries <span class="wave">🇳🇦</span></h1>
        <p class="hero-sub">This week's specials from ${S.meta.stores.length} Namibian shops in one place. Add a deal with one tap,
          or let us build your cheapest basket.</p>
        <div class="stats">
          <div class="stat"><b id="st-total">0</b><small>specials today</small></div>
          <div class="stat"><b id="st-shops">0</b><small>shops</small></div>
          <div class="stat"><b id="st-max">0%</b><small>biggest saving</small></div>
        </div>
        <div class="hero-search"><span class="icon">🔎</span><input id="d-q" type="search" value="${h(f.q)}" aria-label="Search specials" autocomplete="off"></div>
        <div class="hero-actions"><button class="btn gold big" type="button" data-refresh>🔄 Get the latest pamphlets</button>
          <span class="muted" id="last-refresh">${lastRefreshText()}</span></div>
      </div>
      <div class="hero-art" id="hero-art"></div>
    </section>
    <div class="scroll-x shop-rail ${f.stores.size ? 'filtering' : ''}" id="shop-rail">${S.meta.stores.map((s) => {
      const n = (S.meta.special_counts || {})[s.id] || 0;
      return `<button class="shop-pill" type="button" data-store="${h(s.id)}" aria-pressed="${f.stores.has(s.id)}" title="${h(s.name)} · ${h(s.kind)}">${logo(s.id)}<small>${n} deal${n === 1 ? '' : 's'}</small></button>`;
    }).join('')}</div>
    <div class="section-head"><div><h2>🔥 Hottest deals right now</h2><p class="muted">The biggest price drops this week</p></div>
      <div class="car-nav"><button type="button" data-car="-1" aria-label="Previous deals">‹</button><button type="button" data-car="1" aria-label="More deals">›</button></div></div>
    <div class="carousel" id="hot">${'<div class="sk"></div>'.repeat(4)}</div>
    <div class="section-head"><div><h2>⚡ One-tap baskets</h2><p class="muted">Tap one and we build the cheapest cart for you</p></div></div>
    <div class="baskets" id="baskets">${'<div class="sk" style="min-height:150px"></div>'.repeat(3)}</div>
    <div class="section-head" id="all-head"><div><h2>🏷️ All specials</h2><p class="muted" id="sp-sub">Loading…</p></div>
      <select id="d-sort" aria-label="Sort" style="width:auto">${[['percent', 'Biggest % off'], ['saving', 'Biggest N$ saving'], ['price', 'Lowest price'], ['ending', 'Ending soonest'], ['name', 'A–Z']]
        .map(([v, t]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="scroll-x" id="cats">${cats.map((c) => `<button class="chip" type="button" data-cat="${h(c)}" aria-pressed="${f.category === c}">${c ? (CAT_EMOJI[c] || '🛒') + ' ' + h(c) : '✨ All'}</button>`).join('')}</div>
    <div class="grid" id="grid"></div>
    <div class="sentinel" id="sentinel"></div>`;

  countTo($('#st-total'), total);
  countTo($('#st-shops'), S.meta.stores.length);
  reveal($$('.shop-pill'), { step: 0.03, y: 10 });
  typewriter($('#d-q'), ['maize meal', 'cooking oil', 'nappies', 'chicken', 'washing powder', 'bread', 'sugar']);

  $('#d-q').addEventListener('input', debounce((e) => { f.q = e.target.value; loadFeed(true); }, 280));
  $('#d-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#all-head').scrollIntoView({ behavior: 'smooth' }); });
  $('#d-sort').onchange = (e) => { f.sort = e.target.value; loadFeed(true); };
  $('#cats').onclick = (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    f.category = b.dataset.cat;
    $$('#cats .chip').forEach((c) => c.setAttribute('aria-pressed', c === b));
    pop(b);
    loadFeed(true);
  };
  $('#shop-rail').onclick = (e) => {
    const b = e.target.closest('[data-store]');
    if (!b) return;
    f.stores.has(b.dataset.store) ? f.stores.delete(b.dataset.store) : f.stores.add(b.dataset.store);
    b.setAttribute('aria-pressed', f.stores.has(b.dataset.store));
    $('#shop-rail').classList.toggle('filtering', f.stores.size > 0);
    pop(b);
    loadFeed(true);
  };
  $$('[data-car]').forEach((b) => b.onclick = () => { const c = $('#hot'); c.scrollBy({ left: +b.dataset.car * (c.clientWidth * 0.8), behavior: 'smooth' }); });

  const io = new IntersectionObserver((ents) => { if (ents.some((x) => x.isIntersecting)) loadFeed(false); }, { rootMargin: '400px' });
  io.observe($('#sentinel'));
  S.timers.push(io);

  loadHot();
  loadBaskets($('#baskets'));
  loadFeed(true);
}

function typewriter(input, words) {
  if (!input || REDUCED) { if (input) input.placeholder = 'Search specials: ' + words.slice(0, 3).join(', ') + '…'; return; }
  let wi = 0, ci = 0, dir = 1;
  const t = setInterval(() => {
    if (!document.body.contains(input)) { clearInterval(t); return; }
    const w = words[wi];
    ci += dir;
    input.placeholder = 'Search ' + w.slice(0, ci) + (dir > 0 ? '▍' : '');
    if (ci >= w.length + 8) dir = -1;
    if (ci <= 0) { dir = 1; wi = (wi + 1) % words.length; }
  }, 90);
  S.timers.push(t);
}

async function loadHot() {
  let d;
  try { d = await api('/api/specials?sort=percent&limit=12'); } catch { return; }
  if (S.view !== 'deals') return;
  const hot = $('#hot');
  hot.innerHTML = d.results.length ? d.results.map(dealCard).join('') : '<div class="empty"><b>No specials yet</b>Tap Refresh to fetch pamphlets.</div>';
  reveal(hot.children, { step: 0.06, scale: 0.95 });
  if (d.results[0]) countTo($('#st-max'), d.results[0].saving_pct, (v) => `${Math.round(v)}%`);
  const art = $('#hero-art');
  art.innerHTML = d.results.slice(0, 3).map((x) => `<button class="bubble" type="button" data-add-deal="${h(rememberDeal(x))}" title="Add to cart">
      <span class="em">${emojiFor(x.name, x.category)}</span><span><b>${h(x.name)}</b><span class="muted" style="font-size:.78rem">${h(storeName(x.store_id))}</span>
      <span class="p">${money(x.price)}</span></span>${x.saving_pct > 0 ? `<span class="off">-${x.saving_pct}%</span>` : ''}</button>`).join('');
  reveal(art.children, { step: 0.15, scale: 0.8, y: 30, duration: 0.7 });
  // gentle auto-scroll that pauses while the shopper interacts
  let paused = false;
  ['pointerenter', 'focusin', 'touchstart'].forEach((ev) => hot.addEventListener(ev, () => { paused = true; }, { passive: true }));
  hot.addEventListener('pointerleave', () => { paused = false; });
  const t = setInterval(() => {
    if (paused || !document.body.contains(hot) || REDUCED) return;
    const end = hot.scrollLeft + hot.clientWidth >= hot.scrollWidth - 10;
    hot.scrollTo({ left: end ? 0 : hot.scrollLeft + (hot.firstElementChild ? hot.firstElementChild.offsetWidth + 14 : 280), behavior: 'smooth' });
  }, 4200);
  S.timers.push(t);
}

async function loadFeed(reset) {
  const f = S.feed;
  if (f.loading) { if (reset) f.pending = true; return; }
  if (!reset && f.results.length >= f.total) return;
  f.loading = true;
  const p = new URLSearchParams({ q: f.q, category: f.category, sort: f.sort, limit: 36, offset: reset ? 0 : f.results.length });
  if (f.stores.size) p.set('stores', [...f.stores].join(','));
  try {
    const d = await api('/api/specials?' + p);
    if (S.view !== 'deals') return;
    const grid = $('#grid');
    if (reset) { f.results = []; grid.innerHTML = ''; }
    f.results = f.results.concat(d.results);
    f.total = d.total;
    const before = grid.children.length;
    grid.insertAdjacentHTML('beforeend', d.results.map(dealCard).join(''));
    if (!f.results.length) grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><span class="big-emoji">🔍</span><b>No specials match</b>Try another word, category or shop.</div>';
    reveal([...grid.children].slice(before), { step: 0.025 });
    const bits = [f.stores.size ? [...f.stores].map(storeName).join(', ') : '', f.category, f.q && `“${f.q}”`].filter(Boolean).join(' · ');
    $('#sp-sub').textContent = `${d.total} special${d.total === 1 ? '' : 's'}${bits ? ' · ' + bits : ''}`;
  } catch (e) {
    toast(e.message);
  } finally {
    f.loading = false;
    if (f.pending) { f.pending = false; loadFeed(true); }
  }
}

async function loadBaskets(box) {
  try {
    if (!S.baskets) S.baskets = (await api('/api/baskets')).baskets;
  } catch { if (box) box.innerHTML = ''; return; }
  if (!box || !document.body.contains(box)) return;
  box.innerHTML = S.baskets.map((b) => `<button class="basket" type="button" data-basket="${h(b.id)}">
      <span class="em">${b.emoji}</span><b>${h(b.name)}</b><small>${h(b.blurb)} · ${b.count} items</small>
      <span class="bp">${b.total ? money0(b.total) : ''}<small>${b.stores && b.stores.length ? 'at ' + b.stores.map(storeName).join(' + ') : ''}</small></span></button>`).join('');
  reveal(box.children, { step: 0.06, scale: 0.92 });
}

function useBasket(id, fromEl) {
  const b = (S.baskets || []).find((x) => x.id === id);
  if (!b) return;
  const wasEmpty = !S.cart.lines.length;
  b.lines.forEach((ln) => addToCart({ item_id: ln.item_id, name: ln.name, size: ln.size }, ln.qty, { quiet: true }));
  if (fromEl) confettiFrom(fromEl);
  toast(`${b.emoji} ${b.name}: ${b.count} items ${wasEmpty ? 'in your cart' : 'added to your cart'}`);
  S.celebrate = true;
  if (S.view === 'cart') renderCart(); else location.hash = '#/cart';
}

// ------------------------------------------------------------------ pamphlets
async function renderPamphlets() {
  view.innerHTML = `<div class="section-head" style="margin-top:6px"><div><h1>📰 This week's pamphlets</h1>
      <p class="muted" id="pm-sub">${lastRefreshText()}</p></div>
      <button class="btn gold big" type="button" data-refresh>🔄 Get the latest pamphlets</button></div>
    <div id="pm-note"></div>
    <div class="pamphlets" id="pm">${'<div class="sk"></div>'.repeat(6)}</div>`;
  let d;
  try { d = await api('/api/leaflets'); } catch (e) { $('#pm').innerHTML = `<div class="empty">${h(e.message)}</div>`; return; }
  if (S.view !== 'pamphlets') return;
  const latest = {};
  d.leaflets.forEach((l) => { if (!latest[l.store_id]) latest[l.store_id] = l; });
  S.pamphlets = latest;
  if (!d.claude) {
    $('#pm-note').innerHTML = `<div class="callout info row between"><span>📖 Pamphlets are saved here so you can flip through them. Prices are read from them
      automatically once Claude is connected${S.meta.local ? '.' : ' (an admin adds the key on the <a href="#/me">Me</a> page).'}</span>
      ${S.meta.local ? '<button class="btn primary small" type="button" data-claude>🤖 Connect Claude</button>' : ''}</div>`;
  }
  const stores = S.meta.stores;
  $('#pm').innerHTML = stores.map((s) => {
    const l = latest[s.id];
    const hasSource = !!(d.sources || {})[s.id];
    if (!l) {
      return `<article class="pamphlet none"><div class="cover"><div class="pdf">📭</div></div><div class="body">${logo(s.id)}
        <b>${h(s.name)}</b><span class="muted" style="font-size:.85rem">${hasSource ? 'No pamphlet found yet. Tap Refresh to look again.' : 'This shop doesn\'t publish pamphlets online.'}</span>
        ${s.website ? `<a class="btn small" href="${h(s.website)}" target="_blank" rel="noopener">Shop's website ↗</a>` : ''}</div></article>`;
    }
    const cover = l.kind === 'images' ? `<img src="${h(l.files[0])}" alt="" loading="lazy">` : '<div class="pdf">📄</div>';
    const status = l.status === 'read' ? `<span class="tag good">✓ ${l.n_specials} prices added</span>`
      : l.status === 'error' ? `<span class="tag sample" title="${h(l.message)}">⚠️ Couldn't read prices</span>` : '<span class="tag leaflet">📖 Flip through it</span>';
    return `<article class="pamphlet"><button class="cover" type="button" data-open="${h(s.id)}" aria-label="Open ${h(s.name)} pamphlet">${cover}<span class="pages">${l.pages} page${l.pages === 1 ? '' : 's'}</span></button>
      <div class="body"><div class="row between">${logo(s.id)}${status}</div><b>${h(l.title || s.name + ' specials')}</b>
      <span class="muted" style="font-size:.85rem">${l.valid_until ? 'Valid ' + (l.valid_from ? fmtDate(l.valid_from) + ' – ' : 'until ') + fmtDate(l.valid_until) : 'Fetched ' + ago(l.fetched_at)}</span>
      <div class="row"><button class="btn small primary" type="button" data-open="${h(s.id)}">Open</button>
      ${l.page_url ? `<a class="btn small" href="${h(l.page_url)}" target="_blank" rel="noopener">Source ↗</a>` : ''}</div></div></article>`;
  }).join('');
  reveal($('#pm').children, { step: 0.05, scale: 0.95 });
}

function openViewer(storeId) {
  const l = (S.pamphlets || {})[storeId];
  if (!l) return;
  $('#viewer-title').textContent = `${storeName(storeId)}: ${l.title || 'pamphlet'}`;
  $('#viewer-open').href = l.files[0];
  $('#viewer-body').innerHTML = l.kind === 'images'
    ? `<div class="pages-strip">${l.files.map((f, i) => `<img src="${h(f)}" alt="Page ${i + 1}" loading="lazy">`).join('')}</div>`
    : `<iframe src="${h(l.files[0])}" title="${h(storeName(storeId))} pamphlet"></iframe>`;
  $('#viewer').showModal();
}

// ------------------------------------------------------------------ refresh button
const R = { timer: null, prev: {}, userStarted: false, hideTimer: null };
async function startRefresh() {
  R.userStarted = true;
  $('#refresh-btn').classList.add('spinning');
  try {
    const s = await api('/api/refresh', { body: { force: false } });
    showRefresh(s);
    if (s.running) pollRefresh();
    else {
      $('#refresh-btn').classList.remove('spinning');
      if (s.next_allowed_in > 0) toast(`Pamphlets were just checked. You can refresh again in ${Math.ceil(s.next_allowed_in / 60)} min.`);
    }
  } catch (e) {
    $('#refresh-btn').classList.remove('spinning');
    toast(e.message);
  }
}
function pollRefresh() {
  clearTimeout(R.timer);
  R.timer = setTimeout(async () => {
    let s;
    try { s = await api('/api/refresh/status'); } catch { pollRefresh(); return; }
    showRefresh(s);
    if (s.running) pollRefresh(); else onRefreshDone(s);
  }, 900);
}
const RS_ICON = { queued: '⏳', done: '✅', none: '📭', error: '⚠️' };
function showRefresh(s) {
  const sheet = $('#refresh-sheet');
  const shops = Object.entries(s.shops || {});
  if (!shops.length || (!R.userStarted && sheet.hidden)) return;  // background refreshes only spin the button
  clearTimeout(R.hideTimer);
  const done = shops.filter(([, x]) => ['done', 'none', 'error'].includes(x.state)).length;
  const firstOpen = sheet.hidden;
  sheet.hidden = false;
  sheet.innerHTML = `<div class="rs-head"><b>${s.running ? '🔄 Getting the latest pamphlets' : '✅ Pamphlets checked'}</b>
      <button class="x" type="button" id="rs-close" aria-label="Close">✕</button></div>
    <div class="rs-progress"><div style="width:${Math.round(100 * done / shops.length)}%"></div></div>
    ${s.running ? '' : `<p class="muted" style="margin:0 0 6px">${h(s.summary || '')}</p>`}
    ${shops.map(([id, x]) => `<div class="rs-shop" data-rs="${h(id)}">${logo(id, 'sm')}<div><b style="font-size:.88rem">${h(x.name || storeName(id))}</b>
      <div class="rs-msg">${h(x.message || '')}</div></div>
      <span class="rs-icon ${['searching', 'downloading', 'reading'].includes(x.state) ? 'busy' : ''}">${RS_ICON[x.state] || ''}</span></div>`).join('')}
    ${s.claude ? '' : `<p class="rs-msg" style="margin-top:8px">ℹ️ Pamphlets are saved to flip through. Prices are read automatically once Claude is connected.
      ${S.meta.local ? '<button class="btn small primary" type="button" data-claude style="margin-top:6px">🤖 Connect Claude</button>' : ''}</p>`}`;
  $('#rs-close').onclick = hideSheet;
  if (firstOpen) animate(sheet, { opacity: [0, 1], transform: ['translateY(30px) scale(.96)', 'translateY(0px) scale(1)'] }, { duration: 0.4, ease: EASE });
  shops.forEach(([id, x]) => { if (R.prev[id] && R.prev[id] !== x.state && ['done', 'none', 'error'].includes(x.state)) pop($(`[data-rs="${id}"] .rs-icon`, sheet)); });
  R.prev = Object.fromEntries(shops.map(([id, x]) => [id, x.state]));
}
function hideSheet() {
  const sheet = $('#refresh-sheet');
  if (sheet.hidden) return;
  const a = animate(sheet, { opacity: [1, 0], transform: ['translateY(0px)', 'translateY(20px)'] }, { duration: 0.25 });
  const done = () => { sheet.hidden = true; sheet.style.opacity = ''; sheet.style.transform = ''; };
  if (a && a.then) a.then(done); else done();
}
async function onRefreshDone(s) {
  $('#refresh-btn').classList.remove('spinning');
  R.userStarted = false;
  R.hideTimer = setTimeout(() => { if (!$('#refresh-sheet').matches(':hover')) hideSheet(); }, 7000);
  const total = Object.values(s.shops || {}).reduce((a, x) => a + (x.specials || 0), 0);
  if (total > 0) { confetti(); toast(`🎉 ${total} new prices from this week's pamphlets`); }
  S.baskets = null; S.items = {};
  await loadMeta();
  if (['deals', 'pamphlets', 'compare'].includes(S.view)) route();
}

// ------------------------------------------------------------------ compare
function renderCompare() {
  const c = S.compare;
  const QUICK = ['Maize meal', 'Bread', 'Cooking oil', 'Sugar', 'Eggs', 'Milk', 'Chicken', 'Rice', 'Washing powder', 'Toilet paper', 'Nappies', 'Soap'];
  view.innerHTML = `
    <div class="section-head" style="margin-top:6px"><div><h1>🔎 Compare prices</h1><p class="muted">What anything costs at every shop today, specials included.</p></div></div>
    <div class="compare">
      <div>
        <div class="addbox"><span class="icon">🔎</span><input type="search" id="cmp-q" placeholder="e.g. sugar, Sunfoil, toilet paper" value="${h(c.q)}" aria-label="Search products" autocomplete="off"></div>
        <div class="scroll-x" style="margin-top:10px" id="cmp-quick">${QUICK.map((q) => `<button class="chip" type="button" data-q="${h(q)}">${emojiFor(q)} ${h(q)}</button>`).join('')}</div>
        <div class="results" id="cmp-results"></div>
      </div>
      <div class="panel" id="cmp-detail"><div class="empty"><span class="big-emoji">⚖️</span><b>Pick a product</b>Its price at each shop shows here, cheapest first.</div></div>
    </div>`;
  const run = async () => {
    const q = c.q.trim();
    if (!q) { c.results = []; drawCompareResults(); return; }
    try {
      const d = await api('/api/search?' + new URLSearchParams({ q, limit: 20 }));
      if (q !== c.q.trim()) return;
      c.results = d.results;
      drawCompareResults(true);
      if (c.results.length && (!c.item || !c.results.some((r) => r.id === c.item.id))) showItem(c.results[0].id);
    } catch (e) { toast(e.message); }
  };
  $('#cmp-q').addEventListener('input', debounce((e) => { c.q = e.target.value; run(); }, 220));
  $('#cmp-quick').onclick = (e) => {
    const b = e.target.closest('[data-q]');
    if (!b) return;
    c.q = b.dataset.q; $('#cmp-q').value = c.q; c.item = null; pop(b); run();
  };
  $('#cmp-results').onclick = (e) => { const b = e.target.closest('[data-item]'); if (b) showItem(b.dataset.item); };
  drawCompareResults();
  if (c.item) drawItem(c.item); else if (c.q) run();
}
function drawCompareResults(animateIn) {
  const c = S.compare;
  const el = $('#cmp-results');
  if (!el) return;
  if (!c.q.trim()) { el.innerHTML = ''; return; }
  el.innerHTML = c.results.length ? c.results.map((r) => `
    <button class="result" type="button" data-item="${h(r.id)}" aria-current="${!!(c.item && c.item.id === r.id)}"><span class="em">${emojiFor(r.name, r.category)}</span>
      <span><span class="r-name">${h(r.name)}</span> <span class="r-sub">${h(r.size)}</span>
        <span class="r-sub" style="display:block">${r.n_shops} shop${r.n_shops === 1 ? '' : 's'}${r.n_specials ? ` · <b style="color:var(--red)">${r.n_specials} on special</b>` : ''}</span></span>
      <span class="r-best">${r.best ? `from<b>${money(r.best.price)}</b>${h(r.best.store_name)}` : 'no prices yet'}</span>
    </button>`).join('') : '<div class="empty"><b>Nothing found</b>Try a simpler word, like “oil” or “nappies”.</div>';
  if (animateIn) reveal(el.children, { step: 0.03, y: 8 });
}
async function showItem(id) {
  try {
    delete S.items[id];
    S.compare.item = await itemDetail(id);
    drawItem(S.compare.item, true);
    drawCompareResults();
  } catch (e) { toast(e.message); }
}
function drawItem(it, animateIn) {
  const el = $('#cmp-detail');
  if (!el) return;
  const best = it.prices[0];
  const rows = it.prices.map((p, i) => `
    <tr class="${best && p.price === best.price ? 'best' : ''}">
      <td>${logo(p.store_id, 'sm')}</td>
      <td><b>${h(p.brand)}</b><div class="hide-sm" style="margin-top:2px">${sourceTag(p)}</div></td>
      <td class="num price"><b style="${p.on_special ? 'color:var(--red)' : ''}">${money(p.price)}</b>${p.saving > 0 ? `<br><s class="was">${money(p.regular_price)}</s>` : ''}</td>
      <td class="hide-sm">${p.on_special ? `<span class="tag special">${p.saving_pct > 0 ? '-' + p.saving_pct + '%' : 'Special'}</span><div class="muted" style="font-size:.74rem">${h(until(p.valid_until))}</div>` : '<span class="muted">–</span>'}</td>
      <td class="num hide-sm muted" style="font-size:.8rem">${money(p.unit_price)} ${h(p.unit_label)}</td>
      <td class="num"><button class="add-btn" type="button" data-add-price="${i}" aria-label="Add ${h(p.brand)} to cart">＋</button></td>
    </tr>`).join('');
  el.innerHTML = `
    <div class="row between" style="align-items:flex-start">
      <div class="row"><span style="font-size:2.4rem">${emojiFor(it.name, it.category)}</span><div><h2 style="margin:0">${h(it.name)} <span class="muted">${h(it.size)}</span></h2>
        <div class="muted">${h(it.category)} · ${it.prices.length} price${it.prices.length === 1 ? '' : 's'}</div></div></div>
      <button class="btn primary" type="button" id="add-any">＋ Add (any brand)</button>
    </div>
    ${best ? `<div class="callout ok">🏆 Cheapest today: <b>${money(best.price)}</b> for ${h(best.brand)} at <b>${h(best.store_name)}</b>${best.on_special ? ' (on special)' : ''}.
      ${it.prices.length > 1 ? `The priciest is ${money(it.prices[it.prices.length - 1].price)}.` : ''}</div>` : '<div class="empty">No shop has a price for this yet.</div>'}
    ${rows ? `<div style="overflow-x:auto"><table class="prices"><thead><tr><th>Shop</th><th>Brand</th><th class="num">Price</th><th class="hide-sm">Special</th><th class="num hide-sm">Unit</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}`;
  $('#add-any').onclick = (e) => addToCart({ item_id: it.id, name: it.name, size: it.size, category: it.category }, 1, { from: e.currentTarget });
  const tb = el.querySelector('tbody');
  if (tb) {
    tb.addEventListener('click', (e) => {
      const b = e.target.closest('[data-add-price]');
      if (!b) return;
      const p = it.prices[+b.dataset.addPrice];
      addToCart({ item_id: it.id, product_id: p.product_id, name: it.name, size: it.size, brand: p.brand, category: it.category }, 1, { from: b });
    });
    if (animateIn) reveal(tb.children, { step: 0.03, y: 6 });
  }
}

// ------------------------------------------------------------------ cart
function attachSuggest(input, box, onPick) {
  let items = [], hl = -1;
  const close = () => { box.hidden = true; box.innerHTML = ''; hl = -1; };
  const draw = () => {
    box.innerHTML = items.length ? items.map((it, i) => `<button type="button" data-i="${i}" class="${i === hl ? 'hl' : ''}">
        <span>${emojiFor(it.name, it.category)} <b>${h(it.name)}</b> <small>${h(it.size)}</small></span><small>${it.best ? 'from ' + money(it.best.price) : ''}</small></button>`).join('')
      : '<div class="empty" style="padding:12px">No match. Try another word.</div>';
    box.hidden = false;
  };
  const fetchItems = debounce(async (q) => {
    try {
      const d = await api('/api/search?' + new URLSearchParams({ q, limit: 8 }));
      if (input.value.trim() !== q) return;
      items = d.results; hl = items.length ? 0 : -1; draw();
    } catch { /* ignore */ }
  }, 160);
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
    <div class="section-head" style="margin-top:6px"><div><h1>🛒 My cart</h1><p class="muted">We work out where to buy each item. Your total updates as you go.</p></div>
      ${c.lines.length ? '<button class="btn small" type="button" id="cart-clear">Clear cart</button>' : ''}</div>
    <div class="switch ${budget ? 'budget' : ''}" id="mode" role="group" aria-label="Cart type"><span class="pill"></span>
      <button type="button" data-mode="cheapest" aria-pressed="${!budget}">🧮 Cheapest cart</button>
      <button type="button" data-mode="budget" aria-pressed="${budget}">💰 Fit my budget</button></div>
    ${budget ? `<section class="panel budget-card" id="budget-card">
      <div class="gauge" id="gauge"><svg width="136" height="136" viewBox="0 0 136 136"><circle class="g-bg" cx="68" cy="68" r="58" stroke-width="14" fill="none"/>
        <circle class="g-fg" id="g-fg" cx="68" cy="68" r="58" stroke-width="14" fill="none" stroke-linecap="round" stroke-dasharray="364.42" stroke-dashoffset="364.42"/></svg>
        <div class="g-txt"><b id="g-spent">N$0</b><small id="g-of">of your budget</small></div></div>
      <div style="width:100%"><small class="muted" style="font-weight:700">MY BUDGET</small><div class="budget-amount" id="b-amt">${money0(c.budget)}</div>
        <input type="range" id="b-range" min="50" max="5000" step="10" value="${h(c.budget)}" aria-label="Budget">
        <div class="chips">${[200, 500, 1000, 1500, 2500].map((v) => `<button class="chip" type="button" data-b="${v}">N$${v.toLocaleString('en-US')}</button>`).join('')}</div>
        <p class="muted" style="font-size:.85rem;margin:.6rem 0 0">Give each item a priority. <b>Must have</b> items always go in; the rest are added in order until the money runs out.</p></div>
    </section>` : ''}
    <div class="cart-grid">
      <section class="panel">
        <div class="addbox"><span class="icon">➕</span><input type="search" id="add-q" placeholder="Add anything: bread, maize meal, soap…" autocomplete="off" aria-label="Add an item">
          <div class="suggest" id="add-suggest" hidden></div></div>
        <div class="scroll-x quick" id="quick"></div>
        <details class="paste" ${c.lines.length ? '' : 'open'}><summary>📝 Type or paste a whole list</summary>
          <textarea id="paste-text" placeholder="One per line, e.g.&#10;2 x bread&#10;maize meal 10kg&#10;cooking oil&#10;18 eggs&#10;washing powder"></textarea>
          <button class="btn" type="button" id="paste-go">✨ Match my list</button>
          <div id="parsed"></div>
        </details>
        <ul class="lines" id="lines"></ul>
        <details class="opts"><summary>⚙️ Shops &amp; travel</summary>
          <div class="opt-title">Shops you can get to</div>
          <div class="row" style="margin-bottom:6px"><button class="btn small" type="button" data-shops="all">All shops</button>
            ${S.user && S.user.stores.length ? '<button class="btn small" type="button" data-shops="mine">My shops</button>' : ''}
            <button class="btn small" type="button" data-shops="none">None</button></div>
          <div class="store-toggles" id="cart-shops">${S.meta.stores.map((s) => `<button class="store-toggle" type="button" data-store="${h(s.id)}" aria-pressed="${!c.stores || c.stores.includes(s.id)}" title="${h(s.name)}">${logo(s.id)}</button>`).join('')}</div>
          <div class="opt-title">How many shops will you visit?</div>
          <div class="seg" id="max-stores">${[[0, 'Any'], [1, 'Just 1'], [2, 'Up to 2'], [3, 'Up to 3']].map(([v, t]) => `<button type="button" data-v="${v}" aria-pressed="${(c.maxStores || 0) === v}">${t}</button>`).join('')}</div>
          <div class="opt-title">Travel cost per shop <span class="muted">(taxi or fuel)</span></div>
          <div class="money-input" style="max-width:200px"><span>N$</span><input type="number" id="trip" min="0" max="5000" step="1" inputmode="decimal" value="${h(c.tripCost || 0)}"></div>
        </details>
      </section>
      <section class="result-col" id="result"></section>
    </div>`;

  $('#mode').onclick = (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b || b.dataset.mode === c.mode) return;
    c.mode = b.dataset.mode; S.result = null; saveCart();
    $('#mode').classList.toggle('budget', c.mode === 'budget');
    setTimeout(renderCart, REDUCED ? 0 : 220);
  };
  const clear = $('#cart-clear');
  if (clear) clear.onclick = () => { if (confirm('Remove everything from your cart?')) { Object.assign(c, { lines: [], listId: null, listName: '' }); S.result = null; saveCart(); renderCart(); } };
  attachSuggest($('#add-q'), $('#add-suggest'), (it) => {
    addToCart({ item_id: it.id, name: it.name, size: it.size, category: it.category }, 1, { quiet: true, from: $('#add-q') });
    drawLines(true); scheduleBuild(); loadLineDetails();
  });
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
    pop(b); changed();
  };
  $$('[data-shops]').forEach((b) => b.onclick = () => {
    const k = b.dataset.shops;
    c.stores = k === 'all' ? null : k === 'none' ? [] : [...S.user.stores];
    $$('#cart-shops [data-store]').forEach((t) => t.setAttribute('aria-pressed', !c.stores || c.stores.includes(t.dataset.store)));
    changed();
  });
  $('#max-stores').onclick = (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    c.maxStores = +b.dataset.v;
    $$('#max-stores button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    changed();
  };
  $('#trip').oninput = (e) => { c.tripCost = Math.max(0, +e.target.value || 0); changed(); };
  if (budget) {
    const range = $('#b-range');
    const setFill = () => range.style.setProperty('--fill', `${(100 * (c.budget - 50)) / (5000 - 50)}%`);
    setFill();
    range.oninput = () => { c.budget = +range.value; $('#b-amt').textContent = money0(c.budget); setFill(); changed(); };
    $('.budget-card .chips').onclick = (e) => {
      const b = e.target.closest('[data-b]');
      if (!b) return;
      const from = c.budget; c.budget = +b.dataset.b; range.value = c.budget; setFill(); pop(b);
      const el = $('#b-amt'); el.dataset.v = from; countTo(el, c.budget, money0);
      changed();
    };
  }
  drawQuick();
  drawLines(false, true);
  loadLineDetails();
  drawResult();
  if (c.lines.length) build();
}

function drawQuick() {
  const box = $('#quick');
  if (!box) return;
  const show = (bs) => {
    box.innerHTML = '<span class="muted" style="font-size:.8rem;align-self:center;font-weight:700">Quick add:</span>' +
      bs.map((b) => `<button class="chip" type="button" data-basket="${h(b.id)}">${b.emoji} ${h(b.name)}</button>`).join('');
  };
  if (S.baskets) show(S.baskets);
  else api('/api/baskets').then((d) => { S.baskets = d.baskets; if (document.body.contains(box)) show(d.baskets); }).catch(() => {});
}

function changed() { saveCart(); scheduleBuild(); }
const scheduleBuild = debounce(() => build(), 350);

function drawLines(animateLast, animateAll) {
  const c = S.cart;
  const el = $('#lines');
  if (!el) return;
  const budget = c.mode === 'budget';
  if (!c.lines.length) {
    el.innerHTML = '<li class="empty"><span class="big-emoji">🧺</span><b>Your cart is empty</b>Search above, tap a quick basket, or add deals from the Deals page.</li>';
    updateCartCount();
    return;
  }
  el.innerHTML = c.lines.map((l) => {
    const det = S.items[l.item_id];
    const brands = det ? det.products : (l.product_id ? [{ id: l.product_id, brand: l.brand }] : []);
    const opts = '<option value="">Any brand</option>' + brands.map((p) => `<option value="${h(p.id)}" ${p.id === l.product_id ? 'selected' : ''}>${h(p.brand)}</option>`).join('');
    return `<li class="line" data-key="${h(l.key)}"><span class="em">${emojiFor(l.name, l.category || (det && det.category))}</span>
      <div class="line-name">${h(l.name)} <small>${h(l.size)}</small></div>
      <button class="x" type="button" data-act="remove" aria-label="Remove ${h(l.name)}">✕</button>
      <div class="line-ctrls">
        <div class="stepper"><button type="button" data-act="dec" aria-label="One less">−</button><span aria-live="polite">${l.qty}</span><button type="button" data-act="inc" aria-label="One more">+</button></div>
        <select data-act="brand" aria-label="Brand for ${h(l.name)}">${opts}</select>
        ${budget ? `<select data-act="prio" class="prio ${h(l.priority)}" aria-label="Priority for ${h(l.name)}">${PRIOS.map(([v, t]) => `<option value="${v}" ${l.priority === v ? 'selected' : ''}>${t}</option>`).join('')}</select>` : ''}
      </div></li>`;
  }).join('');
  if (animateAll) reveal(el.children, { step: 0.03, y: 10 });
  else if (animateLast) reveal([el.lastElementChild], { scale: 0.9 });
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
  const li = b.closest('.line');
  if (b.dataset.act === 'remove') {
    const done = () => { S.cart.lines = S.cart.lines.filter((x) => x !== l); drawLines(); changed(); };
    const a = animate(li, { opacity: [1, 0], transform: ['translateX(0px)', 'translateX(40px)'] }, { duration: 0.22 });
    if (a && a.then) a.then(done); else done();
    return;
  }
  if (b.dataset.act === 'inc') l.qty = Math.min(99, l.qty + 1);
  if (b.dataset.act === 'dec') l.qty = Math.max(1, l.qty - 1);
  const span = $('.stepper span', li);
  span.textContent = l.qty;
  pop(span);
  updateCartCount();
  changed();
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
  changed();
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
    return `<div><span style="min-width:2.4em;font-weight:800">${l.qty}×</span>
      ${choices.length ? `<select data-i="${i}" aria-label="Match for ${h(l.text)}">${choices.map((c) => `<option value="${h(c.id)}">${emojiFor(c.name, c.category)} ${h(c.name)} ${h(c.size)}</option>`).join('')}<option value="">Skip “${h(l.text)}”</option></select>`
        : `<span class="muted">No match for “${h(l.text)}”.</span>`}</div>`;
  }).join('')}</div><button class="btn green" type="button" id="paste-add">＋ Add ${lines.filter((l) => l.item).length} items</button>`;
  reveal($$('.parsed > div', out), { step: 0.04, y: 6 });
  $('#paste-add').onclick = () => {
    let n = 0;
    lines.forEach((l, i) => {
      const sel = $(`#parsed select[data-i="${i}"]`);
      const id = sel ? sel.value : '';
      if (!id) return;
      const choice = [l.item, ...l.alternatives].find((c) => c && c.id === id);
      addToCart({ item_id: choice.id, name: choice.name, size: choice.size, category: choice.category }, l.qty, { quiet: true });
      n++;
    });
    toast(`Added ${n} item${n === 1 ? '' : 's'} to your cart`);
    $('#paste-text').value = ''; out.innerHTML = ''; $('details.paste').open = false;
    drawLines(false, true); loadLineDetails(); changed();
  };
}

async function build() {
  const c = S.cart;
  if (!c.lines.length) { S.result = null; drawResult(); return; }
  if (c.stores && !c.stores.length) { S.result = { error: 'Pick at least one shop under ⚙️ Shops & travel.' }; drawResult(); return; }
  const seq = ++S.buildSeq;
  const sum = $('.summary');
  if (sum) sum.classList.add('updating');
  try {
    const r = await api('/api/cart/optimize', { body: {
      lines: c.lines.map((l) => ({ key: l.key, item_id: l.item_id, product_id: l.product_id, qty: l.qty, priority: c.mode === 'budget' ? l.priority : 'high' })),
      stores: c.stores, max_stores: c.maxStores || null, trip_cost: +c.tripCost || 0, budget: c.mode === 'budget' ? +c.budget : null,
    } });
    if (seq !== S.buildSeq) return;
    const prev = S.result;
    S.result = r;
    drawResult(prev);
  } catch (e) {
    if (seq === S.buildSeq) { S.result = { error: e.message }; drawResult(); }
  }
}

function drawResult(prev) {
  const el = $('#result');
  if (!el) return;
  const r = S.result;
  const c = S.cart;
  if (!c.lines.length || !r) {
    el.innerHTML = `<div class="panel empty"><span class="big-emoji">✨</span><b>Your best cart appears here</b>Add items and we'll find the cheapest way to buy them.
      <div class="baskets" id="cart-baskets" style="margin-top:14px;text-align:left"></div></div>`;
    loadBaskets($('#cart-baskets'));
    updateGauge(0);
    return;
  }
  if (r.error) { el.innerHTML = `<div class="callout warn">${h(r.error)}</div>`; return; }
  if (r.status === 'over_budget') {
    el.innerHTML = `<div class="callout bad"><b>😬 Over budget.</b> ${h(r.message)}</div>`;
    updateGauge(r.must_cost, true);
    animate(el.firstElementChild, { transform: ['translateX(0px)', 'translateX(-8px)', 'translateX(8px)', 'translateX(-4px)', 'translateX(0px)'] }, { duration: 0.4 });
    return;
  }
  const budget = r.mode === 'budget';
  const nStores = r.stores.length;
  const lineName = (x) => `${x.brand ? h(x.brand) + ' ' : ''}${h(x.name)} <span class="muted">${h(x.size)}</span>`;
  const sameShops = prev && prev.stores && prev.stores.map((s) => s.store_id).join() === r.stores.map((s) => s.store_id).join();
  let note = '';
  if (budget) note = r.left_out.length ? `${r.left_out.length} item${r.left_out.length === 1 ? '' : 's'} didn't fit. See below.` : '🎉 Everything fits your budget!';
  else if (r.saving_vs_best_single > 0.005) note = `💡 ${money(r.saving_vs_best_single)} cheaper than buying everything at ${h(r.best_single.store_name)}.`;
  else if (nStores === 1) note = `🏆 ${h(r.stores[0].store_name)} is the cheapest for your whole list.`;

  let html = `<div class="summary" id="summary"><small>${budget ? 'Your budget cart' : 'Cheapest total'}</small>
      <div class="total" id="sum-total">${money(prev && prev.total ? prev.total : 0)}</div>
      <div class="sum-stats">
        <div><small>Specials save</small><b id="sum-save">${money(prev && prev.special_savings ? prev.special_savings : 0)}</b></div>
        <div><small>Shops</small><b>${nStores}</b></div>
        <div><small>${budget ? 'Left over' : 'Items'}</small><b id="sum-3">${budget ? money(r.budget_left) : r.items_bought}</b></div>
      </div>
      ${note ? `<div class="sum-note">${note}</div>` : ''}
      ${r.travel ? `<div class="sum-note">Includes ${money(r.travel)} travel.</div>` : ''}
    </div>`;
  if (r.not_covered.length) html += `<div class="callout warn"><b>Not available within ${r.max_stores} shop${r.max_stores === 1 ? '' : 's'}:</b> ${r.not_covered.map((x) => h(x.name)).join(', ')}. Allow more shops to include them.</div>`;
  if (r.unavailable.length) html += `<div class="callout warn"><b>Not sold at your selected shops:</b> ${r.unavailable.map((x) => h(x.name) + (x.brand ? ` (${h(x.brand)})` : '')).join(', ')}. Try “Any brand” or more shops.</div>`;
  if (nStores) {
    html += `<div class="plans" id="plans">${r.stores.map((s) => `
      <section class="plan"><div class="plan-head">${logo(s.store_id, 'lg')}<div style="text-align:right"><b>${money(s.subtotal)}</b>${s.savings ? `<div class="tag good">saves ${money(s.savings)}</div>` : ''}</div></div>
        <ul>${s.items.map((x) => `<li><input type="checkbox" aria-label="Got ${h(x.name)}"><span class="em">${emojiFor(x.name, x.category)}</span><div><div class="pl-name">${x.qty} × ${lineName(x)}</div>
          <div class="pl-sub">${x.on_special ? `<span class="tag special">${h(x.special_label || 'Special')}</span> ${h(until(x.valid_until))}` : `${money(x.unit_price)} each`}${x.source === 'sample' ? ' · sample' : ''}</div></div>
          <div class="pl-price">${money(x.line_total)}${x.on_special && x.saving > 0 ? `<small><s>${money(x.regular_price * x.qty)}</s></small>` : ''}</div></li>`).join('')}</ul></section>`).join('')}</div>`;
  }
  if (r.left_out.length) {
    html += `<div class="panel leftout"><h3 style="margin-top:0">Didn't fit your budget</h3><ul>${r.left_out.map((x) => `<li><span>${emojiFor(x.name, x.category)} ${x.wanted - x.bought} × ${h(x.name)} <span class="muted">${h(x.size)}</span></span>
      <span class="tag">+${money(x.extra_needed)}</span></li>`).join('')}</ul></div>`;
  }
  if (r.comparison.length) {
    const max = Math.max(...r.comparison.map((x) => x.total), r.items_total);
    html += `<details class="panel bars-wrap" ${prev ? '' : ''}><summary style="cursor:pointer;font-weight:800">📊 ${budget ? 'Your full list at each shop' : 'Compare shops'}</summary><div class="bars" style="margin-top:12px">
      <div class="bar smart"><span class="bar-name">This plan</span><div class="bar-track"><div class="bar-fill" style="width:${(100 * r.items_total / max).toFixed(1)}%"></div><span class="bar-label">${nStores} shop${nStores === 1 ? '' : 's'}</span></div><div class="bar-val">${money(r.items_total)}</div></div>
      ${r.comparison.slice(0, 12).map((x, i) => `<div class="bar ${i === 0 ? 'cheapest' : ''}">${logo(x.store_id)}<div class="bar-track"><div class="bar-fill" style="width:${(100 * x.total / max).toFixed(1)}%"></div>${i === 0 ? '<span class="bar-label">cheapest single shop</span>' : ''}</div>
        <div class="bar-val">${money(x.total)}${x.missing ? `<small>${x.missing} missing</small>` : ''}</div></div>`).join('')}
    </div><p class="muted" style="font-size:.78rem;margin-bottom:0">Totals for the items each shop stocks, before travel.</p></details>`;
  }
  html += `<div class="actions">
      <button class="btn primary" type="button" id="save-list">💾 ${c.listId ? 'Update saved list' : 'Save list'}</button>
      <a class="btn green" id="wa" target="_blank" rel="noopener">📲 WhatsApp</a>
      <button class="btn" type="button" id="copy-plan">📋 Copy</button>
      <button class="btn" type="button" id="print-plan">🖨️ Print</button>
    </div><div id="save-box"></div>`;
  el.innerHTML = html;

  countTo($('#sum-total'), r.total, money);
  countTo($('#sum-save'), r.special_savings, money);
  updateGauge(r.total, false);
  if (!sameShops) reveal($$('#plans .plan'), { step: 0.08, y: 20 });
  const bw = $('.bars-wrap');
  if (bw) bw.addEventListener('toggle', () => { if (bw.open) animate($$('.bar-fill', bw), { transform: ['scaleX(0)', 'scaleX(1)'] }, { duration: 0.7, delay: MO ? MO.stagger(0.04) : 0, ease: EASE }); });
  $('#wa').href = 'https://wa.me/?text=' + encodeURIComponent(planText(r));
  $('#copy-plan').onclick = async () => { try { await navigator.clipboard.writeText(planText(r)); toast('Shopping plan copied'); } catch { toast("Couldn't copy. Try Print instead."); } };
  $('#print-plan').onclick = () => window.print();
  $('#save-list').onclick = saveListPrompt;
  $$('.plan input[type=checkbox]', el).forEach((cb) => cb.onchange = () => { cb.closest('li').classList.toggle('done', cb.checked); if (cb.checked) pop(cb.closest('li').querySelector('.em')); });

  const fitsNow = budget && !r.left_out.length;
  const fitsBefore = prev && prev.mode === 'budget' && prev.left_out && !prev.left_out.length;
  if (S.celebrate || (fitsNow && prev && !fitsBefore)) { S.celebrate = false; setTimeout(() => confettiFrom($('#summary')), 150); }
}

function updateGauge(spent, over) {
  const fg = $('#g-fg');
  if (!fg) return;
  const b = S.cart.budget || 1;
  const frac = Math.min(1, spent / b);
  const C = 364.42;
  const to = C * (1 - frac);
  const from = parseFloat(fg.getAttribute('stroke-dashoffset')) || C;
  $('#gauge').classList.toggle('over', !!over || spent > b);
  if (MO && !REDUCED) {
    try { MO.animate(from, to, { duration: 0.9, ease: EASE, onUpdate: (v) => fg.setAttribute('stroke-dashoffset', v) }); } catch { fg.setAttribute('stroke-dashoffset', to); }
  } else fg.setAttribute('stroke-dashoffset', to);
  countTo($('#g-spent'), spent, money0);
  $('#g-of').textContent = over ? 'must-haves need' : `of ${money0(b)}`;
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
  box.innerHTML = `<form class="row" id="save-form" style="margin-top:10px"><input id="list-name" maxlength="60" value="${h(def)}" aria-label="List name" style="flex:1;min-width:160px">
    <button class="btn primary" type="submit">Save</button>${S.cart.listId ? '<button class="btn" type="button" id="save-new">Save as new</button>' : ''}</form>`;
  reveal([box.firstElementChild], { y: 8 });
  const doSave = async (asNew) => {
    const name = $('#list-name').value.trim() || def;
    const c = S.cart;
    const data = { lines: c.lines, mode: c.mode, budget: c.budget, maxStores: c.maxStores, tripCost: c.tripCost, stores: c.stores, total: S.result ? S.result.total : null };
    try {
      const saved = c.listId && !asNew ? await api('/api/lists/' + c.listId, { method: 'PUT', body: { name, data } }) : await api('/api/lists', { body: { name, data } });
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

// ------------------------------------------------------------------ me: account, lists, reports, admin
async function renderMe() {
  if (!S.user) {
    view.innerHTML = `<section class="hero" style="grid-template-columns:1fr"><div><h1>Join Smart Basket 👋</h1>
      <p class="hero-sub">A free account keeps your lists, your shops and your savings in one place.</p>
      <div class="row"><button class="btn gold big" type="button" data-register>Create a free account</button><button class="btn big" type="button" data-signin>Sign in</button></div></div></section>
      <div class="benefits"><div><span>💾</span>Save shopping lists and budgets</div><div><span>🏪</span>Pick the shops near you</div>
      <div><span>📣</span>Share specials you spot in store</div><div><span>📲</span>Send plans to WhatsApp</div></div>
      <div class="section-head"><div><h2>📣 Specials spotted by shoppers</h2></div></div><div class="feed" id="recent"></div>`;
    reveal($$('.benefits > div'), { step: 0.08 });
    loadRecent();
    return;
  }
  const u = S.user;
  const ini = u.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  view.innerHTML = `<div class="me-hero"><span class="avatar">${h(ini)}</span><div style="flex:1"><h1 style="margin:0">Hi, ${h(u.name.split(' ')[0])}!</h1>
      <span class="muted">${h(u.email)}${u.town ? ' · ' + h(u.town) : ''}${u.is_admin ? ' · admin' : ''}</span></div>
      <button class="btn green" type="button" id="share-special">📣 Share a special</button><button class="btn" type="button" id="logout">Sign out</button></div>
    <div class="two">
      <div class="stack">
        <section class="panel"><h2>📋 My saved lists</h2><div class="cards" id="lists"><div class="sk" style="min-height:120px"></div></div></section>
        <section class="panel"><h2>📣 Specials spotted by shoppers</h2><div class="feed" id="recent"></div></section>
      </div>
      <div class="stack">
        <form class="panel" id="myshops"><h2>🏪 My shops</h2><p class="muted" style="margin-top:-6px">Shops you can get to. “My shops” in the cart uses these.</p>
          <div class="store-toggles">${S.meta.stores.map((s) => `<button class="store-toggle" type="button" data-store="${h(s.id)}" aria-pressed="${u.stores.includes(s.id)}" title="${h(s.name)}">${logo(s.id)}</button>`).join('')}</div>
          <button class="btn primary" type="submit" style="margin-top:12px">Save my shops</button></form>
        <form class="panel" id="profile"><h2>👤 Profile</h2>
          <label>Name<input name="name" maxlength="60" value="${h(u.name)}"></label>
          <label>Town<input name="town" maxlength="60" list="towns" value="${h(u.town)}"></label>
          <button class="btn primary" type="submit">Save</button></form>
        <form class="panel" id="pw"><h2>🔑 Password</h2>
          <label>Current password<input type="password" name="old" autocomplete="current-password"></label>
          <label>New password<input type="password" name="new" autocomplete="new-password" minlength="8"></label>
          <button class="btn" type="submit">Change password</button></form>
        <div class="panel"><h2>🗑️ Delete account</h2><p class="muted">Removes your account and saved lists. Specials you shared stay, without your name.</p>
          <button class="btn danger" type="button" id="del-acc">Delete my account</button></div>
      </div>
    </div>
    <div id="admin"></div>`;
  reveal($$('.panel', view), { step: 0.05 });
  const picked = new Set(u.stores);
  $('#myshops .store-toggles').onclick = (e) => {
    const b = e.target.closest('[data-store]');
    if (!b) return;
    picked.has(b.dataset.store) ? picked.delete(b.dataset.store) : picked.add(b.dataset.store);
    b.setAttribute('aria-pressed', picked.has(b.dataset.store)); pop(b);
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
  $('#logout').onclick = async () => { await api('/api/auth/logout', { body: {} }).catch(() => {}); S.user = null; renderAccountButton(); toast('Signed out'); location.hash = '#/deals'; };
  $('#del-acc').onclick = async () => {
    if (!confirm('Delete your account and saved lists? This cannot be undone.')) return;
    try { await api('/api/me', { method: 'DELETE' }); S.user = null; renderAccountButton(); toast('Account deleted'); location.hash = '#/deals'; } catch (x) { toast(x.message); }
  };
  $('#share-special').onclick = openReport;
  loadLists();
  loadRecent();
  if (u.is_admin) renderAdmin($('#admin'));
}

async function loadLists() {
  let d;
  try { d = await api('/api/lists'); } catch (e) { $('#lists').innerHTML = `<div class="empty">${h(e.message)}</div>`; return; }
  const el = $('#lists');
  if (!el) return;
  el.innerHTML = d.lists.length ? d.lists.map((l) => {
    const items = (l.data.lines || []).length;
    return `<article class="card" data-id="${l.id}"><div class="row between"><b>${h(l.name)}</b><span class="tag">${l.data.mode === 'budget' ? '💰 ' + money0(l.data.budget) : '🧮 Cheapest'}</span></div>
      <div style="font-size:1.3rem">${(l.data.lines || []).slice(0, 8).map((x) => emojiFor(x.name, x.category)).join(' ')}</div>
      <div class="muted" style="font-size:.82rem">${items} item${items === 1 ? '' : 's'}${l.data.total ? ' · last total ' + money(l.data.total) : ''} · ${h(fmtDate(l.updated_at))}</div>
      <div class="row"><button class="btn primary small" type="button" data-open>Open in cart</button><button class="btn small danger" type="button" data-del>Delete</button></div></article>`;
  }).join('') : '<div class="empty" style="grid-column:1/-1"><span class="big-emoji">📝</span><b>No saved lists yet</b>Build a cart and tap “Save list”.</div>';
  reveal(el.children, { step: 0.05 });
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
      try { await api('/api/lists/' + l.id, { method: 'DELETE' }); if (S.cart.listId === l.id) { S.cart.listId = null; saveCart(); } loadLists(); } catch (err) { toast(err.message); }
    }
  };
}

async function loadRecent() {
  try {
    const d = await api('/api/reports/recent?limit=12');
    const el = $('#recent');
    if (!el) return;
    el.innerHTML = d.reports.length ? d.reports.map((r) => `<div class="feed-item">${logo(r.store_id, 'sm')}
      <div><b>${h(r.brand)} ${h(r.name)}</b> <span class="muted">${h(r.size)}</span><div class="muted" style="font-size:.78rem">${h(r.label || 'Special')} · until ${h(fmtDate(r.valid_until))} · 👋 ${h(r.reporter)}${r.branch ? ' · ' + h(r.branch) : ''}</div></div>
      <div class="price" style="text-align:right"><b style="color:var(--red)">${money(r.special_price)}</b>${r.price ? `<br><s class="was">${money(r.price)}</s>` : ''}</div></div>`).join('')
      : '<div class="empty"><b>No specials shared yet</b>Spotted a bargain? Share it!</div>';
    reveal(el.children, { step: 0.04, y: 8 });
  } catch { /* ignore */ }
}

function openReport() {
  if (!S.user) { openAuth('login', 'Sign in to share specials.'); return; }
  const box = $('#report-body');
  const st = { store: null, item: null };
  box.innerHTML = `<form id="rep" novalidate>
    <div class="opt-title" style="margin-top:0">Shop</div>
    <div class="store-toggles pick" id="rep-shops" role="group" aria-label="Shop">${S.meta.stores.map((s) => `<button class="store-toggle" type="button" data-store="${h(s.id)}" aria-pressed="false" title="${h(s.name)}">${logo(s.id)}</button>`).join('')}</div>
    <label style="margin-top:12px">Product
      <div class="addbox"><span class="icon">🔎</span><input type="search" id="rep-q" placeholder="Search: maize meal, Sunfoil…" autocomplete="off"><div class="suggest" id="rep-suggest" hidden></div></div>
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
    <button class="btn green big wide" type="submit">📣 Share this special</button></form>`;
  $('#rep-shops').onclick = (e) => {
    const b = e.target.closest('[data-store]');
    if (!b) return;
    st.store = b.dataset.store;
    $$('#rep-shops [data-store]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    pop(b);
  };
  attachSuggest($('#rep-q'), $('#rep-suggest'), async (it) => {
    st.item = it;
    $('#rep-picked').innerHTML = `<div class="picked"><span>${emojiFor(it.name, it.category)} ${h(it.name)} <span class="muted">${h(it.size)}</span></span><button class="btn small" type="button" id="rep-unpick">Change</button></div>`;
    $('#rep-q').closest('.addbox').hidden = true;
    $('#rep-unpick').onclick = () => { st.item = null; $('#rep-picked').innerHTML = ''; $('#rep-brand').innerHTML = ''; $('#rep-q').closest('.addbox').hidden = false; $('#rep-q').focus(); };
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
      $('#report-dialog').close();
      confetti();
      toast('🎉 Thanks! Your special is live.');
      delete S.items[st.item.id];
      if (S.view === 'me') loadRecent();
    } catch (ex) { err.textContent = ex.message; }
  };
  $('#report-dialog').showModal();
}

async function renderAdmin(box) {
  let d;
  try { d = await api('/api/admin/summary'); } catch (e) { box.innerHTML = `<div class="empty">${h(e.message)}</div>`; return; }
  const fs = d.feeds_status || {};
  box.innerHTML = `<div class="section-head"><div><h2>⚙️ Admin</h2><p class="muted">Keep prices fresh for everyone.</p></div></div>
    <div class="two">
      <div class="stack">
        <form class="panel" id="claude-key"><h2>🤖 Read pamphlets with Claude</h2>
          <p class="muted" style="margin-top:-6px">${S.meta.claude ? '✅ Connected. New pamphlets are read automatically on every refresh.' : 'Add an Anthropic API key and every pamphlet the Refresh button finds is read automatically: products, prices and dates become specials.'}</p>
          <label>Anthropic API key<input type="password" name="key" autocomplete="off" placeholder="sk-ant-…"></label>
          <button class="btn primary" type="submit">${S.meta.claude ? 'Replace key' : 'Connect Claude'}</button></form>
        <div class="panel"><h2>🔄 Pamphlets &amp; feeds</h2><p class="muted" style="margin-top:-6px">${lastRefreshText()}</p>
          <button class="btn gold" type="button" id="force-refresh">Refresh everything now</button>
          ${fs.at ? `<p class="muted" style="font-size:.82rem">Feeds ${h(ago(fs.at))}: ${fs.results.map((r) => `${h(r.name)} ${r.ok ? '✓ ' + r.imported : '✗'}`).join('; ')}</p>` : ''}</div>
        <div class="panel"><h2>🧪 Sample prices</h2><p class="muted" style="margin-top:-6px">Illustrative prices that fill gaps until real data arrives.</p>
          <button class="btn ${d.sample_enabled ? 'danger' : 'green'}" type="button" id="sample-toggle">${d.sample_enabled ? 'Turn sample prices off' : 'Turn sample prices on'}</button></div>
      </div>
      <div class="stack">
        <form class="panel" id="imp"><h2>📥 Import prices</h2>
          <p class="muted" style="margin-top:-6px">CSV or JSON with <code>store, item, size, brand, price, special_price, special_label, valid_until</code>.</p>
          <label>File<input type="file" id="imp-file" accept=".csv,.json,.txt,text/csv,application/json"></label>
          <label>…or paste<textarea id="imp-text" rows="5"></textarea></label>
          <button class="btn primary" type="submit">Import</button><div id="imp-out" style="margin-top:10px"></div></form>
        <div class="panel"><h2>📊 Prices by source</h2><table class="simple"><tr><th>Source</th><th>Rows</th><th>Latest</th></tr>
          ${d.price_rows.map((r) => `<tr><td>${h(r.source)}</td><td>${r.n}</td><td>${h(fmtDate(r.latest))}</td></tr>`).join('')}</table>
          <p class="muted" style="font-size:.82rem">${d.users} registered user${d.users === 1 ? '' : 's'}.</p></div>
      </div>
    </div>`;
  $('#claude-key').onsubmit = async (e) => {
    e.preventDefault();
    const key = new FormData(e.target).get('key');
    try { await api('/api/admin/claude-key', { body: { key } }); await loadMeta(); toast('🤖 Claude connected'); renderAdmin(box); } catch (x) { toast(x.message); }
  };
  $('#force-refresh').onclick = async () => {
    try { R.userStarted = true; const s = await api('/api/refresh', { body: { force: true } }); $('#refresh-btn').classList.add('spinning'); showRefresh(s); pollRefresh(); } catch (x) { toast(x.message); }
  };
  $('#sample-toggle').onclick = async () => {
    try { await api('/api/admin/sample', { body: { enabled: !d.sample_enabled } }); S.items = {}; S.baskets = null; await loadMeta(); renderAdmin(box); } catch (x) { toast(x.message); }
  };
  $('#imp-file').onchange = async (e) => { const f = e.target.files[0]; if (f) $('#imp-text').value = await f.text(); };
  $('#imp').onsubmit = async (e) => {
    e.preventDefault();
    const out = $('#imp-out');
    const text = $('#imp-text').value;
    if (!text.trim()) { out.innerHTML = '<p class="form-error">Choose a file or paste some rows.</p>'; return; }
    try {
      const r = await api('/api/admin/import', { body: { text } });
      out.innerHTML = `<div class="callout ${r.errors.length ? 'warn' : 'ok'}">Imported ${r.imported} price${r.imported === 1 ? '' : 's'}.${r.errors.length ? '<br>' + r.errors.map(h).join('<br>') : ''}</div>`;
      S.items = {}; S.baskets = null;
      await loadMeta();
    } catch (x) { out.innerHTML = `<p class="form-error">${h(x.message)}</p>`; }
  };
}

// ------------------------------------------------------------------ connect Claude (desktop app)
function openClaude() {
  $('#claude-error').textContent = '';
  $('#claude-dialog').showModal();
  $('#claude-form [name=key]').focus();
}
$('#claude-form').onsubmit = async (e) => {
  e.preventDefault();
  const key = new FormData(e.target).get('key').trim();
  if (key.length < 20) { $('#claude-error').textContent = 'Paste the whole key. It starts with sk-ant-.'; return; }
  try {
    await api('/api/admin/claude-key', { body: { key } });
    e.target.reset();
    $('#claude-dialog').close();
    await loadMeta();
    confetti();
    toast('🤖 Claude connected. Tap Refresh to read this week\'s pamphlets.');
    if (S.view === 'pamphlets') route();
  } catch (x) { $('#claude-error').textContent = x.message; }
};

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
  $('#auth-sub').textContent = reg ? 'Save lists, choose your shops and share specials with other shoppers.' : 'Sign in to save your lists, pick your shops and share specials.';
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
    if (authMode === 'register') confetti();
    toast(authMode === 'register' ? `Welcome, ${S.user.name.split(' ')[0]}! 🎉` : `Welcome back, ${S.user.name.split(' ')[0]} 👋`);
    route();
  } catch (x) {
    $('#auth-error').textContent = x.message;
    animate($('#auth-dialog'), { transform: ['translateX(0px)', 'translateX(-8px)', 'translateX(8px)', 'translateX(0px)'] }, { duration: 0.3 });
  } finally { btn.disabled = false; }
};

// ------------------------------------------------------------------ global clicks
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-signin]')) openAuth('login');
  if (e.target.closest('[data-register]')) openAuth('register');
  if (e.target.closest('[data-refresh]') || e.target.closest('#refresh-btn')) startRefresh();
  if (e.target.closest('[data-claude]')) openClaude();
  const deal = e.target.closest('[data-add-deal]');
  if (deal) {
    const x = S.deals[deal.dataset.addDeal];
    if (x) {
      addToCart({ item_id: x.item_id, product_id: x.product_id, name: x.name, size: x.size, brand: x.brand, category: x.category }, 1, { from: deal });
      if (deal.classList.contains('add-btn')) {
        deal.classList.add('added'); deal.textContent = '✓ Added'; pop(deal);
        setTimeout(() => { deal.classList.remove('added'); deal.textContent = '＋ Add'; }, 1600);
      }
    }
  }
  const basket = e.target.closest('[data-basket]');
  if (basket) {
    if (basket.classList.contains('chip')) {
      const b = (S.baskets || []).find((x) => x.id === basket.dataset.basket);
      if (b) {
        b.lines.forEach((ln) => addToCart({ item_id: ln.item_id, name: ln.name, size: ln.size }, ln.qty, { quiet: true }));
        toast(`${b.emoji} Added ${b.name}`); pop(basket);
        drawLines(false, true); loadLineDetails(); changed();
      }
    } else useBasket(basket.dataset.basket, basket);
  }
  const open = e.target.closest('[data-open]');
  if (open && S.view === 'pamphlets') openViewer(open.dataset.open);
});

// ------------------------------------------------------------------ routing & start
const VIEWS = { deals: renderDeals, pamphlets: renderPamphlets, compare: renderCompare, cart: renderCart, me: renderMe };
function route() {
  const v = location.hash.replace(/^#\/?/, '').split('/')[0] || 'deals';
  S.view = VIEWS[v] ? v : 'deals';
  clearTimers();
  $$('#tabs a').forEach((a) => {
    const on = a.dataset.view === S.view;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const go = () => VIEWS[S.view]();
  if (document.startViewTransition && !REDUCED) document.startViewTransition(go); else go();
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
    view.innerHTML = `<div class="panel empty"><span class="big-emoji">📡</span><b>Can't reach the server</b>${h(e.message)}</div>`;
    return;
  }
  route();
  if (S.meta.refreshing) { $('#refresh-btn').classList.add('spinning'); pollRefresh(); }
})();
