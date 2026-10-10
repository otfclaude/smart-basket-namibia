'use strict';
/* Smart Basket Namibia: single-page front end (no build step). Animations use Motion (motion.dev);
   PDF pamphlets are drawn by pdf.js inside the app's own reader. */

// ------------------------------------------------------------------ helpers
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => 'N$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = (n) => 'N$' + Math.round(Number(n || 0)).toLocaleString('en-US');
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
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
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const top = $$('dialog[open]').pop();
    if (top) { const ev = new Event('cancel', { cancelable: true }); top.dispatchEvent(ev); if (!ev.defaultPrevented) top.close(); }
  });
})();
const PRIOS = [['must', 'Must have'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Nice to have']];

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
  if (!iso) return 'While stocks last';
  const n = daysFromToday(iso);
  if (n <= 0) return 'Ends today';
  if (n === 1) return 'Ends tomorrow';
  return 'Until ' + fmtDate(iso);
}
function endsSoon(iso) { return !!iso && daysFromToday(iso) <= 1; }
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
function validity(l) {
  if (l.valid_until) return 'Valid ' + (l.valid_from ? fmtDate(l.valid_from, { day: 'numeric', month: 'short' }) + ' – ' : 'until ') + fmtDate(l.valid_until, { day: 'numeric', month: 'short' });
  return 'Fetched ' + ago(l.fetched_at);
}

// ------------------------------------------------------------------ icons (24px line icons)
const ICONS = {
  tag: '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><path d="M7.5 7.5h.01"/>',
  book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  scale: '<path d="m16 16 3-8 3 8c-.9.7-1.9 1-3 1s-2.1-.3-3-1Z"/><path d="m2 16 3-8 3 8c-.9.7-1.9 1-3 1s-2.1-.3-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2 2h2l2.7 12.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L22 7H5.1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.8 9.8 0 0 1 6.7 2.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.8 9.8 0 0 1-6.7-2.7L3 16"/><path d="M8 16H3v5"/>',
  search: '<circle cx="11" cy="11" r="7.5"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  chevLeft: '<path d="m15 18-6-6 6-6"/>',
  chevRight: '<path d="m9 18 6-6-6-6"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  zoomIn: '<circle cx="11" cy="11" r="7.5"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7.5"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/>',
  store: '<path d="M3 9.5 4.6 4a1.4 1.4 0 0 1 1.3-1h12.2a1.4 1.4 0 0 1 1.3 1L21 9.5"/><path d="M3 9.5a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8"/><path d="M10 21v-5h4v5"/>',
  wallet: '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v3"/><path d="M3 5v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><path d="M21 12h-4a2 2 0 0 0 0 4h4z"/>',
  trendDown: '<path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
  sliders: '<path d="M4 6h9"/><path d="M17 6h3"/><path d="M4 12h3"/><path d="M11 12h9"/><path d="M4 18h11"/><path d="M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  copy: '<rect width="13" height="13" x="8" y="8" rx="2"/><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"/>',
  printer: '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3h12v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  checkCircle: '<circle cx="12" cy="12" r="9.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
  basket: '<path d="m15 11-1 9"/><path d="m19 11-4-7"/><path d="M2 11h20"/><path d="m3.5 11 1.6 7.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6l1.7-7.4"/><path d="M4.5 15.5h15"/><path d="m5 11 4-7"/><path d="m9 11 1 9"/>',
  bag: '<path d="M6 7h12l1.2 13a1 1 0 0 1-1 1H5.8a1 1 0 0 1-1-1z"/><path d="M9 7V6a3 3 0 0 1 6 0v1"/>',
  sack: '<path d="M8.5 6.5h7"/><path d="M9 6.5 7.6 3.7A.5.5 0 0 1 8 3h8a.5.5 0 0 1 .4.7L15 6.5"/><path d="M8.5 6.5C5.5 9 4 12.5 4 16a5 5 0 0 0 5 5h6a5 5 0 0 0 5-5c0-3.5-1.5-7-4.5-9.5"/><path d="M10 14h4"/>',
  bread: '<path d="M5 10.5A3.5 3.5 0 0 1 7.5 4h9A3.5 3.5 0 0 1 19 10.5V19a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/><path d="m9.5 9 1.5-1.5"/><path d="m13 9 1.5-1.5"/>',
  milk: '<path d="M8 2.5h8"/><path d="M8.5 2.5V6L6 9.5V20a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 20V9.5L15.5 6V2.5"/><path d="M6 13h12"/>',
  fish: '<path d="M2.5 12c3-4.5 9-6 13.5-2.6L20.5 6v12L16 14.6C11.5 18 5.5 16.5 2.5 12z"/><path d="M7.5 11.5h.01"/>',
  apple: '<path d="M12 7.5c-1.6-1-4.8-1.4-6.4 1.2C4 11.5 5 16.6 7.4 19.4c1.2 1.4 2.8 1.8 4.6.9 1.8.9 3.4.5 4.6-.9C19 16.6 20 11.5 18.4 8.7 16.8 6.1 13.6 6.5 12 7.5z"/><path d="M12 7.5c0-2.2 1-3.8 3-4.5"/>',
  can: '<ellipse cx="12" cy="5.5" rx="7" ry="2.5"/><path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13"/><path d="M5 10c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/><path d="M5 14.5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/>',
  bottle: '<path d="M10 2h4"/><path d="M10.5 2v3.5L8 9v11a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V9l-2.5-3.5V2"/><path d="M8 12.5h8"/><path d="M8 17h8"/>',
  babyBottle: '<path d="M10 7V5.5a2 2 0 0 1 4 0V7"/><path d="M8.5 7h7"/><path d="M9 7 8 9.5V20a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V9.5L15 7"/><path d="M8 13h3"/><path d="M8 16.5h3"/>',
  spray: '<path d="M8 9h5l1.5 3.5V20a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-7.5z"/><path d="M9 9V5.5h3.5L16 7l-3.5 1.5"/><path d="M19 5h.01"/><path d="M20.5 8h.01"/><path d="M19 11h.01"/>',
  pump: '<path d="M8 11h8v9a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2z"/><path d="M10 11V8h4v3"/><path d="M12 8V4"/><path d="M12 4h4.5v2"/><path d="M8 15.5h8"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4.1 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  cup: '<path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><path d="M6 2v2"/><path d="M10 2v2"/><path d="M14 2v2"/>',
  backpack: '<path d="M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M8 22v-6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M8 10h8"/>',
  pin: '<path d="M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 0 1-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
};
const ic = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.bag}</svg>`;
function hydrateIcons(root = document) { $$('i[data-icon]', root).forEach((el) => { el.outerHTML = ic(el.dataset.icon, el.className); }); }

// ------------------------------------------------------------------ product categories (icon + colour stand in for photos)
const CATS = {
  'Staples & grains': ['sack', '#b7791f'], Bakery: ['bread', '#a0612b'], 'Dairy & eggs': ['milk', '#2f6fd0'], 'Meat & fish': ['fish', '#c2412d'],
  'Fruit & veg': ['apple', '#2f8a4c'], 'Pantry & tins': ['can', '#b4561f'], Drinks: ['bottle', '#7a4cc2'], Baby: ['babyBottle', '#c2477e'],
  'Household & cleaning': ['spray', '#18808a'], 'Personal care': ['pump', '#5b5bd6'],
};
const GUESS = [[/nappies|nappy|wipes|baby|formula|purity/, 'Baby'],
  [/washing|laundry|detergent|bleach|dish|cleaner|handy|refuse|bin bag|candle|match|insect|doom|toilet/, 'Household & cleaning'],
  [/toothpaste|soap|lotion|vaseline|deodorant|roll-on|pads|sanitary|shampoo/, 'Personal care'],
  [/juice|concentrate|cordial|soft drink|coke|cola|soda|water|beer|wine/, 'Drinks'],
  [/sauce|ketchup|beans|chakalaka|soup|stock|jam|peanut|salt|oil|tea|rooibos|coffee|pilchard|tuna|tin/, 'Pantry & tins'],
  [/bread|loaf|roll|bun/, 'Bakery'], [/milk|omaere|maas|egg|cheese|cheddar|yoghurt|yogurt|butter|margarine/, 'Dairy & eggs'],
  [/chicken|mince|beef|stew|steak|boerewors|wors|sausage|polony|vienna|hake|fish/, 'Meat & fish'],
  [/potato|onion|tomato|cabbage|spinach|apple|banana|orange/, 'Fruit & veg'],
  [/maize|mahangu|mielie|pap|rice|flour|sugar|spaghetti|macaroni|pasta|oats|cereal|flakes/, 'Staples & grains']];
function catOf(name, category) {
  if (CATS[category]) return category;
  const n = (name || '').toLowerCase();
  for (const [re, c] of GUESS) if (re.test(n)) return c;
  return '';
}
function rgba(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
function tile(iconName, color, size = '') {
  const style = color ? ` style="--tile-bg:${rgba(color, 0.12)};--tile-fg:${color}"` : '';
  return `<span class="cat-tile ${size}"${style}>${ic(iconName)}</span>`;
}
function catTile(category, name, size = '') {
  const c = CATS[catOf(name, category)];
  return c ? tile(c[0], c[1], size) : tile('bag', '', size);
}
const BASKET_ICON = { 'month-end': ['sack', '#b7791f'], braai: ['flame', '#c2412d'], breakfast: ['cup', '#a0612b'], baby: ['babyBottle', '#c2477e'],
  cleaning: ['spray', '#18808a'], student: ['backpack', '#5b5bd6'] };

// a price with a small currency sign and cents, like a shelf label
function amt(n) {
  const [r, c] = Number(n || 0).toFixed(2).split('.');
  return `<span class="amt price"><span class="cur">N$</span>${Number(r).toLocaleString('en-US')}<span class="ct">.${c}</span></span>`;
}

let toastTimer;
function toast(msg, kind = 'ok') {
  const t = $('#toast');
  t.className = kind === 'err' ? 'err' : '';
  t.innerHTML = `${ic(kind === 'err' ? 'alert' : kind === 'info' ? 'info' : 'checkCircle')}<span>${h(msg)}</span>`;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ------------------------------------------------------------------ motion
const MO = window.Motion || null;
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = [0.22, 1, 0.36, 1];
const SPRING = { type: 'spring', bounce: 0.16, duration: 0.5 };
function animate(el, kf, opts) {
  if (!MO || REDUCED || !el) return null;
  try { return MO.animate(el, kf, opts); } catch { return null; }
}
function done(a, fn) { if (a && a.then) a.then(fn, fn); else fn(); }
function reveal(els, opts = {}) {
  els = [...els].filter(Boolean);
  if (!els.length || !MO || REDUCED) return;
  const step = opts.step ?? 0.03, start = opts.start ?? 0;
  try {
    const a = MO.animate(els, { opacity: [0, 1], transform: [`translateY(${opts.y ?? 10}px) scale(${opts.scale ?? 1})`, 'translateY(0px) scale(1)'] },
      { duration: opts.duration ?? 0.45, delay: (i) => start + Math.min(i, 12) * step, ease: EASE });
    done(a, () => els.forEach((e) => { e.style.transform = ''; e.style.opacity = ''; }));
  } catch { /* ignore */ }
}
function countTo(el, to, fmt = (v) => Math.round(v).toLocaleString('en-US')) {
  if (!el) return;
  const from = parseFloat(el.dataset.v || '0') || 0;
  el.dataset.v = to;
  if (!MO || REDUCED || from === to) { el.textContent = fmt(to); return; }
  try { MO.animate(from, to, { duration: 0.8, ease: EASE, onUpdate: (v) => { el.textContent = fmt(v); } }); } catch { el.textContent = fmt(to); }
}
function pop(el, s = 1.12) { animate(el, { transform: ['scale(1)', `scale(${s})`, 'scale(1)'] }, { duration: 0.35, ease: EASE }); }
function flyToCart(fromEl) {
  const target = $('#cart-tab .i');
  if (!fromEl || !target || !MO || REDUCED) { bumpCart(); return; }
  const a = fromEl.getBoundingClientRect(), b = target.getBoundingClientRect();
  const dot = document.createElement('div');
  dot.className = 'fly-dot';
  $('#fx').append(dot);
  const x0 = a.left + a.width / 2 - 6, y0 = a.top + a.height / 2 - 6, x1 = b.left + b.width / 2 - 6, y1 = b.top + b.height / 2 - 6;
  const mx = x0 + (x1 - x0) * 0.35, my = Math.min(y0, y1) - Math.max(60, Math.abs(y1 - y0) * 0.25);
  const anim = animate(dot, { transform: [`translate(${x0}px,${y0}px) scale(.6)`, `translate(${mx}px,${my}px) scale(1.15)`, `translate(${x1}px,${y1}px) scale(.5)`],
    opacity: [0, 1, 0.9] }, { duration: 0.6, ease: [0.45, 0, 0.2, 1] });
  done(anim, () => { dot.remove(); bumpCart(); });
}
function bumpCart() { animate($('#cart-tab .i'), { transform: ['scale(1)', 'scale(1.28) rotate(-8deg)', 'scale(1)'] }, { duration: 0.45, ease: EASE }); }

// ------------------------------------------------------------------ state
const S = {
  meta: null, user: null, byId: {}, items: {}, view: 'deals', timers: [], deals: {}, leaflets: null,
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
let shownCount = null;
function updateCartCount() {
  const n = S.cart.lines.reduce((a, l) => a + l.qty, 0);
  const el = $('#cart-count');
  el.hidden = n === 0;
  if (n === shownCount) return;
  const up = shownCount !== null && n > shownCount;
  shownCount = n;
  el.innerHTML = `<span>${n > 99 ? '99+' : n}</span>`;
  if (up) animate(el.firstChild, { transform: ['translateY(80%)', 'translateY(0%)'], opacity: [0, 1] }, { duration: 0.35, ease: EASE });
}
function addToCart(e, qty = 1, opts = {}) {
  const pid = e.product_id || null;
  const ex = S.cart.lines.find((l) => l.item_id === e.item_id && (l.product_id || null) === pid);
  if (ex) ex.qty = Math.min(99, ex.qty + qty);
  else S.cart.lines.push({ key: uid(), item_id: e.item_id, product_id: pid, name: e.name, size: e.size || '', brand: e.brand || null,
    category: e.category || '', qty, priority: 'high' });
  saveCart();
  if (opts.from) flyToCart(opts.from); else bumpCart();
  if (!opts.quiet) toast(`Added ${e.brand && pid ? e.brand + ' ' : ''}${e.name} ${e.size || ''}`.trim());
}
function rememberDeal(x) { const k = `${x.store_id}|${x.product_id}`; S.deals[k] = x; return k; }

const storeName = (id) => (S.byId[id] ? S.byId[id].name : id);
const logo = (id, cls = '') => `<span class="logo ${cls}" title="${h(storeName(id))}"><img src="/logos/${encodeURIComponent(id)}.svg?v=${S.meta ? S.meta.logo_version : 0}" alt="${h(storeName(id))}" loading="lazy"></span>`;
function sourceText(x) {
  const s = x.source || '';
  if (s === 'sample') return 'Sample price';
  if (s === 'community') return `Shopper${x.reporter ? ': ' + x.reporter : ''}`;
  if (s.startsWith('leaflet:')) return 'Shop pamphlet';
  if (s.startsWith('feed:')) return 'Price feed';
  return 'Shop leaflet';
}
function sourceTag(x) {
  const s = x.source || '';
  if (s === 'sample') return '<span class="tag sample" title="Illustrative price, not from the shop">Sample</span>';
  if (s === 'community') return `<span class="tag" title="Reported by a shopper${x.branch ? ' at ' + h(x.branch) : ''}">${ic('users')} ${h(x.reporter || 'Shopper')}</span>`;
  if (s.startsWith('leaflet:')) return `<span class="tag accent" title="Read from the shop's pamphlet">${ic('book')} Pamphlet</span>`;
  if (s.startsWith('feed:')) return '<span class="tag good">Price feed</span>';
  return '<span class="tag good">Leaflet</span>';
}
async function itemDetail(id) {
  if (!S.items[id]) S.items[id] = await api('/api/items/' + encodeURIComponent(id));
  return S.items[id];
}
function clearTimers() {  // intervals and observers registered by the current view
  S.timers.forEach((t) => (t && t.disconnect ? t.disconnect() : clearInterval(t)));
  S.timers = [];
}
const emptyState = (icon, title, text, extra = '') => `<div class="empty"><span class="em-ic">${ic(icon, 'lg')}</span><b>${title}</b><span>${text}</span>${extra}</div>`;

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
    n.innerHTML = `${ic('info')}<span><b>Some prices are samples</b> (marked <span class="tag sample">Sample</span>) until real pamphlets are loaded.
      Refresh fetches this week's pamphlets.</span><button class="btn small ghost" type="button" id="hide-notice">Dismiss</button>`;
    n.hidden = false;
    $('#hide-notice').onclick = () => {
      sessionSet('nsb.hideSample', '1');
      done(animate(n, { opacity: [1, 0], transform: ['translateY(0)', 'translateY(-6px)'] }, { duration: 0.2 }), () => { n.hidden = true; n.style.opacity = ''; n.style.transform = ''; });
    };
  } else n.hidden = true;
}
function lastRefreshText(short) {
  const lr = S.meta.last_refresh || {};
  if (!lr.at) return 'Pamphlets not fetched yet';
  return short ? `Updated ${ago(lr.at)}` : `Last checked ${ago(lr.at)}${lr.summary ? ' · ' + h(lr.summary) : ''}`;
}
function moveIndicator(instant) {
  const ind = $('#tab-ind'), a = $('#tabs a.active');
  if (!ind) return;
  if (!a) { ind.style.opacity = '0'; return; }
  const to = { transform: `translateX(${a.offsetLeft}px)`, width: `${a.offsetWidth}px` };
  if (instant || !MO || REDUCED || ind.style.opacity !== '1') { Object.assign(ind.style, to, { opacity: '1' }); return; }
  try { MO.animate(ind, to, SPRING); } catch { Object.assign(ind.style, to); }
}
if (window.ResizeObserver) new ResizeObserver(() => moveIndicator(true)).observe($('#tabs'));
let scrollTick = false;
window.addEventListener('scroll', () => {
  if (scrollTick) return;
  scrollTick = true;
  requestAnimationFrame(() => {
    scrollTick = false;
    $('#topbar').classList.toggle('scrolled', window.scrollY > 4);
    const tb = $('.toolbar');
    if (tb) tb.classList.toggle('stuck', tb.getBoundingClientRect().top <= $('#topbar').offsetHeight + 1);
  });
}, { passive: true });

// ------------------------------------------------------------------ horizontal rails: arrows, drag to scroll, edge fades
const rail = (id, inner, cls = '') => `<div class="rail ${cls}" data-rail>
    <button class="rail-btn prev" type="button" tabindex="-1" aria-label="Scroll left">${ic('chevLeft')}</button>
    <div class="rail-scroll" id="${id}">${inner}</div>
    <button class="rail-btn next" type="button" tabindex="-1" aria-label="Scroll right">${ic('chevRight')}</button></div>`;
function enhanceRails(root = view) {
  $$('[data-rail]', root).forEach((r) => {
    if (r.dataset.ready) return;
    r.dataset.ready = '1';
    const sc = $('.rail-scroll', r);
    const update = () => {
      r.classList.toggle('at-start', sc.scrollLeft <= 2);
      r.classList.toggle('at-end', sc.scrollLeft + sc.clientWidth >= sc.scrollWidth - 2);
    };
    r.update = update;
    sc.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
    if (window.ResizeObserver) { const ro = new ResizeObserver(update); ro.observe(sc); S.timers.push(ro); }
    $('.prev', r).onclick = () => sc.scrollBy({ left: -sc.clientWidth * 0.8, behavior: REDUCED ? 'auto' : 'smooth' });
    $('.next', r).onclick = () => sc.scrollBy({ left: sc.clientWidth * 0.8, behavior: REDUCED ? 'auto' : 'smooth' });
    // drag with the mouse (touch and trackpads scroll natively), with a little momentum
    let st = null;
    sc.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || sc.scrollWidth <= sc.clientWidth) return;
      st = { x: e.clientX, left: sc.scrollLeft, moved: false, vx: 0, t: performance.now(), lx: e.clientX };
    });
    window.addEventListener('pointermove', (e) => {
      if (!st) return;
      const dx = e.clientX - st.x;
      if (!st.moved && Math.abs(dx) < 6) return;
      if (!st.moved) { st.moved = true; sc.classList.add('dragging'); }
      const now = performance.now();
      st.vx = (e.clientX - st.lx) / Math.max(1, now - st.t); st.lx = e.clientX; st.t = now;
      sc.scrollLeft = st.left - dx;
    });
    window.addEventListener('pointerup', () => {
      if (!st) return;
      const s = st; st = null;
      if (!s.moved) return;
      sc.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); }, { capture: true, once: true });
      let v = -s.vx * 16;
      const glide = () => {
        if (Math.abs(v) < 0.5 || REDUCED) { sc.classList.remove('dragging'); return; }
        sc.scrollLeft += v; v *= 0.92; requestAnimationFrame(glide);
      };
      requestAnimationFrame(glide);
    });
    sc.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { sc.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * 240, behavior: 'smooth' }); }
    });
    update();
  });
}
function refreshRail(el) { const r = el && el.closest('[data-rail]'); if (r && r.update) r.update(); }

// ------------------------------------------------------------------ deals (home)
function dealCard(x, feature = false) {
  const k = rememberDeal(x);
  const soon = endsSoon(x.valid_until);
  return `<article class="deal ${feature ? 'feature' : ''}" data-deal="${h(k)}">
    <div class="deal-head">${logo(x.store_id, 'sm')}${x.saving_pct > 0 ? `<span class="disc">−${x.saving_pct}%</span>` : '<span class="disc plain">Special</span>'}</div>
    <div class="deal-prod">${catTile(x.category, x.name)}<div>
      <div class="deal-brand">${h(x.brand)}</div>
      <button class="deal-open" type="button" data-open-deal="${h(k)}">${h(x.name)} <span class="deal-size">${h(x.size)}</span></button></div></div>
    <div class="deal-foot"><div class="deal-price">${amt(x.price)}${x.saving > 0 ? `<s class="was">${money(x.regular_price)}</s>` : ''}</div>
      <button class="add" type="button" data-add-deal="${h(k)}" aria-label="Add ${h(x.name)} to cart" title="Add to cart">${ic('plus')}</button></div>
    <div class="deal-meta">${ic('clock', 'sm')}<span class="${soon ? 'soon' : ''}">${h(until(x.valid_until))}</span>${x.saving > 0 ? `<i class="sep"></i><span class="sv">Save ${money(x.saving)}</span>` : ''}</div>
  </article>`;
}

async function renderDeals() {
  const f = S.feed;
  const total = Object.values(S.meta.special_counts || {}).reduce((a, b) => a + b, 0);
  const cats = ['', ...S.meta.categories];
  const lr = S.meta.last_refresh || {};
  view.innerHTML = `
    <section class="deals-head">
      <div>
        <div class="eyebrow"><span class="dot ${S.meta.refreshing ? 'busy' : ''}"></span>${h(fmtDate(S.meta.today, { weekday: 'long', day: 'numeric', month: 'long' }))}${lr.at ? ' · ' + lastRefreshText(true) : ''}</div>
        <h1>This week's specials,<br><em>in one place.</em></h1>
        <p class="lede">${total ? `${total.toLocaleString('en-US')} deals` : 'Deals'} from ${S.meta.stores.length} Namibian shops. Add what you need and Smart Basket works out the cheapest way to buy it.</p>
      </div>
      <div>
        <div class="search">${ic('search')}<input id="d-q" type="search" value="${h(f.q)}" placeholder="Search specials: maize meal, oil, nappies…" aria-label="Search specials" autocomplete="off"><span class="kbd">/</span></div>
        <div class="kpis">
          <div class="kpi"><small>Specials live</small><b id="st-total">0</b></div>
          <div class="kpi"><small>Shops</small><b id="st-shops">0</b></div>
          <div class="kpi"><small>Biggest drop</small><b class="sale" id="st-max">–</b></div>
          <div class="kpi"><small>Pamphlets</small><b id="st-pam">–</b></div>
        </div>
      </div>
    </section>
    <div class="section-head"><div><h2>Biggest price drops</h2><p>The deepest discounts running today</p></div></div>
    ${rail('hot', '<div class="sk"></div>'.repeat(5))}
    <div class="section-head" style="margin-top:28px"><div><h2>Ready-made baskets</h2><p>One tap builds the cheapest cart for a whole shop</p></div></div>
    <div class="baskets" id="baskets">${'<div class="sk" style="min-height:164px"></div>'.repeat(3)}</div>
    <div class="section-head" id="all-head"><div><h2>All specials</h2><p id="sp-sub">Loading…</p></div>
      <select id="d-sort" class="sort" aria-label="Sort">${[['percent', 'Biggest % off'], ['saving', 'Biggest N$ saving'], ['price', 'Lowest price'], ['ending', 'Ending soonest'], ['name', 'A–Z']]
        .map(([v, t]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    ${rail('shop-rail', S.meta.stores.map((s) => {
      const n = (S.meta.special_counts || {})[s.id] || 0;
      return `<button class="shop-chip" type="button" data-store="${h(s.id)}" aria-pressed="${f.stores.has(s.id)}" title="${h(s.name)} · ${h(s.kind)}">${logo(s.id, 'sm')}<span><b>${h(s.name)}</b><small>${plural(n, 'deal')}</small></span></button>`;
    }).join(''), `shop-rail ${f.stores.size ? 'filtering' : ''}`)}
    <div class="toolbar" id="toolbar">${rail('cats', cats.map((c) => `<button class="chip" type="button" data-cat="${h(c)}" aria-pressed="${f.category === c}">${c ? h(c) : 'All categories'}</button>`).join(''))}</div>
    <div class="grid" id="grid" style="margin-top:14px"></div>
    <div class="sentinel" id="sentinel"></div>`;
  enhanceRails();
  countTo($('#st-total'), total);
  countTo($('#st-shops'), S.meta.stores.length);
  loadLeaflets().then((l) => { const el = $('#st-pam'); if (el && S.view === 'deals') countTo(el, Object.keys(l).length); }).catch(() => {});

  let jumped = !!f.q;
  $('#d-q').addEventListener('input', debounce((e) => {
    f.q = e.target.value;
    loadFeed(true).then(() => {
      if (!jumped && f.q.trim() && $('#all-head').getBoundingClientRect().top > window.innerHeight * 0.6) { jumped = true; $('#all-head').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' }); }
    });
  }, 260));
  $('#d-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#all-head').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' }); });
  $('#d-sort').onchange = (e) => { f.sort = e.target.value; loadFeed(true); };
  $('#cats').onclick = (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    f.category = b.dataset.cat;
    $$('#cats .chip').forEach((c) => c.setAttribute('aria-pressed', c === b));
    loadFeed(true);
  };
  $('#shop-rail').onclick = (e) => {
    const b = e.target.closest('[data-store]');
    if (!b) return;
    f.stores.has(b.dataset.store) ? f.stores.delete(b.dataset.store) : f.stores.add(b.dataset.store);
    b.setAttribute('aria-pressed', f.stores.has(b.dataset.store));
    b.closest('.rail').classList.toggle('filtering', f.stores.size > 0);
    loadFeed(true);
  };
  const io = new IntersectionObserver((ents) => { if (ents.some((x) => x.isIntersecting)) loadFeed(false); }, { rootMargin: '600px' });
  io.observe($('#sentinel'));
  S.timers.push(io);

  loadHot();
  loadBaskets($('#baskets'));
  loadFeed(true);
}

async function loadHot() {
  let d;
  try { d = await api('/api/specials?sort=percent&limit=14'); } catch { return; }
  if (S.view !== 'deals') return;
  const hot = $('#hot');
  hot.innerHTML = d.results.length ? d.results.map((x) => dealCard(x, true)).join('') : emptyState('inbox', 'No specials yet', 'Refresh fetches this week\'s pamphlets.');
  reveal(hot.children, { step: 0.05 });
  refreshRail(hot);
  if (d.results[0]) countTo($('#st-max'), d.results[0].saving_pct, (v) => `−${Math.round(v)}%`);
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
    grid.insertAdjacentHTML('beforeend', d.results.map((x) => dealCard(x)).join(''));
    if (!f.results.length) grid.innerHTML = `<div style="grid-column:1/-1">${emptyState('search', 'No specials match', 'Try another word, category or shop.')}</div>`;
    reveal([...grid.children].slice(before), { step: 0.025 });
    const bits = [f.stores.size ? [...f.stores].map(storeName).join(', ') : '', f.category, f.q && `“${f.q}”`].filter(Boolean).join(' · ');
    $('#sp-sub').textContent = `${plural(d.total, 'special')}${bits ? ' · ' + bits : ''}`;
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    f.loading = false;
    if (f.pending) { f.pending = false; loadFeed(true); }
  }
}

function basketCard(b, i) {
  const [icon, color] = BASKET_ICON[b.id] || ['basket', ['#1453a6', '#2f8a4c', '#b7791f', '#c2477e', '#18808a', '#5b5bd6'][i % 6]];
  return `<button class="basket" type="button" data-basket="${h(b.id)}">${tile(icon, color)}
    <b>${h(b.name)}</b><span class="bl">${h(b.blurb)} · ${plural(b.count, 'item')}</span>
    <span class="bp"><span>${b.total ? amt(b.total) : ''}<small>${b.stores && b.stores.length ? 'at ' + b.stores.map(storeName).map(h).join(' + ') : ''}</small></span><span class="go">${ic('arrowRight', 'sm')}</span></span></button>`;
}
async function loadBaskets(box) {
  try {
    if (!S.baskets) S.baskets = (await api('/api/baskets')).baskets;
  } catch { if (box) box.innerHTML = ''; return; }
  if (!box || !document.body.contains(box)) return;
  box.innerHTML = S.baskets.map(basketCard).join('');
  reveal(box.children, { step: 0.05 });
}

function useBasket(id) {
  const b = (S.baskets || []).find((x) => x.id === id);
  if (!b) return;
  const wasEmpty = !S.cart.lines.length;
  b.lines.forEach((ln) => addToCart({ item_id: ln.item_id, name: ln.name, size: ln.size }, ln.qty, { quiet: true }));
  toast(`${b.name}: ${plural(b.count, 'item')} ${wasEmpty ? 'in your cart' : 'added to your cart'}`);
  S.celebrate = true;
  if (S.view === 'cart') renderCart(); else location.hash = '#/cart';
}

// ------------------------------------------------------------------ product sheet: everything about one deal, without leaving the app
async function openDeal(k) {
  const x = S.deals[k];
  if (!x) return;
  const dlg = $('#sheet');
  const pam = (S.leaflets || {})[x.store_id];
  $('#sheet-body').innerHTML = `
    <div class="sheet-head">${logo(x.store_id)}<button class="icon-btn" type="button" data-sheet-close aria-label="Close">${ic('x')}</button></div>
    <section class="sheet-sec">
      <div class="sheet-prod">${catTile(x.category, x.name, 'lg')}<div><div class="deal-brand">${h(x.brand)}</div>
        <h2 id="sheet-title">${h(x.name)} <span class="deal-size">${h(x.size)}</span></h2></div></div>
      <div class="sheet-price">${amt(x.price)}${x.saving > 0 ? `<s class="was">${money(x.regular_price)}</s>` : ''}${x.saving_pct > 0 ? `<span class="disc">−${x.saving_pct}%</span>` : ''}</div>
      <div class="sheet-facts">
        <div class="fact"><small>Valid</small><b class="${endsSoon(x.valid_until) ? 'soon' : ''}">${h(until(x.valid_until))}</b></div>
        <div class="fact"><small>You save</small><b>${x.saving > 0 ? money(x.saving) : '–'}</b></div>
        <div class="fact"><small>Deal</small><b>${h(x.special_label || 'Special')}</b></div>
        <div class="fact"><small>Source</small><b>${h(sourceText(x))}</b></div>
      </div>
      <div class="sheet-actions"><button class="btn primary big" type="button" data-sheet-add="${h(k)}">${ic('plus')} Add to cart</button>
        ${pam ? `<button class="btn big" type="button" data-sheet-pamphlet="${h(x.store_id)}">${ic('book')} View pamphlet</button>` : ''}</div>
    </section>
    <section class="sheet-sec"><h3>Price at every shop</h3><div class="sp-list" id="sp-list"><div class="sk" style="min-height:120px"></div></div></section>`;
  dlg.showModal();
  const narrow = window.matchMedia('(max-width: 600px)').matches;
  animate(dlg, { transform: [narrow ? 'translateY(100%)' : 'translateX(100%)', 'translate(0,0)'] }, { type: 'spring', bounce: 0.08, duration: 0.5 });
  let it;
  try { it = await itemDetail(x.item_id); } catch { $('#sp-list').innerHTML = '<p class="muted">Couldn\'t load other shops.</p>'; return; }
  const list = $('#sp-list');
  if (!list || !dlg.open) return;
  const max = Math.max(...it.prices.map((p) => p.price), 1);
  const best = it.prices[0];
  list.innerHTML = it.prices.map((p, i) => `<div class="sp-row ${best && p.price === best.price ? 'best' : ''} ${p.store_id === x.store_id && p.product_id === x.product_id ? 'here' : ''}">
      ${logo(p.store_id, 'sm')}<div><div class="sp-name">${h(p.brand)} · ${h(p.store_name)}</div><div class="sp-bar"><span style="width:${(100 * p.price / max).toFixed(1)}%"></span></div></div>
      <div class="sp-p">${money(p.price)}${p.on_special ? `<small>${p.saving_pct > 0 ? '−' + p.saving_pct + '%' : 'Special'}</small>` : ''}</div>
      <button class="icon-btn" type="button" data-sp-add="${i}" aria-label="Add ${h(p.brand)} from ${h(p.store_name)}">${ic('plus')}</button></div>`).join('') || '<p class="muted">No other prices yet.</p>';
  animate($$('.sp-bar span', list), { transform: ['scaleX(0)', 'scaleX(1)'] }, { duration: 0.6, delay: (i) => 0.1 + i * 0.03, ease: EASE });
  list.onclick = (e) => {
    const b = e.target.closest('[data-sp-add]');
    if (!b) return;
    const p = it.prices[+b.dataset.spAdd];
    addToCart({ item_id: it.id, product_id: p.product_id, name: it.name, size: it.size, brand: p.brand, category: it.category }, 1, { from: b });
  };
}
function closeSheet(then) {
  const dlg = $('#sheet');
  if (!dlg.open) { if (then) then(); return; }
  const narrow = window.matchMedia('(max-width: 600px)').matches;
  const a = animate(dlg, { transform: ['translate(0,0)', narrow ? 'translateY(100%)' : 'translateX(100%)'] }, { duration: 0.25, ease: [0.4, 0, 1, 1] });
  done(a, () => { dlg.close(); dlg.style.transform = ''; if (then) then(); });
}
$('#sheet').addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });
$('#sheet').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeSheet(); });

// ------------------------------------------------------------------ pamphlets
async function loadLeaflets(force) {
  if (S.leaflets && !force) return S.leaflets;
  const d = await api('/api/leaflets');
  const latest = {};
  d.leaflets.forEach((l) => { if (!latest[l.store_id] && l.files.length) latest[l.store_id] = l; });
  S.leaflets = latest;
  S.leafletInfo = d;
  return latest;
}

async function renderPamphlets() {
  view.innerHTML = `<div class="page-head"><div><div class="eyebrow"><span class="dot ${S.meta.refreshing ? 'busy' : ''}"></span><span id="pm-sub">${lastRefreshText()}</span></div>
      <h1>This week's pamphlets</h1><p class="lede">Flip through every shop's leaflet right here, page by page.</p></div>
      <button class="btn primary" type="button" data-refresh>${ic('refresh')} Get the latest</button></div>
    <div id="pm-note"></div>
    <div class="pam-grid" id="pm">${'<div><div class="sk" style="aspect-ratio:3/4;min-height:0"></div></div>'.repeat(6)}</div>
    <div id="pm-missing"></div>`;
  let latest;
  try { latest = await loadLeaflets(true); } catch (e) { $('#pm').innerHTML = emptyState('alert', 'Couldn\'t load pamphlets', h(e.message)); return; }
  if (S.view !== 'pamphlets') return;
  const d = S.leafletInfo;
  if (!d.claude) {
    $('#pm-note').innerHTML = `<div class="callout info">${ic('info')}<div>Pamphlets are saved here to read. Their prices are added to Deals automatically once Claude is connected${S.meta.local ? '.' : ' (an admin adds the key on the <a href="#/me">Me</a> page).'}</div>
      ${S.meta.local ? '<button class="btn small" type="button" data-claude>Connect Claude</button>' : ''}</div>`;
  }
  const have = S.meta.stores.filter((s) => latest[s.id]);
  const missing = S.meta.stores.filter((s) => !latest[s.id]);
  $('#pm').innerHTML = have.length ? have.map((s) => {
    const l = latest[s.id];
    const cover = l.kind === 'images' ? `<img src="${h(l.files[0])}" alt="" loading="lazy" class="loading" onload="this.classList.remove('loading')">`
      : `<span class="ph">${ic('file')}</span><img alt="" class="loading" data-pdf-cover="${h(l.files[0])}">`;
    const status = l.status === 'read' ? `<span class="tag good">${ic('check')} ${plural(l.n_specials, 'price')}</span>`
      : l.status === 'error' ? `<span class="tag warn" title="${h(l.message)}">Not read</span>` : '';
    return `<button class="pam" type="button" data-open="${h(s.id)}" aria-label="Read the ${h(s.name)} pamphlet">
      <span class="pam-cover">${cover}<span class="pam-chip">${ic('book')} ${l.kind === 'images' ? plural(l.pages, 'page') : 'PDF'}</span><span class="pam-open">Read ${ic('arrowRight', 'sm')}</span></span>
      <span class="pam-body"><span class="row">${logo(s.id, 'sm')}${status}</span><span class="pam-title">${h(l.title || s.name + ' specials')}</span>
      <span class="pam-sub">${h(validity(l))}</span></span></button>`;
  }).join('') : `<div style="grid-column:1/-1">${emptyState('book', 'No pamphlets yet', 'Get the latest to download this week\'s pamphlets from every shop.', '<button class="btn primary" type="button" data-refresh>' + ic('refresh') + ' Get the latest</button>')}</div>`;
  reveal($('#pm').children, { step: 0.04, y: 14 });
  if (missing.length) {
    $('#pm-missing').innerHTML = `<div class="pam-missing"><div class="section-head" style="margin-top:0"><div><h2>No pamphlet this week</h2>
      <p>These shops have nothing online right now${have.length ? '' : ', or pamphlets haven\'t been fetched yet'}.</p></div></div>
      <div class="chips">${missing.map((s) => `<div class="miss">${logo(s.id, 'sm')}<div><b>${h(s.name)}</b>${(d.sources || {})[s.id] ? 'Not found yet' : 'Doesn\'t publish online'}</div></div>`).join('')}</div></div>`;
  }
  // PDF covers are drawn by pdf.js as the cards scroll into view
  const io = new IntersectionObserver((ents) => ents.forEach((en) => {
    if (!en.isIntersecting) return;
    io.unobserve(en.target);
    const img = en.target;
    pdfCover(img.dataset.pdfCover).then((c) => {
      img.onload = () => { img.classList.remove('loading'); const ph = img.previousElementSibling; if (ph) ph.remove(); };
      img.src = c.src;
      const chip = img.parentNode.querySelector('.pam-chip');
      if (chip) chip.innerHTML = `${ic('book')} ${plural(c.pages, 'page')}`;
    }).catch(() => {});
  }), { rootMargin: '300px' });
  $$('img[data-pdf-cover]').forEach((img) => io.observe(img));
  S.timers.push(io);
}

// pdf.js, loaded the first time a PDF pamphlet is shown
const PDFJS = '/static/vendor/pdfjs-6.3.289/';
let pdfjsP = null;
function pdfjs() {
  if (!pdfjsP) {
    pdfjsP = import(PDFJS + 'pdf.min.mjs').then((m) => {
      m.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
      return { lib: m, worker: new m.PDFWorker() };   // one worker for every pamphlet
    });
    pdfjsP.catch(() => { pdfjsP = null; });
  }
  return pdfjsP;
}
async function openPdf(url, light) {
  const { lib, worker } = await pdfjs();
  return lib.getDocument({ url, worker, isEvalSupported: false, enableXfa: false, wasmUrl: PDFJS + 'wasm/', iccUrl: PDFJS + 'iccs/',
    standardFontDataUrl: PDFJS + 'standard_fonts/', disableAutoFetch: !!light, disableStream: !!light }).promise;
}
function closePdf(doc) { try { doc.loadingTask.destroy(); } catch { /* already closed */ } }
function drawPdfPage(page, canvas, cssW) {
  const v1 = page.getViewport({ scale: 1 });
  let scale = (cssW * Math.min(window.devicePixelRatio || 1, 2)) / v1.width;
  const maxPx = 14e6;  // WebKit refuses very large canvases
  if (v1.width * v1.height * scale * scale > maxPx) scale = Math.sqrt(maxPx / (v1.width * v1.height));
  const vp = page.getViewport({ scale });
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  return page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp });
}
const covers = new Map();
let coverQueue = Promise.resolve();
function pdfCover(url) {
  if (!covers.has(url)) {
    const p = coverQueue.then(async () => {
      const doc = await openPdf(url, true);
      try {
        const c = document.createElement('canvas');
        await drawPdfPage(await doc.getPage(1), c, 320).promise;
        const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86));
        return { src: URL.createObjectURL(blob), ar: c.width / c.height, pages: doc.numPages };
      } finally { closePdf(doc); }
    });
    coverQueue = p.catch(() => {});
    covers.set(url, p);
    p.catch(() => covers.delete(url));
  }
  return covers.get(url);
}

// ------------------------------------------------------------------ pamphlet reader: scroll, zoom, thumbnails, keyboard
const RD = { token: 0, doc: null, kind: '', pages: [], zoom: 1, io: null, tio: null, cur: 1, rerender: null, from: null };
const rScroll = $('#reader-scroll'), rThumbs = $('#reader-thumbs'), rDlg = $('#viewer');

async function openReader(storeId, fromEl) {
  const l = (S.leaflets || {})[storeId];
  if (!l) return;
  const token = ++RD.token;
  Object.assign(RD, { kind: l.kind, pages: [], zoom: 1, cur: 1, from: fromEl || null });
  $('#reader-title').innerHTML = `${logo(storeId, 'sm')}<div><b>${h(l.title || storeName(storeId) + ' specials')}</b><small>${h(storeName(storeId))} · ${h(validity(l))}</small></div>
    ${l.page_url ? `<a class="icon-btn" href="${h(l.page_url)}" target="_blank" rel="noopener" title="Open the shop's page in your browser" aria-label="Open the shop's page in your browser">${ic('external')}</a>` : ''}`;
  $('#reader-page').textContent = '';
  $('#reader-progress').style.width = '0';
  $('.reader-tools', rDlg).hidden = false;
  rScroll.innerHTML = '<div class="reader-pages" id="reader-pages"></div>';
  rThumbs.innerHTML = '';
  rDlg.showModal();
  rScroll.focus({ preventScroll: true });
  animate(rDlg, { opacity: [0, 1] }, { duration: 0.2 });
  const ghost = startGhost(fromEl);
  if (l.kind === 'images') {
    RD.pages = l.files.map((src) => ({ src, ar: 0.707 }));
  } else {
    try {
      const doc = await openPdf(l.files[0]);
      if (token !== RD.token) { closePdf(doc); return; }
      RD.doc = doc;
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        if (token !== RD.token) return;
        const v = page.getViewport({ scale: 1 });
        RD.pages.push({ page, ar: v.width / v.height });
      }
    } catch (e) {
      if (token !== RD.token) return;
      if (ghost) ghost.remove();
      $('.reader-tools', rDlg).hidden = true;
      // last resort: the system's own PDF view, still inside the app
      rScroll.innerHTML = `<iframe class="reader-fallback" src="${h(l.files[0])}" title="${h(storeName(storeId))} pamphlet"></iframe>`;
      return;
    }
  }
  if (token !== RD.token) return;
  buildPages();
  landGhost(ghost);
}

function buildPages() {
  const box = $('#reader-pages');
  box.innerHTML = RD.pages.map((p, i) => `<div class="rpage loading" data-p="${i + 1}"><span class="pno">${i + 1}</span></div>`).join('');
  rThumbs.innerHTML = RD.pages.map((p, i) => `<button class="thumb ${i === 0 ? 'active' : ''}" type="button" data-p="${i + 1}" style="--ar:${p.ar.toFixed(4)}" aria-label="Go to page ${i + 1}"><span class="tp"></span>${i + 1}</button>`).join('');
  layoutPages();
  RD.io = new IntersectionObserver((ents) => ents.forEach((en) => {
    const n = +en.target.dataset.p;
    if (en.isIntersecting) showPage(n); else if (RD.kind !== 'images') freePage(n);
  }), { root: rScroll, rootMargin: '1400px 0px' });
  $$('.rpage', box).forEach((el) => RD.io.observe(el));
  RD.tio = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) { RD.tio.unobserve(en.target); showThumb(+en.target.dataset.p); } }),
    { root: rThumbs, rootMargin: '400px 0px' });
  $$('.thumb', rThumbs).forEach((el) => RD.tio.observe(el));
  onReaderScroll();
}
function fitWidth() { return Math.max(240, Math.min(rScroll.clientWidth - (rScroll.clientWidth < 600 ? 20 : 48), 920)); }
function layoutPages() {
  const w = Math.round(fitWidth() * RD.zoom);
  $$('#reader-pages .rpage').forEach((el, i) => { el.style.width = w + 'px'; el.style.height = Math.round(w / RD.pages[i].ar) + 'px'; });
  $('#reader-zoom').textContent = Math.round(RD.zoom * 100) + '%';
  rScroll.classList.toggle('can-pan', RD.zoom > 1.01);
}
function showPage(n) {
  const el = $(`#reader-pages .rpage[data-p="${n}"]`), p = RD.pages[n - 1];
  if (!el || !p) return;
  if (RD.kind === 'images') {
    if ($('img', el)) return;
    const img = new Image();
    img.alt = `Page ${n}`;
    img.style.opacity = '0';
    img.onload = () => {
      el.classList.remove('loading');
      img.style.opacity = '1';
      const ar = img.naturalWidth / img.naturalHeight;
      if (ar && Math.abs(ar - p.ar) > 0.01) { p.ar = ar; layoutPages(); const t = $(`.thumb[data-p="${n}"]`); if (t) t.style.setProperty('--ar', ar.toFixed(4)); }
    };
    img.src = p.src;
    el.prepend(img);
    return;
  }
  const w = el.offsetWidth;
  if (p.task || (p.w && Math.abs(p.w - w) / w < 0.12 && $('canvas', el))) return;
  const canvas = document.createElement('canvas');
  p.w = w;
  p.task = drawPdfPage(p.page, canvas, w);
  p.task.promise.then(() => {
    p.task = null;
    const old = $('canvas', el);
    if (old) old.replaceWith(canvas); else el.prepend(canvas);
    el.classList.remove('loading');
  }, () => { p.task = null; });
}
function freePage(n) {
  const el = $(`#reader-pages .rpage[data-p="${n}"]`), p = RD.pages[n - 1];
  if (!el || !p) return;
  if (p.task) { p.task.cancel(); p.task = null; }
  const c = $('canvas', el);
  if (c) { c.width = 0; c.height = 0; c.remove(); el.classList.add('loading'); }
  p.w = 0;
}
function showThumb(n) {
  const t = $(`.thumb[data-p="${n}"] .tp`), p = RD.pages[n - 1];
  if (!t || !p || t.firstChild) return;
  if (RD.kind === 'images') { t.innerHTML = `<img src="${h(p.src)}" alt="" loading="lazy">`; return; }
  const c = document.createElement('canvas');
  drawPdfPage(p.page, c, 94).promise.then(() => t.append(c), () => {});
}
function rerenderVisible() {
  if (RD.kind === 'images') return;
  const top = rScroll.scrollTop - 1400, bottom = rScroll.scrollTop + rScroll.clientHeight + 1400;
  $$('#reader-pages .rpage').forEach((el) => { if (el.offsetTop + el.offsetHeight > top && el.offsetTop < bottom) showPage(+el.dataset.p); });
}
function setZoom(z, ax, ay) {
  z = clamp(z, 0.5, 4);
  if (Math.abs(z - RD.zoom) < 0.001 || !RD.pages.length) return;
  const sr = rScroll.getBoundingClientRect();
  if (ax == null) { ax = rScroll.clientWidth / 2; ay = rScroll.clientHeight / 3; }
  // keep the point under the pointer (or the middle of the view) where it is
  const el = pageAt(rScroll.scrollTop + ay) || $('#reader-pages .rpage');
  const r1 = el.getBoundingClientRect();
  const rx = (sr.left + ax - r1.left) / r1.width, ry = (sr.top + ay - r1.top) / r1.height;
  RD.zoom = z;
  layoutPages();
  const r2 = el.getBoundingClientRect();
  rScroll.scrollLeft += r2.left + rx * r2.width - (sr.left + ax);
  rScroll.scrollTop += r2.top + ry * r2.height - (sr.top + ay);
  clearTimeout(RD.rerender);
  RD.rerender = setTimeout(rerenderVisible, 180);
}
function pageAt(y) {
  let found = null;
  for (const el of $$('#reader-pages .rpage')) { if (el.offsetTop <= y) found = el; else break; }
  return found;
}
function goToPage(n, smooth = true) {
  n = clamp(n, 1, RD.pages.length);
  const el = $(`#reader-pages .rpage[data-p="${n}"]`);
  if (el) rScroll.scrollTo({ top: el.offsetTop - 16, behavior: smooth && !REDUCED ? 'smooth' : 'auto' });
}
let rTick = false;
function onReaderScroll() {
  if (rTick) return;
  rTick = true;
  requestAnimationFrame(() => {
    rTick = false;
    const max = rScroll.scrollHeight - rScroll.clientHeight;
    $('#reader-progress').style.width = (max > 0 ? (100 * rScroll.scrollTop) / max : 100) + '%';
    const el = pageAt(rScroll.scrollTop + rScroll.clientHeight * 0.35);
    const n = el ? +el.dataset.p : 1;
    $('#reader-page').textContent = RD.pages.length ? `${n} / ${RD.pages.length}` : '';
    if (n !== RD.cur) {
      RD.cur = n;
      $$('.thumb', rThumbs).forEach((t) => t.classList.toggle('active', +t.dataset.p === n));
      const at = $(`.thumb[data-p="${n}"]`, rThumbs);
      if (at && rThumbs.offsetParent) {
        const tt = at.offsetTop - rThumbs.offsetTop;
        if (tt < rThumbs.scrollTop || tt + at.offsetHeight > rThumbs.scrollTop + rThumbs.clientHeight) rThumbs.scrollTo({ top: tt - rThumbs.clientHeight / 2, behavior: 'smooth' });
      }
    }
  });
}
rScroll.addEventListener('scroll', onReaderScroll, { passive: true });
rScroll.addEventListener('wheel', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;   // pinch on a trackpad, or Cmd/Ctrl + wheel
  e.preventDefault();
  const r = rScroll.getBoundingClientRect();
  setZoom(RD.zoom * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025)), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
let gz = 1;   // Safari's own pinch events
rScroll.addEventListener('gesturestart', (e) => { e.preventDefault(); gz = RD.zoom; });
rScroll.addEventListener('gesturechange', (e) => {
  e.preventDefault();
  const r = rScroll.getBoundingClientRect();
  setZoom(gz * e.scale, (e.clientX || r.left + r.width / 2) - r.left, (e.clientY || r.top + r.height / 3) - r.top);
});
// drag to pan once zoomed in
let pan = null;
rScroll.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' || e.button !== 0 || RD.zoom <= 1.01) return;
  pan = { x: e.clientX, y: e.clientY, l: rScroll.scrollLeft, t: rScroll.scrollTop };
  rScroll.classList.add('panning');
});
window.addEventListener('pointermove', (e) => { if (pan) { rScroll.scrollLeft = pan.l - (e.clientX - pan.x); rScroll.scrollTop = pan.t - (e.clientY - pan.y); } });
window.addEventListener('pointerup', () => { if (pan) { pan = null; rScroll.classList.remove('panning'); } });
rThumbs.addEventListener('click', (e) => { const t = e.target.closest('.thumb'); if (t) goToPage(+t.dataset.p); });
rDlg.addEventListener('click', (e) => {
  const b = e.target.closest('[data-reader]');
  if (!b) return;
  const a = b.dataset.reader;
  if (a === 'close') rDlg.close();
  else if (a === 'in') setZoom(RD.zoom * 1.25);
  else if (a === 'out') setZoom(RD.zoom / 1.25);
  else if (a === 'fit') setZoom(1);
});
rDlg.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea')) return;
  const k = e.key;
  if (k === '+' || k === '=') { setZoom(RD.zoom * 1.25); e.preventDefault(); }
  else if (k === '-' || k === '_') { setZoom(RD.zoom / 1.25); e.preventDefault(); }
  else if (k === '0') { setZoom(1); e.preventDefault(); }
  else if ((k === 'ArrowRight' && RD.zoom <= 1.01) || k === 'PageDown' || k === 'j') { goToPage(RD.cur + 1); e.preventDefault(); }
  else if ((k === 'ArrowLeft' && RD.zoom <= 1.01) || k === 'PageUp' || k === 'k') { goToPage(RD.cur - 1); e.preventDefault(); }
  else if (k === 'Home') { goToPage(1); e.preventDefault(); }
  else if (k === 'End') { goToPage(RD.pages.length); e.preventDefault(); }
});
if (window.ResizeObserver) new ResizeObserver(() => { if (rDlg.open && RD.pages.length) { layoutPages(); clearTimeout(RD.rerender); RD.rerender = setTimeout(rerenderVisible, 200); } }).observe(rScroll);
rDlg.addEventListener('close', () => {
  RD.token++;
  if (RD.io) RD.io.disconnect();
  if (RD.tio) RD.tio.disconnect();
  RD.pages.forEach((p) => { if (p.task) p.task.cancel(); });
  if (RD.doc) { closePdf(RD.doc); RD.doc = null; }
  RD.pages = [];
  rScroll.innerHTML = ''; rThumbs.innerHTML = '';
  $$('.fly-ghost', rDlg).forEach((g) => g.remove());
  if (RD.from && document.body.contains(RD.from)) RD.from.focus({ preventScroll: true });
});
// the cover flies from its card to the first page
function startGhost(fromEl) {
  const img = fromEl && $('.pam-cover img:not(.loading)', fromEl);
  if (!img || !img.src || !MO || REDUCED) return null;
  const r = img.getBoundingClientRect();
  const g = new Image();
  g.src = img.src;
  g.className = 'fly-ghost';
  Object.assign(g.style, { width: r.width + 'px', height: r.height + 'px', transform: `translate(${r.left}px,${r.top}px)` });
  rDlg.append(g);
  g.dataset.from = JSON.stringify([r.left, r.top, r.width, r.height]);
  return g;
}
function landGhost(g) {
  const first = $('#reader-pages .rpage');
  if (!g) { if (first) reveal([$('#reader-pages')], { y: 16, duration: 0.4 }); return; }
  if (!first) { g.remove(); return; }
  const [x0, y0, w0, h0] = JSON.parse(g.dataset.from);
  const t = first.getBoundingClientRect();
  first.style.opacity = '0';
  const a = animate(g, { transform: [`translate(${x0}px,${y0}px) scale(1,1)`, `translate(${t.left}px,${t.top}px) scale(${t.width / w0},${t.height / h0})`] },
    { duration: 0.55, ease: EASE });
  done(a, () => { first.style.opacity = ''; done(animate(g, { opacity: [1, 0] }, { duration: 0.2 }), () => g.remove()); });
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
      if (s.next_allowed_in > 0) toast(`Pamphlets were just checked. You can refresh again in ${Math.ceil(s.next_allowed_in / 60)} min.`, 'info');
    }
  } catch (e) {
    $('#refresh-btn').classList.remove('spinning');
    toast(e.message, 'err');
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
const RS_STATE = { queued: ['clock', ''], done: ['check', 'done'], none: ['minus', ''], error: ['alert', 'error'] };
function showRefresh(s) {
  const sheet = $('#refresh-sheet');
  const shops = Object.entries(s.shops || {});
  if (!shops.length || (!R.userStarted && sheet.hidden)) return;  // background refreshes only spin the button
  clearTimeout(R.hideTimer);
  const doneN = shops.filter(([, x]) => ['done', 'none', 'error'].includes(x.state)).length;
  const firstOpen = sheet.hidden;
  sheet.hidden = false;
  sheet.innerHTML = `<div class="rs-head"><b>${s.running ? 'Getting the latest pamphlets' : 'Pamphlets checked'}</b>
      <span class="row" style="gap:4px"><span class="count">${doneN}/${shops.length}</span><button class="icon-btn" type="button" id="rs-close" aria-label="Close">${ic('x')}</button></span></div>
    <div class="rs-progress"><div style="width:${Math.round(100 * doneN / shops.length)}%"></div></div>
    ${s.running ? '' : `<p class="rs-msg" style="margin:4px 0 6px">${h(s.summary || '')}</p>`}
    ${shops.map(([id, x]) => {
      const busy = ['searching', 'downloading', 'reading'].includes(x.state);
      const [icon, cls] = RS_STATE[x.state] || ['', ''];
      return `<div class="rs-shop" data-rs="${h(id)}">${logo(id, 'sm')}<div><b>${h(x.name || storeName(id))}</b><div class="rs-msg">${h(x.message || '')}</div></div>
        <span class="rs-state ${busy ? 'busy' : cls}">${busy || !icon ? '' : ic(icon)}</span></div>`;
    }).join('')}
    ${s.claude ? '' : `<p class="rs-msg" style="margin-top:8px">Pamphlets are saved to read in the app. Prices are added automatically once Claude is connected.
      ${S.meta.local ? '<button class="btn small" type="button" data-claude style="margin-top:8px">Connect Claude</button>' : ''}</p>`}`;
  $('#rs-close').onclick = hideSheet;
  if (firstOpen) animate(sheet, { opacity: [0, 1], transform: ['translateY(16px) scale(.98)', 'translateY(0px) scale(1)'] }, SPRING);
  shops.forEach(([id, x]) => { if (R.prev[id] && R.prev[id] !== x.state && ['done', 'none', 'error'].includes(x.state)) pop($(`[data-rs="${id}"] .rs-state`, sheet), 1.3); });
  R.prev = Object.fromEntries(shops.map(([id, x]) => [id, x.state]));
}
function hideSheet() {
  const sheet = $('#refresh-sheet');
  if (sheet.hidden) return;
  done(animate(sheet, { opacity: [1, 0], transform: ['translateY(0px)', 'translateY(12px)'] }, { duration: 0.2 }),
    () => { sheet.hidden = true; sheet.style.opacity = ''; sheet.style.transform = ''; });
}
async function onRefreshDone(s) {
  $('#refresh-btn').classList.remove('spinning');
  R.userStarted = false;
  R.hideTimer = setTimeout(() => { if (!$('#refresh-sheet').matches(':hover')) hideSheet(); }, 7000);
  const total = Object.values(s.shops || {}).reduce((a, x) => a + (x.specials || 0), 0);
  if (total > 0) toast(`${total} new prices from this week's pamphlets`);
  S.baskets = null; S.items = {}; S.leaflets = null;
  await loadMeta();
  if (['deals', 'pamphlets', 'compare'].includes(S.view)) route();
}

// ------------------------------------------------------------------ compare
function renderCompare() {
  const c = S.compare;
  const QUICK = ['Maize meal', 'Bread', 'Cooking oil', 'Sugar', 'Eggs', 'Milk', 'Chicken', 'Rice', 'Washing powder', 'Toilet paper', 'Nappies', 'Soap'];
  view.innerHTML = `
    <div class="page-head"><div><h1>Compare prices</h1><p class="lede">What anything costs at every shop today, specials included.</p></div></div>
    <div class="compare">
      <div>
        <div class="search">${ic('search')}<input type="search" id="cmp-q" placeholder="Sugar, Sunfoil, toilet paper…" value="${h(c.q)}" aria-label="Search products" autocomplete="off"></div>
        <div style="margin-top:10px">${rail('cmp-quick', QUICK.map((q) => `<button class="chip" type="button" data-q="${h(q)}">${h(q)}</button>`).join(''))}</div>
        <div class="results" id="cmp-results"></div>
      </div>
      <div class="panel" id="cmp-detail">${emptyState('scale', 'Pick a product', 'Its price at each shop shows here, cheapest first.')}</div>
    </div>`;
  enhanceRails();
  const run = async () => {
    const q = c.q.trim();
    if (!q) { c.results = []; drawCompareResults(); return; }
    try {
      const d = await api('/api/search?' + new URLSearchParams({ q, limit: 20 }));
      if (q !== c.q.trim()) return;
      c.results = d.results;
      drawCompareResults(true);
      if (c.results.length && (!c.item || !c.results.some((r) => r.id === c.item.id))) showItem(c.results[0].id);
    } catch (e) { toast(e.message, 'err'); }
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
function drawCompareResults(animateIn) {
  const c = S.compare;
  const el = $('#cmp-results');
  if (!el) return;
  if (!c.q.trim()) { el.innerHTML = ''; return; }
  el.innerHTML = c.results.length ? c.results.map((r) => `
    <button class="result" type="button" data-item="${h(r.id)}" aria-current="${!!(c.item && c.item.id === r.id)}">${catTile(r.category, r.name, 'sm')}
      <span><span class="r-name">${h(r.name)}</span> <span class="r-sub">${h(r.size)}</span>
        <span class="r-sub" style="display:block">${plural(r.n_shops, 'shop')}${r.n_specials ? ` · <b>${r.n_specials} on special</b>` : ''}</span></span>
      <span class="r-best">${r.best ? `from<b>${money(r.best.price)}</b>${h(r.best.store_name)}` : 'no prices yet'}</span>
    </button>`).join('') : emptyState('search', 'Nothing found', 'Try a simpler word, like “oil” or “nappies”.');
  if (animateIn) reveal(el.children, { step: 0.025, y: 6 });
}
async function showItem(id) {
  try {
    delete S.items[id];
    S.compare.item = await itemDetail(id);
    drawItem(S.compare.item, true);
    drawCompareResults();
  } catch (e) { toast(e.message, 'err'); }
}
function drawItem(it, animateIn) {
  const el = $('#cmp-detail');
  if (!el) return;
  const best = it.prices[0];
  const max = Math.max(...it.prices.map((p) => p.price), 1);
  const rows = it.prices.map((p, i) => `
    <tr class="${best && p.price === best.price ? 'best' : ''}">
      <td>${logo(p.store_id, 'sm')}</td>
      <td><b style="font-weight:600">${h(p.brand)}</b><div class="hide-sm" style="margin-top:3px">${sourceTag(p)}</div></td>
      <td class="hide-sm">${p.on_special ? `<span class="tag sale">${p.saving_pct > 0 ? '−' + p.saving_pct + '%' : 'Special'}</span><div class="faint" style="font-size:.74rem;margin-top:3px">${h(until(p.valid_until))}</div>` : '<span class="faint">–</span>'}</td>
      <td class="hide-sm spread"><div class="sp-bar"><span style="width:${(100 * p.price / max).toFixed(1)}%;${best && p.price === best.price ? 'background:var(--save)' : ''}"></span></div></td>
      <td class="num hide-sm faint" style="font-size:.8rem">${money(p.unit_price)} ${h(p.unit_label)}</td>
      <td class="num price"><b style="font-weight:650">${money(p.price)}</b>${p.saving > 0 ? `<br><s class="was">${money(p.regular_price)}</s>` : ''}</td>
      <td class="num"><button class="add" type="button" data-add-price="${i}" aria-label="Add ${h(p.brand)} to cart">${ic('plus')}</button></td>
    </tr>`).join('');
  el.innerHTML = `
    <div class="detail-head"><div class="who">${catTile(it.category, it.name, 'lg')}<div><h2>${h(it.name)} <span class="faint" style="font-weight:500">${h(it.size)}</span></h2>
        <div class="muted" style="font-size:.86rem">${h(it.category)} · ${plural(it.prices.length, 'price')}</div></div></div>
      <button class="btn primary" type="button" id="add-any">${ic('plus')} Add, any brand</button></div>
    ${best ? `<div class="callout ok">${ic('checkCircle')}<div>Cheapest today: <b>${money(best.price)}</b> for ${h(best.brand)} at <b>${h(best.store_name)}</b>${best.on_special ? ' (on special)' : ''}.
      ${it.prices.length > 1 ? `The priciest is ${money(it.prices[it.prices.length - 1].price)}.` : ''}</div></div>` : emptyState('inbox', 'No prices yet', 'No shop has a price for this yet.')}
    ${rows ? `<div style="overflow-x:auto"><table class="prices"><thead><tr><th>Shop</th><th>Brand</th><th class="hide-sm">Special</th><th class="hide-sm"></th><th class="num hide-sm">Unit</th><th class="num">Price</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}`;
  $('#add-any').onclick = (e) => addToCart({ item_id: it.id, name: it.name, size: it.size, category: it.category }, 1, { from: e.currentTarget });
  const tb = el.querySelector('tbody');
  if (tb) {
    tb.addEventListener('click', (e) => {
      const b = e.target.closest('[data-add-price]');
      if (!b) return;
      const p = it.prices[+b.dataset.addPrice];
      addToCart({ item_id: it.id, product_id: p.product_id, name: it.name, size: it.size, brand: p.brand, category: it.category }, 1, { from: b });
    });
    if (animateIn) {
      reveal(tb.children, { step: 0.025, y: 4 });
      animate($$('.sp-bar span', tb), { transform: ['scaleX(0)', 'scaleX(1)'] }, { duration: 0.6, delay: (i) => 0.1 + i * 0.03, ease: EASE });
    }
  }
}

// ------------------------------------------------------------------ cart
function attachSuggest(input, box, onPick) {
  let items = [], hl = -1;
  const close = () => { box.hidden = true; box.innerHTML = ''; hl = -1; };
  const draw = () => {
    box.innerHTML = items.length ? items.map((it, i) => `<button type="button" data-i="${i}" class="${i === hl ? 'hl' : ''}">
        <span>${catTile(it.category, it.name, 'sm')}<span><b style="font-weight:600">${h(it.name)}</b> <small>${h(it.size)}</small></span></span><small>${it.best ? 'from ' + money(it.best.price) : ''}</small></button>`).join('')
      : '<div class="empty" style="padding:14px">No match. Try another word.</div>';
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
    <div class="page-head"><div><h1>Your cart</h1><p class="lede">Smart Basket works out where to buy each item. The total updates as you go.</p></div>
      ${c.lines.length ? `<button class="btn small ghost" type="button" id="cart-clear">${ic('trash', 'sm')} Clear cart</button>` : ''}</div>
    <div class="switch ${budget ? 'budget' : ''}" id="mode" role="group" aria-label="Cart type"><span class="pill"></span>
      <button type="button" data-mode="cheapest" aria-pressed="${!budget}">${ic('trendDown')} Cheapest cart</button>
      <button type="button" data-mode="budget" aria-pressed="${budget}">${ic('wallet')} Fit my budget</button></div>
    ${budget ? `<section class="panel budget-card" id="budget-card">
      <div class="gauge" id="gauge"><svg width="132" height="132" viewBox="0 0 136 136"><circle class="g-bg" cx="68" cy="68" r="58" stroke-width="10" fill="none"/>
        <circle class="g-fg" id="g-fg" cx="68" cy="68" r="58" stroke-width="10" fill="none" stroke-linecap="round" stroke-dasharray="364.42" stroke-dashoffset="364.42"/></svg>
        <div class="g-txt"><b id="g-spent">N$0</b><small id="g-of">of your budget</small></div></div>
      <div style="width:100%"><span class="cap">My budget</span><div class="budget-amount" id="b-amt">${money0(c.budget)}</div>
        <input type="range" id="b-range" min="50" max="5000" step="10" value="${h(c.budget)}" aria-label="Budget">
        <div class="chips">${[200, 500, 1000, 1500, 2500].map((v) => `<button class="chip" type="button" data-b="${v}">N$${v.toLocaleString('en-US')}</button>`).join('')}</div>
        <p class="muted" style="font-size:.85rem;margin-top:.8rem">Give each item a priority. <b>Must have</b> items always go in; the rest are added in order until the money runs out.</p></div>
    </section>` : ''}
    <div class="cart-grid">
      <section class="panel">
        <div class="addbox">${ic('plus')}<input type="search" id="add-q" placeholder="Add anything: bread, maize meal, soap…" autocomplete="off" aria-label="Add an item">
          <div class="suggest" id="add-suggest" hidden></div></div>
        <div class="quick">${rail('quick', '')}</div>
        <details class="paste" ${c.lines.length ? '' : 'open'}><summary>${ic('list')} Type or paste a whole list</summary>
          <textarea id="paste-text" placeholder="One per line, e.g.&#10;2 x bread&#10;maize meal 10kg&#10;cooking oil&#10;18 eggs&#10;washing powder"></textarea>
          <button class="btn" type="button" id="paste-go">Match my list</button>
          <div id="parsed"></div>
        </details>
        <ul class="lines" id="lines"></ul>
        <details class="opts"><summary><span>${ic('sliders')} Shops &amp; travel</span>${ic('chevDown', 'chev')}</summary>
          <div class="opt-title">Shops you can get to</div>
          <div class="row" style="margin-bottom:8px"><button class="btn small" type="button" data-shops="all">All shops</button>
            ${S.user && S.user.stores.length ? '<button class="btn small" type="button" data-shops="mine">My shops</button>' : ''}
            <button class="btn small" type="button" data-shops="none">None</button></div>
          <div class="store-toggles" id="cart-shops">${S.meta.stores.map((s) => `<button class="store-toggle" type="button" data-store="${h(s.id)}" aria-pressed="${!c.stores || c.stores.includes(s.id)}" title="${h(s.name)}">${logo(s.id)}</button>`).join('')}</div>
          <div class="opt-title">How many shops will you visit?</div>
          <div class="seg" id="max-stores">${[[0, 'Any'], [1, 'Just 1'], [2, 'Up to 2'], [3, 'Up to 3']].map(([v, t]) => `<button type="button" data-v="${v}" aria-pressed="${(c.maxStores || 0) === v}">${t}</button>`).join('')}</div>
          <div class="opt-title">Travel cost per shop <span class="faint" style="font-weight:500">(taxi or fuel)</span></div>
          <div class="money-input" style="max-width:200px"><span>N$</span><input type="number" id="trip" min="0" max="5000" step="1" inputmode="decimal" value="${h(c.tripCost || 0)}"></div>
        </details>
      </section>
      <section class="result-col" id="result"></section>
    </div>`;
  enhanceRails();
  $('#mode').onclick = (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b || b.dataset.mode === c.mode) return;
    c.mode = b.dataset.mode; S.result = null; saveCart();
    $('#mode').classList.toggle('budget', c.mode === 'budget');
    $$('#mode button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    setTimeout(renderCart, REDUCED ? 0 : 260);
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
    changed();
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
    range.oninput = () => { c.budget = +range.value; $('#b-amt').textContent = money0(c.budget); $('#b-amt').dataset.v = c.budget; setFill(); changed(); };
    $('.budget-card .chips').onclick = (e) => {
      const b = e.target.closest('[data-b]');
      if (!b) return;
      const from = c.budget; c.budget = +b.dataset.b; range.value = c.budget; setFill();
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
    box.innerHTML = bs.map((b, i) => { const [icon] = BASKET_ICON[b.id] || ['basket']; return `<button class="chip" type="button" data-basket="${h(b.id)}">${ic(icon, 'sm')} ${h(b.name)}</button>`; }).join('');
    refreshRail(box);
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
    el.innerHTML = `<li>${emptyState('cart', 'Your cart is empty', 'Search above, tap a basket, or add deals from the Deals page.')}</li>`;
    updateCartCount();
    return;
  }
  el.innerHTML = c.lines.map((l) => {
    const det = S.items[l.item_id];
    const brands = det ? det.products : (l.product_id ? [{ id: l.product_id, brand: l.brand }] : []);
    const opts = '<option value="">Any brand</option>' + brands.map((p) => `<option value="${h(p.id)}" ${p.id === l.product_id ? 'selected' : ''}>${h(p.brand)}</option>`).join('');
    return `<li class="line" data-key="${h(l.key)}">${catTile(l.category || (det && det.category), l.name, 'sm')}
      <div class="line-name">${h(l.name)} <small>${h(l.size)}</small></div>
      <button class="x" type="button" data-act="remove" aria-label="Remove ${h(l.name)}">${ic('x', 'sm')}</button>
      <div class="line-ctrls">
        <div class="stepper"><button type="button" data-act="dec" aria-label="One less">${ic('minus')}</button><span aria-live="polite">${l.qty}</span><button type="button" data-act="inc" aria-label="One more">${ic('plus')}</button></div>
        <select data-act="brand" aria-label="Brand for ${h(l.name)}">${opts}</select>
        ${budget ? `<select data-act="prio" class="prio ${h(l.priority)}" aria-label="Priority for ${h(l.name)}">${PRIOS.map(([v, t]) => `<option value="${v}" ${l.priority === v ? 'selected' : ''}>${t}</option>`).join('')}</select>` : ''}
      </div></li>`;
  }).join('');
  if (animateAll) reveal(el.children, { step: 0.025, y: 8 });
  else if (animateLast) reveal([el.lastElementChild], { scale: 0.97 });
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
    done(animate(li, { opacity: [1, 0], transform: ['translateX(0px)', 'translateX(24px)'] }, { duration: 0.2 }),
      () => { S.cart.lines = S.cart.lines.filter((x) => x !== l); drawLines(); changed(); });
    return;
  }
  if (b.dataset.act === 'inc') l.qty = Math.min(99, l.qty + 1);
  if (b.dataset.act === 'dec') l.qty = Math.max(1, l.qty - 1);
  const span = $('.stepper span', li);
  span.textContent = l.qty;
  pop(span, 1.25);
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
    return `<div><span class="tnum" style="min-width:2.4em;font-weight:650">${l.qty}×</span>
      ${choices.length ? `<select data-i="${i}" aria-label="Match for ${h(l.text)}">${choices.map((c) => `<option value="${h(c.id)}">${h(c.name)} ${h(c.size)}</option>`).join('')}<option value="">Skip “${h(l.text)}”</option></select>`
        : `<span class="muted">No match for “${h(l.text)}”.</span>`}</div>`;
  }).join('')}</div><button class="btn primary" type="button" id="paste-add">${ic('plus')} Add ${plural(lines.filter((l) => l.item).length, 'item')}</button>`;
  reveal($$('.parsed > div', out), { step: 0.03, y: 6 });
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
    toast(`Added ${plural(n, 'item')} to your cart`);
    $('#paste-text').value = ''; out.innerHTML = ''; $('details.paste').open = false;
    drawLines(false, true); loadLineDetails(); changed();
  };
}

async function build() {
  const c = S.cart;
  if (!c.lines.length) { S.result = null; drawResult(); return; }
  if (c.stores && !c.stores.length) { S.result = { error: 'Pick at least one shop under Shops & travel.' }; drawResult(); return; }
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
    el.innerHTML = `<div class="panel">${emptyState('basket', 'Your best cart appears here', 'Add items and Smart Basket finds the cheapest way to buy them. Or start from a basket:')}
      <div class="baskets" id="cart-baskets" style="grid-template-columns:1fr"></div></div>`;
    loadBaskets($('#cart-baskets'));
    updateGauge(0);
    return;
  }
  if (r.error) { el.innerHTML = `<div class="callout warn">${ic('alert')}<div>${h(r.error)}</div></div>`; return; }
  if (r.status === 'over_budget') {
    el.innerHTML = `<div class="callout bad">${ic('alert')}<div><b>Over budget.</b> ${h(r.message)}</div></div>`;
    updateGauge(r.must_cost, true);
    animate(el.firstElementChild, { transform: ['translateX(0px)', 'translateX(-6px)', 'translateX(6px)', 'translateX(-3px)', 'translateX(0px)'] }, { duration: 0.35 });
    return;
  }
  const budget = r.mode === 'budget';
  const nStores = r.stores.length;
  const lineName = (x) => `${x.brand ? h(x.brand) + ' ' : ''}${h(x.name)} <span class="faint" style="font-weight:500">${h(x.size)}</span>`;
  const sameShops = prev && prev.stores && prev.stores.map((s) => s.store_id).join() === r.stores.map((s) => s.store_id).join();
  let note = '';
  if (budget) note = r.left_out.length ? `${plural(r.left_out.length, 'item')} didn't fit. See below.` : 'Everything fits your budget.';
  else if (r.saving_vs_best_single > 0.005) note = `${money(r.saving_vs_best_single)} cheaper than buying everything at ${h(r.best_single.store_name)}.`;
  else if (nStores === 1) note = `${h(r.stores[0].store_name)} is the cheapest for your whole list.`;

  let html = `<div class="summary" id="summary"><span class="cap">${budget ? 'Your budget cart' : 'Cheapest total'}</span>
      <div class="total" id="sum-total">${money(prev && prev.total ? prev.total : 0)}</div>
      <div class="sum-stats">
        <div><small>Specials save</small><b id="sum-save">${money(prev && prev.special_savings ? prev.special_savings : 0)}</b></div>
        <div><small>Shops</small><b>${nStores}</b></div>
        <div><small>${budget ? 'Left over' : 'Items'}</small><b id="sum-3">${budget ? money(r.budget_left) : r.items_bought}</b></div>
      </div>
      ${note ? `<div class="sum-note">${ic(budget && r.left_out.length ? 'info' : 'checkCircle', 'sm')}<span>${note}</span></div>` : ''}
      ${r.travel ? `<div class="sum-note">${ic('pin', 'sm')}<span>Includes ${money(r.travel)} travel.</span></div>` : ''}
    </div>`;
  if (r.not_covered.length) html += `<div class="callout warn">${ic('alert')}<div><b>Not available within ${plural(r.max_stores, 'shop')}:</b> ${r.not_covered.map((x) => h(x.name)).join(', ')}. Allow more shops to include them.</div></div>`;
  if (r.unavailable.length) html += `<div class="callout warn">${ic('alert')}<div><b>Not sold at your selected shops:</b> ${r.unavailable.map((x) => h(x.name) + (x.brand ? ` (${h(x.brand)})` : '')).join(', ')}. Try “Any brand” or more shops.</div></div>`;
  if (nStores) {
    html += `<div class="plans" id="plans">${r.stores.map((s) => `
      <section class="plan"><div class="plan-head">${logo(s.store_id, 'lg')}<div style="text-align:right">${amt(s.subtotal)}${s.savings ? `<div style="margin-top:4px"><span class="tag good">saves ${money(s.savings)}</span></div>` : ''}</div></div>
        <ul>${s.items.map((x) => `<li><input type="checkbox" aria-label="Got ${h(x.name)}">${catTile(x.category, x.name, 'sm')}<div><div class="pl-name">${x.qty} × ${lineName(x)}</div>
          <div class="pl-sub">${x.on_special ? `<span class="tag sale">${h(x.special_label || 'Special')}</span> ${h(until(x.valid_until))}` : `${money(x.unit_price)} each`}${x.source === 'sample' ? ' · sample' : ''}</div></div>
          <div class="pl-price">${money(x.line_total)}${x.on_special && x.saving > 0 ? `<small><s>${money(x.regular_price * x.qty)}</s></small>` : ''}</div></li>`).join('')}</ul></section>`).join('')}</div>`;
  }
  if (r.left_out.length) {
    html += `<div class="panel leftout"><h3 style="margin-bottom:6px">Didn't fit your budget</h3><ul>${r.left_out.map((x) => `<li><span>${x.wanted - x.bought} × ${h(x.name)} <span class="faint">${h(x.size)}</span></span>
      <span class="tag">+${money(x.extra_needed)}</span></li>`).join('')}</ul></div>`;
  }
  if (r.comparison.length) {
    const max = Math.max(...r.comparison.map((x) => x.total), r.items_total);
    html += `<details class="panel bars-wrap"><summary><span>${budget ? 'Your full list at each shop' : 'Compare shops'}</span>${ic('chevDown', 'chev')}</summary><div class="bars" style="margin-top:14px">
      <div class="bar smart"><span class="bar-name">This plan</span><div class="bar-track"><div class="bar-fill" style="width:${(100 * r.items_total / max).toFixed(1)}%"></div><span class="bar-label">${plural(nStores, 'shop')}</span></div><div class="bar-val">${money(r.items_total)}</div></div>
      ${r.comparison.slice(0, 12).map((x, i) => `<div class="bar ${i === 0 ? 'cheapest' : ''}">${logo(x.store_id, 'sm')}<div class="bar-track"><div class="bar-fill" style="width:${(100 * x.total / max).toFixed(1)}%"></div>${i === 0 ? '<span class="bar-label">cheapest single shop</span>' : ''}</div>
        <div class="bar-val">${money(x.total)}${x.missing ? `<small>${x.missing} missing</small>` : ''}</div></div>`).join('')}
    </div><p class="faint" style="font-size:.76rem;margin-top:10px">Totals for the items each shop stocks, before travel.</p></details>`;
  }
  html += `<div class="actions">
      <button class="btn primary" type="button" id="save-list">${ic('bookmark', 'sm')} ${c.listId ? 'Update saved list' : 'Save list'}</button>
      <a class="btn" id="wa" target="_blank" rel="noopener">${ic('message', 'sm')} WhatsApp</a>
      <button class="btn" type="button" id="copy-plan">${ic('copy', 'sm')} Copy</button>
      <button class="btn" type="button" id="print-plan">${ic('printer', 'sm')} Print</button>
    </div><div id="save-box"></div>`;
  el.innerHTML = html;

  countTo($('#sum-total'), r.total, money);
  countTo($('#sum-save'), r.special_savings, money);
  updateGauge(r.total, false);
  if (!sameShops) reveal($$('#plans .plan'), { step: 0.06, y: 14 });
  const bw = $('.bars-wrap');
  if (bw) bw.addEventListener('toggle', () => { if (bw.open) animate($$('.bar-fill', bw), { transform: ['scaleX(0)', 'scaleX(1)'] }, { duration: 0.7, delay: (i) => i * 0.04, ease: EASE }); });
  $('#wa').href = 'https://wa.me/?text=' + encodeURIComponent(planText(r));
  $('#copy-plan').onclick = async () => { try { await navigator.clipboard.writeText(planText(r)); toast('Shopping plan copied'); } catch { toast("Couldn't copy. Try Print instead.", 'err'); } };
  $('#print-plan').onclick = () => window.print();
  $('#save-list').onclick = saveListPrompt;
  $$('.plan input[type=checkbox]', el).forEach((cb) => cb.onchange = () => { cb.closest('li').classList.toggle('done', cb.checked); });

  const fitsNow = budget && !r.left_out.length;
  const fitsBefore = prev && prev.mode === 'budget' && prev.left_out && !prev.left_out.length;
  if (S.celebrate || (fitsNow && prev && !fitsBefore)) { S.celebrate = false; pop($('#summary'), 1.02); }
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
  const out = [`Smart Basket plan: ${money(r.total)}${r.travel ? ` (incl. ${money(r.travel)} travel)` : ''}`];
  r.stores.forEach((s) => {
    out.push('', `${s.store_name}: ${money(s.subtotal)}`);
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
  reveal([box.firstElementChild], { y: 6 });
  const doSave = async (asNew) => {
    const name = $('#list-name').value.trim() || def;
    const c = S.cart;
    const data = { lines: c.lines, mode: c.mode, budget: c.budget, maxStores: c.maxStores, tripCost: c.tripCost, stores: c.stores, total: S.result ? S.result.total : null };
    try {
      const saved = c.listId && !asNew ? await api('/api/lists/' + c.listId, { method: 'PUT', body: { name, data } }) : await api('/api/lists', { body: { name, data } });
      c.listId = saved.id; c.listName = saved.name; saveCart();
      box.innerHTML = '';
      $('#save-list').innerHTML = `${ic('bookmark', 'sm')} Update saved list`;
      toast(`Saved “${saved.name}”`);
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#save-form').onsubmit = (e) => { e.preventDefault(); doSave(false); };
  const sn = $('#save-new');
  if (sn) sn.onclick = () => doSave(true);
  $('#list-name').focus();
}

// ------------------------------------------------------------------ me: account, lists, reports, admin
async function renderMe() {
  if (!S.user) {
    view.innerHTML = `<section class="join"><div><div class="eyebrow">Free account</div><h1>Keep your lists, shops and savings together.</h1>
        <p class="lede">An account saves your shopping lists and budgets, remembers the shops near you and lets you share specials you spot.</p>
        <div class="row"><button class="btn primary big" type="button" data-register>Create a free account</button><button class="btn big" type="button" data-signin>Sign in</button></div></div>
      <div class="benefits"><div>${ic('bookmark')}<span>Save shopping lists and budgets</span></div><div>${ic('store')}<span>Pick the shops near you</span></div>
        <div>${ic('megaphone')}<span>Share specials you spot in store</span></div><div>${ic('message')}<span>Send plans to WhatsApp</span></div></div></section>
      <div class="section-head"><div><h2>Specials spotted by shoppers</h2><p>Prices other shoppers reported in store</p></div></div><div class="feed" id="recent"></div>`;
    reveal($$('.benefits > div'), { step: 0.06 });
    loadRecent();
    return;
  }
  const u = S.user;
  const ini = u.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  view.innerHTML = `<div class="me-head"><span class="avatar lg">${h(ini)}</span><div><h1 style="font-size:1.9rem">Hi, ${h(u.name.split(' ')[0])}</h1>
      <span class="muted">${h(u.email)}${u.town ? ' · ' + h(u.town) : ''}${u.is_admin ? ' · admin' : ''}</span></div>
      <button class="btn" type="button" id="share-special">${ic('megaphone', 'sm')} Share a special</button><button class="btn ghost" type="button" id="logout">${ic('logout', 'sm')} Sign out</button></div>
    <div class="two">
      <div class="stack">
        <section class="panel"><h2>Saved lists</h2><p class="muted">Open one to load it into your cart.</p><div class="cards" id="lists"><div class="sk" style="min-height:120px"></div></div></section>
        <section class="panel"><h2>Specials spotted by shoppers</h2><p class="muted">Prices other shoppers reported in store.</p><div class="feed" id="recent"></div></section>
      </div>
      <div class="stack">
        <form class="panel" id="myshops"><h2>My shops</h2><p class="muted">Shops you can get to. “My shops” in the cart uses these.</p>
          <div class="store-toggles">${S.meta.stores.map((s) => `<button class="store-toggle" type="button" data-store="${h(s.id)}" aria-pressed="${u.stores.includes(s.id)}" title="${h(s.name)}">${logo(s.id)}</button>`).join('')}</div>
          <button class="btn primary" type="submit" style="margin-top:14px">Save my shops</button></form>
        <form class="panel" id="profile"><h2>Profile</h2><p class="muted">How you appear on specials you share.</p>
          <label>Name<input name="name" maxlength="60" value="${h(u.name)}"></label>
          <label>Town<input name="town" maxlength="60" list="towns" value="${h(u.town)}"></label>
          <button class="btn primary" type="submit">Save</button></form>
        <form class="panel" id="pw"><h2>Password</h2><p class="muted">At least 8 characters.</p>
          <label>Current password<input type="password" name="old" autocomplete="current-password"></label>
          <label>New password<input type="password" name="new" autocomplete="new-password" minlength="8"></label>
          <button class="btn" type="submit">Change password</button></form>
        <div class="panel"><h2>Delete account</h2><p class="muted">Removes your account and saved lists. Specials you shared stay, without your name.</p>
          <button class="btn danger" type="button" id="del-acc">${ic('trash', 'sm')} Delete my account</button></div>
      </div>
    </div>
    <div id="admin"></div>`;
  reveal($$('.panel', view), { step: 0.04 });
  const picked = new Set(u.stores);
  $('#myshops .store-toggles').onclick = (e) => {
    const b = e.target.closest('[data-store]');
    if (!b) return;
    picked.has(b.dataset.store) ? picked.delete(b.dataset.store) : picked.add(b.dataset.store);
    b.setAttribute('aria-pressed', picked.has(b.dataset.store));
  };
  $('#myshops').onsubmit = async (e) => { e.preventDefault(); try { S.user = await api('/api/me', { method: 'PATCH', body: { stores: [...picked] } }); toast('Your shops are saved'); } catch (x) { toast(x.message, 'err'); } };
  $('#profile').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { S.user = await api('/api/me', { method: 'PATCH', body: { name: f.get('name'), town: f.get('town') } }); renderAccountButton(); toast('Profile saved'); } catch (x) { toast(x.message, 'err'); }
  };
  $('#pw').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api('/api/me/password', { body: { old: f.get('old'), new: f.get('new') } }); e.target.reset(); toast('Password changed'); } catch (x) { toast(x.message, 'err'); }
  };
  $('#logout').onclick = async () => { await api('/api/auth/logout', { body: {} }).catch(() => {}); S.user = null; renderAccountButton(); toast('Signed out'); location.hash = '#/deals'; };
  $('#del-acc').onclick = async () => {
    if (!confirm('Delete your account and saved lists? This cannot be undone.')) return;
    try { await api('/api/me', { method: 'DELETE' }); S.user = null; renderAccountButton(); toast('Account deleted'); location.hash = '#/deals'; } catch (x) { toast(x.message, 'err'); }
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
    return `<article class="card" data-id="${l.id}"><div class="row between"><b style="font-weight:650">${h(l.name)}</b><span class="tag">${l.data.mode === 'budget' ? money0(l.data.budget) + ' budget' : 'Cheapest'}</span></div>
      <div class="tiles">${(l.data.lines || []).slice(0, 7).map((x) => catTile(x.category, x.name, 'sm')).join('')}</div>
      <div class="faint" style="font-size:.8rem">${plural(items, 'item')}${l.data.total ? ' · last total ' + money(l.data.total) : ''} · ${h(fmtDate(l.updated_at))}</div>
      <div class="row"><button class="btn primary small" type="button" data-open-list>Open in cart</button><button class="btn small ghost danger" type="button" data-del>Delete</button></div></article>`;
  }).join('') : `<div style="grid-column:1/-1">${emptyState('bookmark', 'No saved lists yet', 'Build a cart and tap “Save list”.')}</div>`;
  reveal(el.children, { step: 0.04 });
  el.onclick = async (e) => {
    const card = e.target.closest('[data-id]');
    if (!card) return;
    const l = d.lists.find((x) => String(x.id) === card.dataset.id);
    if (e.target.closest('[data-open-list]')) {
      S.cart = { ...defaultCart(), ...l.data, listId: l.id, listName: l.name };
      delete S.cart.total;
      S.result = null; saveCart();
      location.hash = '#/cart';
    } else if (e.target.closest('[data-del]') && confirm(`Delete “${l.name}”?`)) {
      try { await api('/api/lists/' + l.id, { method: 'DELETE' }); if (S.cart.listId === l.id) { S.cart.listId = null; saveCart(); } loadLists(); } catch (err) { toast(err.message, 'err'); }
    }
  };
}

async function loadRecent() {
  try {
    const d = await api('/api/reports/recent?limit=12');
    const el = $('#recent');
    if (!el) return;
    el.innerHTML = d.reports.length ? d.reports.map((r) => `<div class="feed-item">${logo(r.store_id, 'sm')}
      <div><b style="font-weight:600">${h(r.brand)} ${h(r.name)}</b> <span class="faint">${h(r.size)}</span><div class="muted">${h(r.label || 'Special')} · until ${h(fmtDate(r.valid_until))} · ${h(r.reporter)}${r.branch ? ' · ' + h(r.branch) : ''}</div></div>
      <div class="price" style="text-align:right"><b style="color:var(--sale);font-weight:650">${money(r.special_price)}</b>${r.price ? `<br><s class="was">${money(r.price)}</s>` : ''}</div></div>`).join('')
      : emptyState('megaphone', 'No specials shared yet', 'Spotted a bargain? Share it so others save too.');
    reveal(el.children, { step: 0.03, y: 6 });
  } catch { /* ignore */ }
}

function openReport() {
  if (!S.user) { openAuth('login', 'Sign in to share specials.'); return; }
  const box = $('#report-body');
  const st = { store: null, item: null };
  box.innerHTML = `<form id="rep" novalidate>
    <div class="opt-title" style="margin-top:0">Shop</div>
    <div class="store-toggles pick" id="rep-shops" role="group" aria-label="Shop">${S.meta.stores.map((s) => `<button class="store-toggle" type="button" data-store="${h(s.id)}" aria-pressed="false" title="${h(s.name)}">${logo(s.id)}</button>`).join('')}</div>
    <label style="margin-top:14px">Product
      <div class="addbox" style="margin-top:.35rem">${ic('search')}<input type="search" id="rep-q" placeholder="Search: maize meal, Sunfoil…" autocomplete="off"><div class="suggest" id="rep-suggest" hidden></div></div>
      <div id="rep-picked"></div></label>
    <div id="rep-brand"></div>
    <div class="field-row">
      <label>Special price<div class="money-input"><span>N$</span><input type="number" id="rep-special" min="0.01" step="0.01" inputmode="decimal" required></div></label>
      <label>Normal price <span class="faint" style="font-weight:500">(if shown)</span><div class="money-input"><span>N$</span><input type="number" id="rep-price" min="0.01" step="0.01" inputmode="decimal"></div></label>
    </div>
    <div class="field-row">
      <label>Deal name <span class="faint" style="font-weight:500">(optional)</span><input id="rep-label" maxlength="60" placeholder="e.g. Weekend special"></label>
      <label>Ends on<input type="date" id="rep-until" value="${addDays(S.meta.today, 6)}" min="${S.meta.today}" max="${addDays(S.meta.today, 62)}"></label>
    </div>
    <label>Branch / town <span class="faint" style="font-weight:500">(optional)</span><input id="rep-branch" maxlength="60" list="towns" value="${h(S.user.town || '')}"></label>
    <p class="form-error" id="rep-error" role="alert"></p>
    <button class="btn primary big wide" type="submit">${ic('megaphone')} Share this special</button></form>`;
  $('#rep-shops').onclick = (e) => {
    const b = e.target.closest('[data-store]');
    if (!b) return;
    st.store = b.dataset.store;
    $$('#rep-shops [data-store]').forEach((x) => x.setAttribute('aria-pressed', x === b));
  };
  attachSuggest($('#rep-q'), $('#rep-suggest'), async (it) => {
    st.item = it;
    $('#rep-picked').innerHTML = `<div class="picked"><span>${catTile(it.category, it.name, 'sm')} ${h(it.name)} <span class="faint">${h(it.size)}</span></span><button class="btn small" type="button" id="rep-unpick">Change</button></div>`;
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
      toast('Thanks! Your special is live.');
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
  box.innerHTML = `<div class="section-head"><div><h2>Admin</h2><p>Keep prices fresh for everyone.</p></div></div>
    <div class="two">
      <div class="stack">
        <form class="panel" id="claude-key"><h2>Read pamphlets with Claude</h2>
          <p class="muted">${S.meta.claude ? 'Connected. New pamphlets are read automatically on every refresh.' : 'Add an Anthropic API key and every pamphlet the Refresh button finds is read automatically: products, prices and dates become specials.'}</p>
          <label>Anthropic API key<input type="password" name="key" autocomplete="off" placeholder="sk-ant-…"></label>
          <button class="btn primary" type="submit">${ic('key', 'sm')} ${S.meta.claude ? 'Replace key' : 'Connect Claude'}</button></form>
        <div class="panel"><h2>Pamphlets &amp; feeds</h2><p class="muted">${lastRefreshText()}</p>
          <button class="btn" type="button" id="force-refresh">${ic('refresh', 'sm')} Refresh everything now</button>
          ${fs.at ? `<p class="faint" style="font-size:.8rem;margin-top:10px">Feeds ${h(ago(fs.at))}: ${fs.results.map((r) => `${h(r.name)} ${r.ok ? '✓ ' + r.imported : '✗'}`).join('; ')}</p>` : ''}</div>
        <div class="panel"><h2>Sample prices</h2><p class="muted">Illustrative prices that fill gaps until real data arrives.</p>
          <button class="btn ${d.sample_enabled ? 'danger' : ''}" type="button" id="sample-toggle">${d.sample_enabled ? 'Turn sample prices off' : 'Turn sample prices on'}</button></div>
      </div>
      <div class="stack">
        <form class="panel" id="imp"><h2>Import prices</h2>
          <p class="muted">CSV or JSON with <code>store, item, size, brand, price, special_price, special_label, valid_until</code>.</p>
          <label>File<input type="file" id="imp-file" accept=".csv,.json,.txt,text/csv,application/json"></label>
          <label>…or paste<textarea id="imp-text" rows="5"></textarea></label>
          <button class="btn primary" type="submit">Import</button><div id="imp-out" style="margin-top:10px"></div></form>
        <div class="panel"><h2>Prices by source</h2><p class="muted">${plural(d.users, 'registered user')}.</p><table class="simple"><tr><th>Source</th><th>Rows</th><th>Latest</th></tr>
          ${d.price_rows.map((r) => `<tr><td>${h(r.source)}</td><td class="tnum">${r.n}</td><td>${h(fmtDate(r.latest))}</td></tr>`).join('')}</table></div>
      </div>
    </div>`;
  $('#claude-key').onsubmit = async (e) => {
    e.preventDefault();
    const key = new FormData(e.target).get('key');
    try { await api('/api/admin/claude-key', { body: { key } }); await loadMeta(); toast('Claude connected'); renderAdmin(box); } catch (x) { toast(x.message, 'err'); }
  };
  $('#force-refresh').onclick = async () => {
    try { R.userStarted = true; const s = await api('/api/refresh', { body: { force: true } }); $('#refresh-btn').classList.add('spinning'); showRefresh(s); pollRefresh(); } catch (x) { toast(x.message, 'err'); }
  };
  $('#sample-toggle').onclick = async () => {
    try { await api('/api/admin/sample', { body: { enabled: !d.sample_enabled } }); S.items = {}; S.baskets = null; await loadMeta(); renderAdmin(box); } catch (x) { toast(x.message, 'err'); }
  };
  $('#imp-file').onchange = async (e) => { const f = e.target.files[0]; if (f) $('#imp-text').value = await f.text(); };
  $('#imp').onsubmit = async (e) => {
    e.preventDefault();
    const out = $('#imp-out');
    const text = $('#imp-text').value;
    if (!text.trim()) { out.innerHTML = '<p class="form-error">Choose a file or paste some rows.</p>'; return; }
    try {
      const r = await api('/api/admin/import', { body: { text } });
      out.innerHTML = `<div class="callout ${r.errors.length ? 'warn' : 'ok'}">${ic(r.errors.length ? 'alert' : 'checkCircle')}<div>Imported ${plural(r.imported, 'price')}.${r.errors.length ? '<br>' + r.errors.map(h).join('<br>') : ''}</div></div>`;
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
    toast('Claude connected. Refresh to read this week\'s pamphlets.');
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
    toast(authMode === 'register' ? `Welcome, ${S.user.name.split(' ')[0]}` : `Welcome back, ${S.user.name.split(' ')[0]}`);
    route();
  } catch (x) {
    $('#auth-error').textContent = x.message;
    animate($('#auth-dialog'), { transform: ['translateX(0px)', 'translateX(-6px)', 'translateX(6px)', 'translateX(0px)'] }, { duration: 0.3 });
  } finally { btn.disabled = false; }
};

// ------------------------------------------------------------------ global clicks & keys
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-signin]')) openAuth('login');
  if (e.target.closest('[data-register]')) openAuth('register');
  if (e.target.closest('[data-refresh]') || e.target.closest('#refresh-btn')) startRefresh();
  if (e.target.closest('[data-claude]')) openClaude();
  const add = e.target.closest('[data-add-deal]');
  if (add) {
    const x = S.deals[add.dataset.addDeal];
    if (x) {
      addToCart({ item_id: x.item_id, product_id: x.product_id, name: x.name, size: x.size, brand: x.brand, category: x.category }, 1, { from: add });
      add.classList.add('added'); add.innerHTML = ic('check'); pop(add, 1.15);
      clearTimeout(add.t); add.t = setTimeout(() => { add.classList.remove('added'); add.innerHTML = ic('plus'); }, 1500);
    }
    return;
  }
  const od = e.target.closest('[data-open-deal]');
  if (od) { openDeal(od.dataset.openDeal); return; }
  if (e.target.closest('[data-sheet-close]')) { closeSheet(); return; }
  const sa = e.target.closest('[data-sheet-add]');
  if (sa) {
    const x = S.deals[sa.dataset.sheetAdd];
    if (x) addToCart({ item_id: x.item_id, product_id: x.product_id, name: x.name, size: x.size, brand: x.brand, category: x.category }, 1, { from: sa });
    return;
  }
  const sp = e.target.closest('[data-sheet-pamphlet]');
  if (sp) { const id = sp.dataset.sheetPamphlet; closeSheet(() => openReader(id)); return; }
  const basket = e.target.closest('[data-basket]');
  if (basket) {
    if (basket.classList.contains('chip')) {
      const b = (S.baskets || []).find((x) => x.id === basket.dataset.basket);
      if (b) {
        b.lines.forEach((ln) => addToCart({ item_id: ln.item_id, name: ln.name, size: ln.size }, ln.qty, { quiet: true }));
        toast(`Added ${b.name}`); pop(basket);
        drawLines(false, true); loadLineDetails(); changed();
      }
    } else useBasket(basket.dataset.basket);
  }
  const open = e.target.closest('[data-open]');
  if (open && S.view === 'pamphlets') openReader(open.dataset.open, open);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || $$('dialog[open]').length || e.target.closest('input, textarea, select')) return;
  const q = $('#d-q') || $('#cmp-q') || $('#add-q');
  if (q) { e.preventDefault(); q.focus(); q.select(); }
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
  moveIndicator();
  if ($('#sheet').open) { $('#sheet').close(); $('#sheet').style.transform = ''; }
  if (rDlg.open) rDlg.close();
  const go = () => VIEWS[S.view]();
  if (!S.booted) { S.booted = true; go(); return; }
  // the callback must not wait for the view's data: the old page would stay frozen until it arrived
  if (document.startViewTransition && !REDUCED) document.startViewTransition(() => { go(); }); else go();
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
  hydrateIcons();
  updateCartCount();
  try { await loadMeta(); } catch (e) {
    view.innerHTML = emptyState('alert', 'Can\'t reach the server', h(e.message));
    return;
  }
  route();
  loadLeaflets().catch(() => {});
  if (S.meta.refreshing) { $('#refresh-btn').classList.add('spinning'); pollRefresh(); }
})();
