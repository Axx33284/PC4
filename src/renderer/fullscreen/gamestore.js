// Game Store: this week's free games on Epic (and next week's), Steam deals, top sellers, new releases and
// what's most played. ✕ opens the game in its launcher (Epic Games / Steam), △ in the browser.
import { ctx, api, el, pushLayer, removeLayer, hintsHtml } from './core.js';
import { sfx } from './sound.js';
import { esc, icon } from '../common/util.js';
import { toast, raise } from './ui.js';

const TABS = [
  ['epic', 'Free on Epic'], ['deals', 'Steam Deals'], ['topSellers', 'Top Sellers'], ['newReleases', 'New Releases'], ['mostPlayed', 'Most Played'],
];
const COLS = 4;
const money = (cents, cur) => (cents ? new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD' }).format(cents / 100) : 'Free to Play');
const day = iso => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const left = iso => { const h = Math.round((new Date(iso) - Date.now()) / 3600000); return h < 48 ? `${Math.max(1, h)} hours left` : `until ${day(iso)}`; };
const fmtPlayers = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));

let open_ = false;

export async function openStore(startTab = 0) {
  if (open_) return;
  open_ = true;
  sfx('accept');
  const node = el(`<div class="layer app-screen store-app"><div class="as-head">${icon('store')}<h1>Game Store</h1><div class="st-tabs"></div></div>
    <div class="st-body"><div class="st-grid"></div></div>
    <div class="hints">${hintsHtml([['l1', ''], ['r1', 'Switch'], ['cross', 'Open in Launcher'], ['triangle', 'Open in Browser'], ['circle', 'Back']])}</div></div>`);
  document.body.appendChild(raise(node));
  requestAnimationFrame(() => node.classList.add('in'));
  const grid = node.querySelector('.st-grid');
  let data = null, tab = startTab, sel = 0;

  const items = () => {
    if (!data) return [];
    const k = TABS[tab][0];
    if (k === 'epic') return [...data.epic.now, ...data.epic.soon];
    return data.steam[k] || [];
  };

  const card = (g, i) => {
    let tag = '', line = '';
    if (g.store === 'epic') {
      tag = g.free === 'now' ? '<span class="st-free">FREE NOW</span>' : '<span class="st-soon">FREE NEXT</span>';
      line = g.free === 'now' ? `Free ${left(g.end)} · usually ${esc(g.price)}` : `Free from ${day(g.start)} to ${day(g.end)}`;
    } else if (TABS[tab][0] === 'mostPlayed') {
      line = `${fmtPlayers(g.players)} playing at peak`;
    } else {
      if (g.discount) tag = `<span class="st-off">−${g.discount}%</span>`;
      line = money(g.price, g.currency);
    }
    return `<div class="st-card ${i === sel ? 'sel focus-ring' : ''}" data-i="${i}"><div class="st-img">${g.image ? `<img src="${esc(g.image)}" loading="lazy" decoding="async" alt="">` : ''}${tag}</div>
      <div class="st-name">${esc(g.name)}</div><div class="st-line">${line}</div><div class="st-from">${g.store === 'epic' ? 'Epic Games Store' : 'Steam'}</div></div>`;
  };

  const render = () => {
    node.querySelector('.st-tabs').innerHTML = TABS.map(([, l], i) => `<span class="${i === tab ? 'on' : ''}" data-t="${i}">${l}</span>`).join('');
    const list = items();
    sel = Math.min(sel, Math.max(0, list.length - 1));
    grid.innerHTML = !data ? '<div class="pick-status">Loading the store…</div>'
      : list.length ? list.map(card).join('') : '<div class="pick-status">Nothing here right now. PC4 checks again in a while.</div>';
    const s = grid.querySelector('.sel');
    if (s) s.scrollIntoView({ block: 'nearest' });
  };

  const openItem = (g, browser = false) => {
    if (!g) return;
    sfx('accept');
    const target = !browser && g.launcher ? g.launcher : g.url;
    api.openExternal(target);
    toast({ title: browser ? 'Opening in your browser' : g.store === 'epic' ? 'Opening the Epic Games Launcher' : 'Opening in Steam', body: g.name, ico: 'store' });
  };

  const layer = {
    handle(a) {
      const list = items();
      const move = d => { const n = sel + d; if (n >= 0 && n < list.length) { sel = n; sfx('move'); render(); } };
      if (a === 'left') { if (sel % COLS) move(-1); }
      else if (a === 'right') { if (sel % COLS < COLS - 1) move(1); }
      else if (a === 'up' || a === 'wheel-up') move(-COLS);
      else if (a === 'down' || a === 'wheel-down') move(Math.min(COLS, list.length - 1 - sel) || 0);
      else if (a === 'l1' || a === 'r1') { const n = tab + (a === 'l1' ? -1 : 1); if (n >= 0 && n < TABS.length) { tab = n; sel = 0; sfx('move'); render(); } }
      else if (a === 'accept') openItem(list[sel]);
      else if (a === 'triangle') openItem(list[sel], true);
      else if (a === 'back' || a === 'home') close();
    },
  };
  const close = () => {
    if (!open_) return;
    open_ = false;
    removeLayer(layer);
    node.classList.remove('in');
    setTimeout(() => node.remove(), 300);
    sfx('back');
  };
  node.querySelector('.st-tabs').addEventListener('click', e => { const t = e.target.closest('[data-t]'); if (t) { tab = Number(t.dataset.t); sel = 0; render(); } });
  grid.addEventListener('click', e => { const c = e.target.closest('[data-i]'); if (c) { sel = Number(c.dataset.i); render(); openItem(items()[sel]); } });
  pushLayer(layer);
  render();
  data = await api.shop();
  if (open_) render();
}

// for the home screen's Store tile: this week's free Epic games
export async function freeGames() {
  try { const d = await api.shop(); return d.epic.now; } catch { return []; }
}
