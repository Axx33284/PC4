// Desktop mode: a Playnite-style library manager (mouse + keyboard), laid out like Playnite's desktop app with its
// "Standard X" theme: sidebar, top panel, Grid / Details / List views, grouping, sorting, the filter panel, the
// explorer panel, filter presets, global search, random game, notifications, statistics and the Controller Test.
import { mediaUrl, avatarUrl, esc, icon, fmtPlaytime, fmtHours, timeAgo, SOURCES, fileUrl, loadCustomFonts, adjustStyle, padGlyph, padFamily } from '../common/util.js';
import { LIGHT_COLORS, colorOf, applyLightBar } from '../common/lightbar.js';
import { mountPadTester } from '../common/padtester.js';

const api = window.pc4;
let S = await api.getState();
loadCustomFonts(S);
const $ = s => document.querySelector(s);
const m = (g, k) => mediaUrl(S, g, k);
const gameById = id => S.games.find(g => g.id === id);
const isRunning = id => S.running.includes(id);
const THEME_NAMES = { blue: 'Classic Blue', midnight: 'Midnight', crimson: 'Crimson', emerald: 'Emerald', violet: 'Violet', sunset: 'Sunset', silver: 'Silver', black: 'Black' };
const IMG_FILTERS = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'ico'] }];
const KINDS = {
  cover: { label: 'Cover', hint: '600×900' },
  tile: { label: 'Console Tile', hint: 'square' },
  hero: { label: 'Banner', hint: 'wide, tiles & cards' },
  background: { label: 'Wallpaper', hint: 'full screen' },
  logo: { label: 'Logo', hint: 'transparent' },
  icon: { label: 'Icon', hint: 'square' },
};

// ---------------- fields (what Playnite groups, sorts, filters and explores by) ----------------
const COMPLETION = ['Not Played', 'Plan to Play', 'Playing', 'On Hold', 'Abandoned', 'Played', 'Beaten', 'Completed'];
const completion = g => (COMPLETION.includes(g.completion) ? g.completion : g.playtime > 0 || g.lastPlayed ? 'Played' : 'Not Played');
const yearOf = g => { const r = /(\d{4})/.exec((g.meta && g.meta.releaseDate) || ''); return r ? r[1] : null; };
const dateOf = g => { const d = (g.meta && g.meta.releaseDate) || ''; const t = Date.parse(d); return Number.isNaN(t) ? (yearOf(g) ? Date.UTC(+yearOf(g), 0, 1) : 0) : t; };
const PLAYED = ['Today', 'Yesterday', 'This Week', 'This Month', 'Last Month', 'This Year', 'More Than a Year Ago', 'Never'];
function playedBucket(g) {
  if (!g.lastPlayed) return 'Never';
  const now = new Date(), d = new Date(g.lastPlayed);
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (g.lastPlayed >= day) return 'Today';
  if (g.lastPlayed >= day - 864e5) return 'Yesterday';
  if (g.lastPlayed >= day - ((now.getDay() + 6) % 7) * 864e5) return 'This Week';
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return 'This Month';
  const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  if (d.getFullYear() === lm.getFullYear() && d.getMonth() === lm.getMonth()) return 'Last Month';
  if (d.getFullYear() === now.getFullYear()) return 'This Year';
  return 'More Than a Year Ago';
}
const FIELDS = {
  source: { label: 'Library', get: g => [SOURCES[g.source] || g.source || 'PC'] },
  completion: { label: 'Completion Status', get: g => [completion(g)], order: COMPLETION },
  installed: { label: 'Installation Status', get: g => [g.installed ? 'Installed' : 'Not Installed'], order: ['Installed', 'Not Installed'] },
  favorite: { label: 'Favorite', get: g => [g.favorite ? 'Favorites' : 'Other Games'], order: ['Favorites', 'Other Games'] },
  genre: { label: 'Genres', none: 'No Genre', get: g => (g.meta && g.meta.genres) || [] },
  developer: { label: 'Developers', none: 'No Developer', get: g => (g.meta && g.meta.developers) || [] },
  publisher: { label: 'Publishers', none: 'No Publisher', get: g => (g.meta && g.meta.publishers) || [] },
  category: { label: 'Categories', none: 'No Category', get: g => S.folders.filter(f => f.gameIds.includes(g.id)).map(f => f.name) },
  year: { label: 'Release Year', none: 'Unknown', get: g => (yearOf(g) ? [yearOf(g)] : []), desc: true },
  played: { label: 'Last Played', get: g => [playedBucket(g)], order: PLAYED },
};
const valuesOf = (f, g) => { const v = FIELDS[f].get(g); return v.length ? v : [FIELDS[f].none || 'None']; };
const LIST_FILTERS = ['source', 'completion', 'genre', 'developer', 'publisher', 'category', 'year'];

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
const SORT_BY = {
  name: { label: 'Name', fn: byName },
  lastPlayed: { label: 'Last Played', fn: (a, b) => (a.lastPlayed || 0) - (b.lastPlayed || 0), desc: true },
  playtime: { label: 'Time Played', fn: (a, b) => (a.playtime || 0) - (b.playtime || 0), desc: true },
  playCount: { label: 'Play Count', fn: (a, b) => (a.playCount || 0) - (b.playCount || 0), desc: true },
  added: { label: 'Date Added', fn: (a, b) => (a.added || 0) - (b.added || 0), desc: true },
  release: { label: 'Release Date', fn: (a, b) => dateOf(a) - dateOf(b), desc: true },
  completion: { label: 'Completion Status', fn: (a, b) => COMPLETION.indexOf(completion(a)) - COMPLETION.indexOf(completion(b)) },
  source: { label: 'Library', fn: (a, b) => (SOURCES[a.source] || '').localeCompare(SOURCES[b.source] || '') },
};
const OLD_SORTS = { recent: ['lastPlayed', 'desc'], name: ['name', 'asc'], playtime: ['playtime', 'desc'], added: ['added', 'desc'] };

// ---------------- state ----------------
function normFilters(f = {}) {
  const out = { installed: !!f.installed, uninstalled: !!f.uninstalled, favorite: !!f.favorite, hidden: !!f.hidden, and: !!f.and };
  for (const k of LIST_FILTERS) out[k] = Array.isArray(f[k]) ? [...f[k]] : [];
  return out;
}
const D = S.settings.desktop || {};
const ui = {
  sort: SORT_BY[D.sort] ? D.sort : (OLD_SORTS[D.sort] || ['name'])[0],
  sortDir: D.sortDir || (OLD_SORTS[D.sort] || [, 'asc'])[1],
  cover: D.coverSize || 200,
  view: ['grid', 'details', 'list'].includes(D.view) ? D.view : 'grid',
  group: FIELDS[D.group] ? D.group : 'none',
  filterPanel: !!D.filterPanel,
  explorer: !!D.explorer,
  explorerField: FIELDS[D.explorerField] ? D.explorerField : 'source',
  explore: null,              // { field, value } picked in the explorer panel
  filters: normFilters(D.filters),
  presets: Array.isArray(D.presets) ? D.presets : [],
  gridDetails: !!D.gridDetails,
  collapsed: new Set(D.collapsed || []),
  section: 'library',         // library | stats | pad
  search: '',
  selected: null,
};
// older PC4 versions had one "Show" list: carry it over into the filters once
if (D.filter && D.filter !== 'all' && !Object.keys(D.filters || {}).length) {
  if (['installed', 'favorite', 'hidden'].includes(D.filter.replace(/s$/, ''))) ui.filters[D.filter.replace(/s$/, '')] = true;
  else if (D.filter === 'recent') { ui.sort = 'lastPlayed'; ui.sortDir = 'desc'; }
}

function savePrefs() {
  api.updateSettings({ desktop: {
    sort: ui.sort, sortDir: ui.sortDir, coverSize: ui.cover, view: ui.view, group: ui.group, filterPanel: ui.filterPanel,
    explorer: ui.explorer, explorerField: ui.explorerField, filters: ui.filters, presets: ui.presets, gridDetails: ui.gridDetails,
    collapsed: [...ui.collapsed], filter: 'all',
  } });
}

const filterCount = () => ['installed', 'uninstalled', 'favorite', 'hidden'].filter(k => ui.filters[k]).length + LIST_FILTERS.reduce((n, k) => n + ui.filters[k].length, 0);

function passes(g) {
  const f = ui.filters;
  if (!!g.hidden !== f.hidden) return false; // like Playnite: hidden games only show with the Hidden filter, and then only them
  if (f.installed !== f.uninstalled && g.installed !== f.installed) return false;
  if (f.favorite && !g.favorite) return false;
  for (const k of LIST_FILTERS) {
    if (!f[k].length) continue;
    const v = valuesOf(k, g);
    if (f.and ? !f[k].every(x => v.includes(x)) : !f[k].some(x => v.includes(x))) return false;
  }
  if (ui.explore && !valuesOf(ui.explore.field, g).includes(ui.explore.value)) return false;
  if (ui.search) {
    const q = ui.search.toLowerCase();
    const meta = g.meta || {};
    if (!g.name.toLowerCase().includes(q) && ![...(meta.developers || []), ...(meta.publishers || []), ...(meta.genres || [])].some(x => x.toLowerCase().includes(q))) return false;
  }
  return true;
}

function sortList(list) {
  const s = SORT_BY[ui.sort] || SORT_BY.name;
  const dir = ui.sortDir === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => s.fn(a, b) * dir || byName(a, b));
}
const visible = () => sortList(S.games.filter(passes));

// groups like Playnite: a game with two genres is in both genre groups
function groupsOf(list) {
  if (ui.group === 'none') return [{ key: null, games: list }];
  const F = FIELDS[ui.group];
  const map = new Map();
  for (const g of list) for (const v of valuesOf(ui.group, g)) { if (!map.has(v)) map.set(v, []); map.get(v).push(g); }
  const none = F.none || 'None';
  const keys = [...map.keys()].sort((a, b) => {
    if (a === none) return 1; if (b === none) return -1;
    if (F.order) return F.order.indexOf(a) - F.order.indexOf(b);
    return F.desc ? b.localeCompare(a, undefined, { numeric: true }) : a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
  });
  return keys.map(k => ({ key: k, games: map.get(k) }));
}

// ---------------- rendering helpers ----------------
// Each part is only rebuilt when its HTML changed: state arrives often (artwork downloads, play time), and an
// untouched grid keeps its decoded images and an open <select> stays open.
const lastHtml = {};
function setHtml(el, key, html) {
  if (lastHtml[key] === html) return false;
  lastHtml[key] = html;
  el.innerHTML = html;
  return true;
}
const forget = re => { for (const k of Object.keys(lastHtml)) if (re.test(k)) delete lastHtml[k]; };

function coverHtml(g) {
  const cover = m(g, 'coverThumb') || m(g, 'cover');
  const adj = (g.artAdjust || {}).cover;
  if (cover) return `<img src="${cover}" loading="lazy" decoding="async"${adj ? ` style="${adjustStyle(adj)}"` : ''}>`;
  const hero = m(g, 'heroThumb') || m(g, 'hero');
  const logo = m(g, 'logo');
  if (hero) return `<div class="ph hero"><img class="bg" src="${hero}" loading="lazy" decoding="async">${logo ? `<img class="lg" src="${logo}" loading="lazy">` : `<span style="position:relative">${esc(g.name)}</span>`}</div>`;
  return `<div class="ph"><span>${esc(g.name)}</span></div>`;
}
const iconHtml = g => { const ic = m(g, 'icon'); return ic ? `<img class="gi" src="${ic}" loading="lazy">` : `<span class="gi none">${icon('gameController')}</span>`; };
const groupHead = (gr, n) => `<div class="grp ${ui.collapsed.has(ui.group + ':' + gr.key) ? 'closed' : ''}" data-grp="${esc(gr.key)}">${icon('caretDown')}<span>${esc(gr.key)}</span><small>${n}</small><i></i></div>`;
const isClosed = gr => gr.key != null && ui.collapsed.has(ui.group + ':' + gr.key);

// ---------------- top panel, sidebar ----------------
const tpBtn = (id, ico, title, on = false, extra = '') => `<button class="tp-btn ${on ? 'on' : ''}" data-tp="${id}" title="${esc(title)}">${icon(ico)}${extra}</button>`;
function renderTop() {
  const nf = filterCount();
  const notes = notifications.length;
  setHtml($('#tp-items'), 'top', `
    ${tpBtn('gsearch', 'search', 'Search everything (Ctrl+Shift+F)')}
    ${tpBtn('presets', 'tag', 'Filter presets')}
    ${tpBtn('group', 'stack', `Group by: ${ui.group === 'none' ? "Don't group" : FIELDS[ui.group].label}`, ui.group !== 'none')}
    ${tpBtn('sort', ui.sortDir === 'desc' ? 'sortDescending' : 'sortAscending', `Sort by: ${SORT_BY[ui.sort].label}`)}
    <span class="tp-sep"></span>
    ${tpBtn('view-details', 'sidebarSimple', 'Details view', ui.view === 'details' && ui.section === 'library')}
    ${tpBtn('view-grid', 'squaresFour', 'Grid view', ui.view === 'grid' && ui.section === 'library')}
    ${tpBtn('view-list', 'listBullets', 'List view', ui.view === 'list' && ui.section === 'library')}
    <span class="tp-sep"></span>
    ${tpBtn('random', 'shuffle', 'Pick a random game (Ctrl+R)')}
    ${tpBtn('explorer', 'compass', 'Explorer panel', ui.explorer)}
    ${tpBtn('filter', 'funnel', 'Filters', ui.filterPanel || nf > 0, nf ? `<b class="tp-dot">${nf}</b>` : '')}
    ${tpBtn('notes', 'bell', 'Notifications', false, notes ? `<b class="tp-count">${notes}</b>` : '')}`);
  renderPadBadge();
}

// the controller in the top-right corner, with its battery (from PC4's controller helper, or the browser's pad list)
let padSeen = null;
function renderPadBadge() {
  const p = ((S.emulator && S.emulator.pads) || [])[0];
  let html = '';
  if (p || padSeen) {
    const kind = p ? (p.kind && /dualsense/i.test(p.kind) ? 'ps5' : 'ps4') : padFamily(padSeen) || 'ps4';
    const name = p ? `${p.kind || 'Controller'} · ${p.bus || ''}` : (padSeen || '').replace(/\(.*?\)/g, '').trim();
    const b = p && p.battery >= 0 ? p.battery : null;
    html = `<button class="tp-pad ${b != null && b <= 15 ? 'low' : ''}" data-tp="pad" title="${esc(name)}${b != null ? ` — battery ${b}%${p.charging ? ', charging' : ''}` : ''} (Controller Test)">${padGlyph(kind)}
      ${b != null ? `<span class="batt ${p.charging ? 'chg' : ''}"><i style="width:${b}%"></i></span><span class="pct">${b}%</span>${p.charging ? icon('lightning') : ''}` : ''}</button>`;
  }
  setHtml($('#tp-right'), 'pad', html);
}
setInterval(() => {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const id = (pads.find(x => /054c/i.test(x.id)) || pads[0] || {}).id || null;
  if (id !== padSeen) { padSeen = id; renderPadBadge(); }
}, 2000);

function renderSidebar() {
  const it = (id, ico, title) => `<button class="sb-it ${ui.section === id ? 'on' : ''}" data-sb="${id}" title="${esc(title)}">${icon(ico)}</button>`;
  setHtml($('#sidebar'), 'side', `<button class="sb-menu" data-sb="menu" title="Main menu">${icon('list')}</button>
    ${it('library', 'books', 'Library')}${it('stats', 'chartBar', 'Statistics')}${it('pad', 'gameController', 'Controller Test')}
    <span class="sb-fill"></span>
    <button class="sb-it" data-sb="console" title="Switch to Console Mode (F11)">${icon('monitorPlay')}</button>
    <button class="sb-it" data-sb="settings" title="Settings">${icon('gear')}</button>`);
}

// ---------------- explorer + filter panels ----------------
function counts(field, list) {
  const map = new Map();
  for (const g of list) for (const v of valuesOf(field, g)) map.set(v, (map.get(v) || 0) + 1);
  const F = FIELDS[field];
  return [...map.entries()].sort((a, b) => (F.order ? F.order.indexOf(a[0]) - F.order.indexOf(b[0]) : F.desc ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0], undefined, { sensitivity: 'base' })));
}

function renderExplorer() {
  const el = $('#explorer');
  el.classList.toggle('hidden', !ui.explorer || ui.section !== 'library');
  if (!ui.explorer) return;
  const base = S.games.filter(g => !g.hidden);
  const cur = ui.explore && ui.explore.field === ui.explorerField ? ui.explore.value : null;
  setHtml(el, 'explorer', `<div class="pn-h"><select id="ex-field">${Object.entries(FIELDS).map(([k, f]) => `<option value="${k}" ${k === ui.explorerField ? 'selected' : ''}>${f.label}</option>`).join('')}</select></div>
    <div class="pn-list">${[['', `All (${base.length})`, !cur], ...counts(ui.explorerField, base).map(([v, n]) => [v, `${v} (${n})`, cur === v])]
      .map(([v, l, on]) => `<div class="ex-it ${on ? 'on' : ''}" data-ex="${esc(v)}">${esc(l)}</div>`).join('')}</div>`);
}

function renderFilterPanel() {
  const el = $('#filterpanel');
  el.classList.toggle('hidden', !ui.filterPanel || ui.section !== 'library');
  if (!ui.filterPanel) return;
  const f = ui.filters;
  const base = S.games.filter(g => !g.hidden);
  const chk = (k, l) => `<label class="ck"><input type="checkbox" data-fk="${k}" ${f[k] ? 'checked' : ''}><span>${l}</span></label>`;
  const sec = k => {
    const list = counts(k, base);
    if (!list.length) return '';
    const open = f[k].length || openSections.has(k);
    return `<div class="fp-sec ${open ? 'open' : ''}" data-sec="${k}"><div class="fp-sh">${icon('caretRight')}<span>${FIELDS[k].label}</span>${f[k].length ? `<b>${f[k].length}</b>` : ''}</div>
      <div class="fp-vals">${list.map(([v, n]) => `<label class="ck"><input type="checkbox" data-fl="${k}" value="${esc(v)}" ${f[k].includes(v) ? 'checked' : ''}><span>${esc(v)}</span><small>${n}</small></label>`).join('')}</div></div>`;
  };
  setHtml(el, 'fpanel', `<div class="pn-h"><h3>Filters</h3>${filterCount() ? '<button class="lnk" data-fp="clear">Clear</button>' : ''}<button class="icon-btn" data-fp="close" title="Close">${icon('x')}</button></div>
    <div class="pn-list">
      ${chk('installed', 'Installed')}${chk('uninstalled', 'Not installed')}${chk('favorite', 'Favorites')}${chk('hidden', 'Hidden')}
      ${chk('and', 'Match all values in a list (AND)')}
      ${LIST_FILTERS.map(sec).join('')}
    </div>
    <div class="pn-f"><button class="btn" data-fp="save">${icon('floppyDisk')} Save as preset…</button></div>`);
}
const openSections = new Set();

// ---------------- library views ----------------
function cardHtml(g) {
  const run = isRunning(g.id);
  return `<div class="card${g.installed ? '' : ' uninstalled'}" data-id="${g.id}" title="${esc(g.name)}">
    <div class="cv">${coverHtml(g)}</div>
    <div class="tags">${run ? '<span class="tag run">Running</span>' : ''}${g.favorite ? `<span class="tag fav">${icon('starFill')}</span>` : ''}</div>
    <div class="hov"><span class="src">${esc(SOURCES[g.source] || g.name)}</span>
      <button data-act="info" title="Details">${icon('dots')}</button>
      <button data-act="${run ? 'close' : 'play'}" title="${run ? 'Close game' : 'Play'}">${icon(run ? 'close' : 'play')}</button></div>
    ${g.installed ? '' : `<button class="dl" data-act="play" title="Not installed — install it with ${esc(SOURCES[g.source] || 'its launcher')}">${icon('download')}</button>`}</div>`;
}

function gridView(groups) {
  return `<div class="v-grid">${groups.map(gr => `${gr.key != null ? groupHead(gr, gr.games.length) : ''}${isClosed(gr) ? '' : `<div class="grid">${gr.games.map(cardHtml).join('')}</div>`}`).join('')}</div>`;
}

function detailsView(groups) {
  const g = gameById(ui.selected);
  return `<div class="v-details"><div class="dlist">${groups.map(gr => `${gr.key != null ? groupHead(gr, gr.games.length) : ''}${isClosed(gr) ? '' : gr.games.map(x => `<div class="dl-it ${x.installed ? '' : 'uninstalled'}" data-id="${x.id}">${iconHtml(x)}<span>${esc(x.name)}</span>${isRunning(x.id) ? '<i class="run"></i>' : ''}</div>`).join('')}`).join('')}</div>
    <div class="dpane">${g ? detailsPane(g) : '<div class="empty">No game selected</div>'}</div></div>`;
}

const COLS = [
  ['icon', '', null], ['name', 'Name', 'name'], ['source', 'Library', 'source'], ['completion', 'Completion Status', 'completion'],
  ['playtime', 'Time Played', 'playtime'], ['lastPlayed', 'Last Played', 'lastPlayed'], ['release', 'Release Date', 'release'],
  ['genres', 'Genres', null], ['developer', 'Developers', null], ['added', 'Date Added', 'added'],
];
function listView(groups) {
  const cell = (c, g) => {
    const meta = g.meta || {};
    switch (c) {
      case 'icon': return iconHtml(g);
      case 'name': return `${esc(g.name)}${isRunning(g.id) ? ' <span class="tag run">Running</span>' : ''}`;
      case 'source': return esc(SOURCES[g.source] || g.source || '');
      case 'completion': return esc(completion(g));
      case 'playtime': return g.playtime >= 60 ? esc(fmtPlaytime(g.playtime)) : '';
      case 'lastPlayed': return g.lastPlayed ? esc(timeAgo(g.lastPlayed)) : '';
      case 'release': return esc(meta.releaseDate || '');
      case 'genres': return esc((meta.genres || []).join(', '));
      case 'developer': return esc((meta.developers || []).join(', '));
      case 'added': return g.added ? esc(new Date(g.added).toLocaleDateString()) : '';
      default: return '';
    }
  };
  const head = `<tr>${COLS.map(([c, l, s]) => `<th class="c-${c} ${s ? 'sortable' : ''} ${s === ui.sort ? 'on' : ''}" ${s ? `data-sort="${s}"` : ''}>${l}${s === ui.sort ? icon(ui.sortDir === 'desc' ? 'caretDown' : 'arrowUp') : ''}</th>`).join('')}</tr>`;
  return `<div class="v-list"><table><thead>${head}</thead><tbody>${groups.map(gr => `${gr.key != null ? `<tr class="grp-row"><td colspan="${COLS.length}">${groupHead(gr, gr.games.length)}</td></tr>` : ''}${isClosed(gr) ? '' : gr.games.map(g => `<tr class="row ${g.installed ? '' : 'uninstalled'}" data-id="${g.id}">${COLS.map(([c]) => `<td class="c-${c}">${cell(c, g)}</td>`).join('')}</tr>`).join('')}`).join('')}</tbody></table></div>`;
}

// the game's details, as in Playnite's Details view and the grid's side panel; values are links that filter by them
function detailsPane(g) {
  const meta = g.meta || {};
  const bg = m(g, 'backgroundThumb') || m(g, 'heroThumb') || m(g, 'background') || m(g, 'hero');
  const cover = m(g, 'coverThumb') || m(g, 'cover');
  const run = isRunning(g.id);
  const links = (k, vals) => vals.map(v => `<a data-filter="${k}" data-v="${esc(v)}">${esc(v)}</a>`).join(', ');
  const row = (label, html) => (html ? `<div class="gd-k">${label}</div><div class="gd-v">${html}</div>` : '');
  const ext = [];
  if (meta.steamAppId) ext.push(`<a data-url="https://store.steampowered.com/app/${meta.steamAppId}">Store</a>`, `<a data-url="https://steamcommunity.com/app/${meta.steamAppId}">Community</a>`);
  ext.push(`<a data-url="https://www.pcgamingwiki.com/w/index.php?search=${encodeURIComponent(g.name)}">PCGamingWiki</a>`, `<a data-url="https://howlongtobeat.com/?q=${encodeURIComponent(g.name)}">HowLongToBeat</a>`);
  return `<div class="gd" data-id="${g.id}">
    <div class="gd-bg" ${bg ? `style="background-image:url('${bg}')"` : ''}></div>
    <div class="gd-top">
      ${cover ? `<img class="gd-cover" src="${cover}">` : ''}
      <div class="gd-title">
        <div class="gd-name">${iconHtml(g)}<h1>${esc(g.name)}</h1></div>
        <div class="gd-btns">
          ${run ? `<button class="playbtn stop" data-gd="close">${icon('close')} Close Game</button>`
            : `<button class="playbtn ${g.installed ? '' : 'install'}" data-gd="play">${icon(g.installed ? 'playFill' : 'download')} ${g.installed ? 'Play' : 'Install'}</button>`}
          <button class="sq" data-gd="more" title="More">${icon('dots')}</button>
          <button class="sq" data-gd="edit" title="Edit (F3)">${icon('edit')}</button>
          <button class="sq ${g.favorite ? 'fav' : ''}" data-gd="fav" title="${g.favorite ? 'Remove from favorites' : 'Add to favorites'}">${icon(g.favorite ? 'starFill' : 'star')}</button>
        </div>
      </div>
    </div>
    <div class="gd-grid">
      ${row('Time Played', esc(fmtPlaytime(g.playtime)))}
      ${row('Last Played', esc(g.lastPlayed ? timeAgo(g.lastPlayed) : 'Never'))}
      ${row('Play Count', String(g.playCount || 0))}
      ${row('Completion Status', `<a data-gd="completion">${esc(completion(g))}</a>`)}
      ${row('User Score', g.userScore != null && g.userScore !== '' ? `${esc(String(g.userScore))} / 100` : '')}
      ${row('Library', links('source', [SOURCES[g.source] || g.source || 'PC']))}
      ${row('Install Directory', g.installDir ? `<a data-gd="folder">${esc(g.installDir)}</a>` : (g.installed ? '' : 'Not installed'))}
      ${row('Genres', links('genre', meta.genres || []))}
      ${row('Developers', links('developer', meta.developers || []))}
      ${row('Publishers', links('publisher', meta.publishers || []))}
      ${row('Release Date', esc(meta.releaseDate || ''))}
      ${row('Categories', links('category', FIELDS.category.get(g)))}
      ${row('Added', g.added ? esc(new Date(g.added).toLocaleDateString()) : '')}
      ${row('Links', ext.join(' · '))}
    </div>
    ${g.notes ? `<div class="gd-sec">Notes</div><div class="gd-text">${esc(g.notes)}</div>` : ''}
    ${meta.description ? `<div class="gd-sec">Description</div><div class="gd-text">${esc(meta.description)}</div>` : ''}
  </div>`;
}

// ---------------- statistics ----------------
function statsView() {
  const all = S.games.filter(g => !g.hidden);
  const played = all.filter(g => g.playtime > 0);
  const total = all.reduce((n, g) => n + (g.playtime || 0), 0);
  const tile = (v, l) => `<div class="st-tile"><b>${esc(String(v))}</b><span>${esc(l)}</span></div>`;
  const bars = (title, rows, fmt = n => n) => {
    const max = Math.max(1, ...rows.map(r => r[1]));
    return `<section class="st-card"><h3>${esc(title)}</h3>${rows.length ? rows.map(([l, n, id]) => `<div class="st-bar" ${id ? `data-id="${id}"` : ''}><span class="l">${esc(l)}</span><span class="b"><i style="width:${(n / max) * 100}%"></i></span><span class="n">${esc(String(fmt(n)))}</span></div>`).join('') : '<div class="hint">Nothing yet</div>'}</section>`;
  };
  const top = [...played].sort((a, b) => b.playtime - a.playtime).slice(0, 10).map(g => [g.name, g.playtime, g.id]);
  const by = f => counts(f, all).map(([v, n]) => [v, n]);
  const recent = [...all].filter(g => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 8);
  return `<div class="v-stats">
    <h2>Statistics</h2>
    <div class="st-tiles">
      ${tile(all.length, 'Games')}${tile(all.filter(g => g.installed).length, 'Installed')}${tile(played.length, 'Played')}
      ${tile(fmtHours(total), 'Total play time')}${tile(played.length ? fmtHours(total / played.length) : '0h', 'Average per played game')}
      ${tile(all.filter(g => g.favorite).length, 'Favorites')}${tile(all.filter(g => ['Beaten', 'Completed'].includes(completion(g))).length, 'Beaten or completed')}
    </div>
    <div class="st-cols">
      ${bars('Most Played', top, n => fmtHours(n))}
      ${bars('Completion Status', by('completion'))}
      ${bars('Library', by('source'))}
      ${bars('Top Genres', by('genre').filter(r => r[0] !== FIELDS.genre.none).sort((a, b) => b[1] - a[1]).slice(0, 10))}
      ${bars('Release Years', by('year').filter(r => r[0] !== FIELDS.year.none).slice(0, 12))}
      <section class="st-card"><h3>Recently Played</h3>${recent.length ? recent.map(g => `<div class="st-rec" data-id="${g.id}">${iconHtml(g)}<span>${esc(g.name)}</span><small>${esc(timeAgo(g.lastPlayed))}</small></div>`).join('') : '<div class="hint">Nothing yet</div>'}</section>
    </div></div>`;
}

// ---------------- the main area ----------------
let tester = null;
function renderMain() {
  const main = $('#main');
  main.dataset.view = ui.section === 'library' ? ui.view : ui.section;
  if (ui.section !== 'pad' && tester) { tester.destroy(); tester = null; forget(/^main$/); }
  if (ui.section === 'pad') {
    if (!tester) {
      main.innerHTML = '<div class="v-pad"></div>';
      lastHtml.main = null;
      tester = mountPadTester(main.querySelector('.v-pad'), {
        settings: S.settings, api,
        hint: 'Press OPTIONS (Menu) for the vibration test · Esc to go back to the library',
        notify: ({ title, body }) => toast(title, body),
        battery: () => ((S.emulator && S.emulator.pads) || [])[0],
      });
    }
    return;
  }
  if (ui.section === 'stats') { setHtml(main, 'main', statsView()); return; }
  let html;
  if (!S.games.length) {
    html = `<div class="empty"><h2>Your library is empty</h2>
      PC4 can find the games you installed with Steam, Epic Games and GOG Galaxy,<br>or you can add any game by picking its .exe (or drag one onto this window).
      <div class="row"><button class="btn primary" data-act="scan">${icon('refresh')} Update game library</button><button class="btn" data-act="add-exe">${icon('exe')} Add a game…</button></div></div>`;
  } else {
    const list = visible();
    if (!list.length) html = `<div class="empty">${ui.search ? `No games match “${esc(ui.search)}”.` : 'No games match the filters.'}${filterCount() || ui.explore ? '<div class="row"><button class="btn" data-act="clear-filters">Clear filters</button></div>' : ''}</div>`;
    else {
      if (!ui.selected || !list.some(g => g.id === ui.selected)) ui.selected = list[0].id;
      const groups = groupsOf(list);
      html = ui.view === 'details' ? detailsView(groups) : ui.view === 'list' ? listView(groups) : gridView(groups);
    }
  }
  document.documentElement.style.setProperty('--cover', ui.cover + 'px');
  const scroller = main.querySelector('.v-grid, .dlist, .v-list');
  const top = scroller ? scroller.scrollTop : 0;
  if (setHtml(main, 'main', html + (ui.view === 'grid' && S.games.length ? `<div class="zoom"><span>Zoom</span><input type="range" id="zoom" min="120" max="320" step="10" value="${ui.cover}"></div>` : ''))) {
    const sc = main.querySelector('.v-grid, .dlist, .v-list');
    if (sc) sc.scrollTop = top;
  }
  markSelected();
  renderSidePane();
}

// grid view: the selected game's details at the side (the ⋯ on a cover, or "Details" in its menu)
function renderSidePane() {
  const show = ui.section === 'library' && ui.view === 'grid' && ui.gridDetails && !editing && gameById(ui.selected);
  let pane = $('#sidepane');
  if (!show) { if (pane) { pane.remove(); forget(/^sidepane$/); } return; }
  if (!pane) {
    pane = document.createElement('aside');
    pane.id = 'sidepane';
    pane.className = 'sidepane';
    $('#body').insertBefore(pane, $('#filterpanel'));
  }
  setHtml(pane, 'sidepane', `<button class="icon-btn sp-x" data-sp="close" title="Close">${icon('x')}</button>${detailsPane(gameById(ui.selected))}`);
}

function markSelected() {
  for (const c of document.querySelectorAll('[data-id].sel')) if (c.dataset.id !== ui.selected) c.classList.remove('sel');
  if (ui.selected) for (const c of document.querySelectorAll(`.card[data-id="${ui.selected}"], .dl-it[data-id="${ui.selected}"], tr.row[data-id="${ui.selected}"]`)) c.classList.add('sel');
}

function render() {
  renderSidebar();
  renderTop();
  renderExplorer();
  renderFilterPanel();
  renderMain();
  renderProgress();
}

// ---------------- notifications (Playnite's bell) ----------------
const notifications = [];
function notify(title, body = '', kind = 'info') {
  notifications.unshift({ id: Date.now() + Math.random(), title, body, kind, ts: Date.now() });
  notifications.length = Math.min(notifications.length, 50);
  renderTop();
}
function notificationsMenu(x, y) {
  closeMenu();
  const el = document.createElement('div');
  el.className = 'menu notes';
  el.innerHTML = `<div class="nt-h"><b>Notifications</b>${notifications.length ? '<button class="lnk" data-nt="clear">Dismiss all</button>' : ''}</div>
    ${notifications.length ? notifications.map(n => `<div class="nt ${n.kind}"><b>${esc(n.title)}</b>${n.body ? `<span>${esc(n.body)}</span>` : ''}<small>${esc(timeAgo(n.ts))}</small></div>`).join('') : '<div class="nt-empty">No notifications</div>'}`;
  $('#menus').appendChild(el);
  el.style.left = Math.min(x, innerWidth - el.offsetWidth - 8) + 'px';
  el.style.top = y + 'px';
  el.addEventListener('click', e => { if (e.target.closest('[data-nt="clear"]')) { notifications.length = 0; closeMenu(); renderTop(); } });
  openMenuEl = el;
}

// the progress of background jobs in the top panel, like Playnite's
let progress = null;
function renderProgress() {
  const u = S.update;
  const p = progress || (u && u.status === 'downloading' ? { text: `Downloading PC4 ${u.version || 'update'}`, value: u.progress || 0 } : null);
  setHtml($('#tp-progress'), 'progress', p ? `<span class="pg-t">${esc(p.text)}</span>${p.value != null ? `<span class="pg-b"><i style="width:${Math.round(p.value * 100)}%"></i></span>` : '<span class="pg-b busy"><i></i></span>'}` : '');
}

// ---------------- menus ----------------
let openMenuEl = null;
function closeMenu() { if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; } document.querySelectorAll('#menus > .menu').forEach(x => x.remove()); }

// items: { label, icon, key, run, danger, disabled, check, sub: [items] } or '-'; a sub menu opens on hover
function showMenu(x, y, items, sub = false) {
  if (!sub) closeMenu();
  const el = document.createElement('div');
  el.className = 'menu';
  el.innerHTML = items.map((it, i) => it === '-' ? '<div class="sep"></div>'
    : `<div class="mi ${it.danger ? 'danger' : ''} ${it.disabled ? 'disabled' : ''}" data-i="${i}">${it.check ? icon('check', 'tick') : it.icon ? icon(it.icon) : '<span class="ico"></span>'}<span>${esc(it.label)}</span>${it.key ? `<span class="k">${esc(it.key)}</span>` : ''}${it.sub ? icon('caretRight', 'sub') : ''}</div>`).join('');
  $('#menus').appendChild(el);
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 8)) + 'px';
  el.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 8)) + 'px';
  let child = null;
  const openSub = mi => {
    if (child && child.dataset.of === mi.dataset.i) return;
    if (child) { child.querySelectorAll('.menu').forEach(x => x.remove()); child.remove(); child = null; }
    const it = items[Number(mi.dataset.i)];
    if (!it || !it.sub) return;
    const mr = mi.getBoundingClientRect();
    child = showMenu(mr.right + 2, mr.top - 5, it.sub, true);
    child.dataset.of = mi.dataset.i;
  };
  el.addEventListener('mouseover', e => { const mi = e.target.closest('[data-i]'); if (mi && el.contains(mi)) openSub(mi); });
  el.addEventListener('click', e => {
    const mi = e.target.closest('[data-i]');
    if (!mi) return;
    const it = items[Number(mi.dataset.i)];
    if (it.sub) { openSub(mi); return; }
    closeMenu();
    if (it.run) it.run();
  });
  if (!sub) openMenuEl = el;
  return el;
}
window.addEventListener('mousedown', e => { if (openMenuEl && !e.target.closest('#menus')) closeMenu(); });
window.addEventListener('blur', closeMenu);

function postDialog() {
  const md = modal({
    title: "Post to What's New",
    body: `<div class="form"><label>Headline</label><input class="input" id="pt-title" placeholder="Something happened…">
      <label style="align-self:start;margin-top:6px">Post</label><textarea id="pt-body" placeholder="Optional"></textarea>
      <label>Picture</label><div class="with-btn"><input class="input" id="pt-img" placeholder="Optional" readonly><button class="btn" id="pt-browse">Browse…</button></div></div>`,
    footer: '<button class="btn" data-no>Cancel</button><button class="btn primary" data-yes>Post</button>',
  });
  const $m = s => md.el.querySelector(s);
  $m('#pt-browse').onclick = async () => {
    const f = await api.openFile({ title: 'Choose a picture', filters: IMG_FILTERS });
    if (f) $m('#pt-img').value = f;
  };
  $m('[data-no]').onclick = () => md.close();
  $m('[data-yes]').onclick = async () => {
    const title = $m('#pt-title').value.trim();
    if (!title) { $m('#pt-title').focus(); return; }
    await api.addPost({ title, body: $m('#pt-body').value.trim(), imageFile: $m('#pt-img').value || null });
    md.close();
    toast("Posted to What's New", title);
  };
  setTimeout(() => $m('#pt-title').focus(), 20);
}

// ---------------- actions ----------------
async function launch(g) {
  const r = await api.launch(g.id);
  if (!r.ok) alertBox("Couldn't start the game", r.error || 'Something went wrong.');
  else if (!r.already) toast('Starting ' + g.name, S.settings.minimizeOnLaunch ? 'PC4 will minimize and track your play time.' : 'Tracking your play time.');
}

async function closeGame(g) {
  if (await confirmBox('Close game', `Close ${g.name}? Unsaved progress will be lost.`, 'Close game')) api.closeGame(g.id);
}

async function removeGame(g) {
  if (await confirmBox('Remove game', `Remove "${g.name}" from your PC4 library? The game itself stays installed.`, 'Remove')) {
    if (ui.selected === g.id) ui.selected = null;
    if (editing && editing.id === g.id) closeEditor();
    api.removeGame(g.id);
  }
}

async function addExe() {
  const f = await api.openFile({ title: 'Choose a game', filters: [{ name: 'Games and shortcuts', extensions: ['exe', 'lnk', 'url', 'bat'] }] });
  if (f) addPath(f);
}

async function addPath(f) {
  const g = await api.addGameFromPath(f);
  ui.selected = g.id;
  toast('Added ' + g.name, 'Downloading artwork…');
  render();
}

async function runImport(sources) {
  toast('Updating game library…', 'Steam, Epic Games and GOG Galaxy', { id: 'import', duration: 0 });
  try {
    const r = await api.importLibraries(sources);
    const missing = Object.entries(r.sources).filter(([, v]) => !v.found).map(([k]) => ({ steam: 'Steam', epic: 'Epic Games', gog: 'GOG Galaxy' }[k]));
    const msg = `${r.added ? `${r.added} new game${r.added > 1 ? 's' : ''} added` : 'No new games found'}${missing.length ? ` · ${missing.join(', ')} not found` : ''}`;
    toast('Library updated', msg, { id: 'import' });
    notify('Library updated', msg);
  } catch (e) {
    toast('Import failed', e.message, { id: 'import' });
  }
}

// ---------------- toasts ----------------
const toasts = new Map();
function toast(title, body = '', { id = null, progress = null, duration = 4500 } = {}) {
  let t = id && toasts.get(id);
  if (!t) {
    t = { el: document.createElement('div') };
    t.el.className = 'toast';
    $('#toasts').appendChild(t.el);
    if (id) toasts.set(id, t);
  }
  t.el.innerHTML = `<b>${esc(title)}</b>${body ? `<span>${esc(body)}</span>` : ''}${progress != null ? `<div class="bar"><i style="width:${Math.round(progress * 100)}%"></i></div>` : ''}`;
  clearTimeout(t.timer);
  if (duration) t.timer = setTimeout(() => { t.el.remove(); if (id) toasts.delete(id); }, duration);
}

// ---------------- modals ----------------
function modal({ title, body, footer = '', cls = '', tabs = '' }) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${cls}"><div class="modal-h"><h2>${esc(title)}</h2><button class="icon-btn" data-close>${icon('x')}</button></div>${tabs}<div class="modal-b">${body}</div>${footer ? `<div class="modal-f">${footer}</div>` : ''}</div>`;
  $('#modals').appendChild(bg);
  const api_ = {
    el: bg,
    close() { bg.remove(); if (api_.onClose) api_.onClose(); },
  };
  bg.addEventListener('mousedown', e => { if (e.target === bg) api_.close(); });
  bg.querySelector('[data-close]').addEventListener('click', () => api_.close());
  return api_;
}

function topModal() { const all = document.querySelectorAll('.modal-bg'); return all[all.length - 1]; }

function confirmBox(title, message, ok = 'OK') {
  return new Promise(resolve => {
    const md = modal({ title, cls: 'small', body: `<div class="hint" style="font-size:14px;color:var(--text)">${esc(message)}</div>`, footer: `<button class="btn" data-no>Cancel</button><button class="btn primary" data-yes>${esc(ok)}</button>` });
    md.onClose = () => resolve(false);
    md.el.querySelector('[data-yes]').onclick = () => { md.onClose = null; md.close(); resolve(true); };
    md.el.querySelector('[data-no]').onclick = () => md.close();
    md.el.querySelector('[data-yes]').focus();
  });
}

function alertBox(title, message) {
  const md = modal({ title, cls: 'small', body: `<div class="hint" style="font-size:14px;color:var(--text);white-space:pre-line">${esc(message)}</div>`, footer: '<button class="btn primary" data-ok>OK</button>' });
  md.el.querySelector('[data-ok]').onclick = () => md.close();
}

function promptText(title, label, value = '') {
  return new Promise(resolve => {
    const md = modal({ title, cls: 'small', body: `<div class="form" style="grid-template-columns:1fr"><label>${esc(label)}</label><input class="input" id="pt" value="${esc(value)}"></div>`, footer: '<button class="btn" data-no>Cancel</button><button class="btn primary" data-yes>OK</button>' });
    const inp = md.el.querySelector('#pt');
    md.onClose = () => resolve(null);
    const ok = () => { md.onClose = null; md.close(); resolve(inp.value.trim() || null); };
    md.el.querySelector('[data-yes]').onclick = ok;
    md.el.querySelector('[data-no]').onclick = () => md.close();
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
    setTimeout(() => { inp.focus(); inp.select(); }, 20);
  });
}

// ---------------- edit panel (right side) ----------------
// Everything about one game in a panel next to the grid: info, where it is and how it starts, every picture and
// the theme song. Pictures and the song change right away; the text fields with Save.
let editing = null; // { id, refreshArt }
const editor = $('#editor');

function closeEditor() {
  editing = null;
  editor.classList.add('hidden');
  editor.innerHTML = '';
  renderSidePane();
}

function editGame(id) {
  const g = gameById(id);
  if (!g) return;
  ui.selected = id;
  markSelected();
  const md_ = g.meta || {};
  const l = g.launch || {};
  const hero = m(g, 'backgroundThumb') || m(g, 'heroThumb') || m(g, 'background') || m(g, 'hero');
  const logo = m(g, 'logo');
  editor.innerHTML = `
    <div class="ed-h"><h2>${esc(g.name)}</h2><button class="icon-btn" data-ed="close" title="Close (Esc)">${icon('x')}</button></div>
    <div class="ed-b">
      <div class="ed-hero" style="${hero ? `background-image:url('${hero}')` : ''}">${logo ? `<img src="${logo}">` : ''}</div>
      <div class="ed-stats"><div><b>${g.playtime >= 60 ? fmtPlaytime(g.playtime) : '0h'}</b><span>Play time</span></div>
        <div><b>${esc(timeAgo(g.lastPlayed))}</b><span>Last played</span></div><div><b>${g.playCount || 0}</b><span>Sessions</span></div></div>
      <div class="ed-actions">
        ${isRunning(g.id) ? `<button class="btn danger" data-ed="close-game">${icon('close')} Close game</button>` : `<button class="btn primary" data-ed="play">${icon('playFill')} Play</button>`}
        <button class="btn" data-ed="match">${icon('image')} Download metadata</button>
        <button class="btn ghost" data-ed="folder" title="Open the install folder">${icon('folder')}</button>
      </div>

      <div class="ed-sec">Game</div>
      <div class="form">
        <label>Name</label><input class="input" name="name" value="${esc(g.name)}">
        <label>Source</label><select name="source">${Object.entries(SOURCES).map(([k, v]) => `<option value="${k}" ${g.source === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <label>Developer</label><input class="input" name="developers" value="${esc((md_.developers || []).join(', '))}">
        <label>Publisher</label><input class="input" name="publishers" value="${esc((md_.publishers || []).join(', '))}">
        <label>Genres</label><input class="input" name="genres" value="${esc((md_.genres || []).join(', '))}" placeholder="Action, RPG">
        <label>Release date</label><input class="input" name="releaseDate" value="${esc(md_.releaseDate || '')}">
        <label>Completion</label><select name="completion">${COMPLETION.map(c => `<option ${completion(g) === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <label>User score</label><input class="input" name="userScore" type="number" min="0" max="100" value="${esc(g.userScore ?? '')}" placeholder="0–100">
        <label>Steam App ID</label><input class="input" name="steamAppId" value="${esc(md_.steamAppId || '')}" placeholder="Used to download artwork">
        <label style="align-self:start;margin-top:6px">Description</label><textarea name="description">${esc(md_.description || '')}</textarea>
        <label style="align-self:start;margin-top:6px">Notes</label><textarea name="notes" placeholder="Your own notes: tips, where you left off…">${esc(g.notes || '')}</textarea>
        <span></span><div class="checks"><label><input type="checkbox" name="favorite" ${g.favorite ? 'checked' : ''}> Favorite</label><label><input type="checkbox" name="hidden" ${g.hidden ? 'checked' : ''}> Hidden</label><label><input type="checkbox" name="installed" ${g.installed ? 'checked' : ''}> Installed</label></div>
      </div>

      <div class="ed-sec">Location &amp; launch</div>
      <div class="form">
        <label>Launch type</label><select name="ltype"><option value="exe" ${l.type !== 'url' ? 'selected' : ''}>Program (.exe / shortcut)</option><option value="url" ${l.type === 'url' ? 'selected' : ''}>URL (steam://, com.epicgames.launcher://…)</option></select>
        <label>Target</label><div class="with-btn"><input class="input" name="target" value="${esc(l.target || '')}"><button class="btn" data-browse="target">Browse…</button></div>
        <label>Arguments</label><input class="input" name="args" value="${esc(l.args || '')}">
        <label>Working folder</label><div class="with-btn"><input class="input" name="workingDir" value="${esc(l.workingDir || '')}"><button class="btn" data-browse-dir="workingDir">Browse…</button></div>
        <label>Install folder</label><div class="with-btn"><input class="input" name="installDir" value="${esc(g.installDir || '')}"><button class="btn" data-browse-dir="installDir">Browse…</button></div>
        <span></span><div class="hint">Play time is measured by watching for programs running from the install folder, so games started by Steam or Epic are tracked too.</div>
      </div>

      <div class="ed-sec">Artwork</div>
      <div class="hint" style="margin-bottom:10px">Cover is what this grid shows. Wallpaper is the full-screen art in Console Mode; the console tile uses Console Tile, otherwise the banner with the logo.</div>
      <div class="art-grid" id="art-grid"></div>

      <div class="ed-sec">Theme song</div>
      <div class="hint" style="margin-bottom:10px">Plays in Console Mode while you look at this game's details.</div>
      <div id="song-row" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"></div>

      <div class="ed-sec">More</div>
      <dl class="kv"><dt>Added</dt><dd>${esc(new Date(g.added).toLocaleDateString())}</dd><dt>Library ID</dt><dd>${esc(g.id)}</dd></dl>
      <div class="ed-actions"><button class="btn danger" data-ed="remove">${icon('trash')} Remove from library</button></div>
    </div>
    <div class="ed-f"><button class="btn left" data-ed="close">Cancel</button><button class="btn primary" data-ed="save">Save</button></div>`;
  editor.classList.remove('hidden');
  renderSidePane();
  const el = editor;
  const field = n => el.querySelector(`[name="${n}"]`);
  el.querySelector('[data-browse]').onclick = async () => {
    const f = await api.openFile({ title: 'Choose the game program', filters: [{ name: 'Programs', extensions: ['exe', 'lnk', 'bat', 'cmd'] }, { name: 'All files', extensions: ['*'] }] });
    if (f) {
      field('target').value = f;
      field('ltype').value = 'exe';
      const dir = f.replace(/[\\/][^\\/]+$/, '');
      if (!field('workingDir').value) field('workingDir').value = dir;
      if (!field('installDir').value) field('installDir').value = dir;
    }
  };
  el.querySelectorAll('[data-browse-dir]').forEach(b => b.onclick = async () => {
    const f = await api.openFile({ title: 'Choose a folder', properties: ['openDirectory'] });
    if (f) field(b.dataset.browseDir).value = f;
  });
  const list = v => v.split(',').map(x => x.trim()).filter(Boolean);
  const save = async () => {
    const appId = parseInt(field('steamAppId').value, 10);
    await api.updateGame(id, {
      name: field('name').value.trim() || g.name,
      source: field('source').value,
      favorite: field('favorite').checked,
      hidden: field('hidden').checked,
      installed: field('installed').checked,
      installDir: field('installDir').value.trim(),
      completion: field('completion').value,
      userScore: field('userScore').value === '' ? null : Math.max(0, Math.min(100, Math.round(Number(field('userScore').value) || 0))),
      notes: field('notes').value.trim(),
      launch: { type: field('ltype').value, target: field('target').value.trim(), args: field('args').value.trim(), workingDir: field('workingDir').value.trim() },
      meta: {
        description: field('description').value.trim(),
        developers: list(field('developers').value),
        publishers: list(field('publishers').value),
        genres: list(field('genres').value),
        releaseDate: field('releaseDate').value.trim(),
        steamAppId: Number.isFinite(appId) ? appId : null,
      },
    });
    toast('Saved', field('name').value.trim() || g.name);
    closeEditor();
  };
  el.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => {
    const a = b.dataset.ed;
    const cur = gameById(id);
    if (a === 'close') closeEditor();
    else if (a === 'save') save();
    else if (!cur) closeEditor();
    else if (a === 'play') launch(cur);
    else if (a === 'close-game') closeGame(cur);
    else if (a === 'match') matchDialog(id);
    else if (a === 'folder') api.openGameFolder(id);
    else if (a === 'remove') removeGame(cur);
  });
  const refreshArt = () => {
    const cur = gameById(id);
    if (!cur) { closeEditor(); return; }
    setHtml(el.querySelector('#art-grid'), 'art-' + id, Object.entries(KINDS).map(([k, info]) => {
      const url = m(cur, k + 'Thumb') || m(cur, k);
      return `<div class="art-slot"><h4>${info.label} <small>${info.hint}</small></h4>
        <div class="art-prev ${k}">${url ? `<img src="${url}" decoding="async">` : '<span class="none">None</span>'}</div>
        <div class="art-btns"><button class="btn" data-file="${k}" title="From a file">File…</button><button class="btn" data-web="${k}" title="Search online">Search…</button>${url ? `<button class="btn" data-adjust="${k}" title="Adjust size & position">${icon('crop')}</button><button class="btn" data-clear="${k}" title="Remove">${icon('trash')}</button>` : ''}</div></div>`;
    }).join(''));
    const song = cur.media.music ? `${S.mediaDir}/${cur.id}/${cur.media.music}` : null;
    setHtml(el.querySelector('#song-row'), 'song-' + id, `${song ? `<audio controls preload="none" src="${fileUrl(song)}" style="height:34px;width:100%"></audio>` : '<span class="hint" style="width:100%">No theme song yet.</span>'}
      ${S.ytdlp ? `<button class="btn" data-song="search">${icon('search')} Search YouTube…</button><button class="btn" data-song="link">${icon('link')} Paste link…</button><button class="btn" data-song="find" title="Take the best match automatically">${icon('refresh')} Auto</button>` : ''}
      <button class="btn" data-song="file">${icon('music')} Choose file…</button>
      ${song ? `<button class="btn" data-song="clear" title="Remove">${icon('trash')}</button>` : ''}`);
  };
  el.querySelector('#song-row').addEventListener('click', async e => {
    const b = e.target.closest('[data-song]');
    if (!b) return;
    if (b.dataset.song === 'file') {
      const f = await api.openFile({ title: 'Choose a theme song', filters: [{ name: 'Audio', extensions: ['mp3', 'ogg', 'm4a', 'wav', 'flac', 'opus', 'aac', 'webm'] }] });
      if (f) api.setMusic(id, f);
    } else if (b.dataset.song === 'clear') api.setMusic(id, null);
    else if (b.dataset.song === 'search') songDialog(id);
    else if (b.dataset.song === 'link') {
      let clip = '';
      try { clip = (await api.clipboardText() || '').trim(); } catch {}
      const url = await promptText('Theme song from a link', 'YouTube link (the audio of the video is used)', /^https?:\/\/\S+$/i.test(clip) ? clip : '');
      if (url) useSongLink(id, url);
    } else if (b.dataset.song === 'find') {
      b.disabled = true;
      toast('Finding theme song…', g.name, { id: 'song', duration: 0 });
      const r = await api.findThemeSong(id, true);
      toast(r.ok ? 'Theme song ready' : 'No theme song found', r.ok ? g.name : r.error, { id: 'song' });
    }
  });
  el.querySelector('#art-grid').addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.file) {
      const f = await api.openFile({ title: `Choose ${KINDS[b.dataset.file].label.toLowerCase()} image`, filters: IMG_FILTERS });
      if (f) api.setImage(id, b.dataset.file, { file: f });
    } else if (b.dataset.web) imagePicker(id, b.dataset.web);
    else if (b.dataset.clear) api.setImage(id, b.dataset.clear, null);
    else if (b.dataset.adjust) adjustDialog(id, b.dataset.adjust);
  });
  for (const k of Object.keys(lastHtml)) if (/^(art|song)-/.test(k)) delete lastHtml[k];
  editing = { id, refreshArt };
  refreshArt();
  field('name').focus();
}

// ---------------- metadata match ----------------
function matchDialog(id) {
  const g = gameById(id);
  if (!g) return;
  const md = modal({
    title: 'Download metadata', cls: 'wide',
    body: `<div class="pick-top"><input class="input" id="q" value="${esc(g.name)}"><button class="btn primary" id="go">${icon('search')} Search</button></div>
      <div class="hint" style="margin-bottom:12px">Choose the matching game on the Steam store. PC4 downloads its cover, background, logo, icon and description.</div>
      <div class="results wide" id="res"></div>`,
  });
  const q = md.el.querySelector('#q');
  const res = md.el.querySelector('#res');
  const search = async () => {
    res.innerHTML = '<div class="status" style="grid-column:1/-1">Searching…</div>';
    try {
      const r = await api.searchSteam(q.value);
      res.innerHTML = r.length ? r.map(x => `<div class="res match" data-app="${x.appId}"><img src="${esc(x.thumb)}"><div class="t">${esc(x.name)}<small>Steam App ${x.appId}</small></div></div>`).join('')
        : '<div class="status" style="grid-column:1/-1">No results. Try a shorter name.</div>';
    } catch (e) {
      res.innerHTML = `<div class="status" style="grid-column:1/-1">Search failed: ${esc(e.message)}</div>`;
    }
  };
  md.el.querySelector('#go').onclick = search;
  q.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
  res.addEventListener('click', async e => {
    const r = e.target.closest('[data-app]');
    if (!r) return;
    md.close();
    toast('Downloading metadata…', g.name, { id: 'meta-' + id, duration: 0 });
    try {
      await api.fetchMetadata(id, { appId: Number(r.dataset.app), force: true });
      toast('Metadata updated', g.name, { id: 'meta-' + id });
    } catch (err) {
      toast('Download failed', err.message, { id: 'meta-' + id });
    }
  });
  search();
}

// ---------------- theme song search (YouTube through yt-dlp) ----------------
async function useSongLink(id, url, title) {
  const g = gameById(id);
  toast('Downloading theme song…', title || (g && g.name) || '', { id: 'song', duration: 0 });
  const r = await api.setThemeSongUrl(id, url);
  toast(r.ok ? 'Theme song ready' : 'Could not use that song', r.ok ? (g && g.name) || '' : r.error, { id: 'song' });
}

function songDialog(id) {
  const g = gameById(id);
  if (!g) return;
  let preview = null;
  const fmtLen = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const md = modal({
    title: 'Find theme song', cls: 'wide',
    body: `<div class="pick-top"><input class="input" id="q" value="${esc(g.name + ' main theme')}"><button class="btn primary" id="go">${icon('search')} Search</button></div>
      <div class="hint" style="margin-bottom:12px">Results from YouTube. Play one to hear it, then choose Use.</div>
      <div class="song-results" id="res"></div>`,
  });
  const q = md.el.querySelector('#q');
  const res = md.el.querySelector('#res');
  const stop = () => { if (preview) { preview.audio.pause(); preview.btn.innerHTML = `${icon('play')}`; preview = null; } };
  md.onClose = stop;
  let list = [];
  const search = async () => {
    stop();
    res.innerHTML = '<div class="status">Searching…</div>';
    const r = await api.searchSongs(q.value);
    list = r.ok ? r.results : [];
    res.innerHTML = !r.ok ? `<div class="status">Search failed: ${esc(r.error)}</div>`
      : !list.length ? '<div class="status">No results. Try different words.</div>'
      : list.map((x, i) => `<div class="song-res"><div class="yt-thumb"><img src="${esc(x.thumb)}" loading="lazy"><b>${fmtLen(x.duration)}</b></div>
          <div class="t">${esc(x.title)}<small>${esc(x.channel)}</small></div>
          <button class="btn" data-play="${i}" title="Preview">${icon('play')}</button><button class="btn primary" data-use="${i}">Use</button></div>`).join('');
  };
  md.el.querySelector('#go').onclick = search;
  q.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
  res.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.use) { const x = list[+b.dataset.use]; stop(); md.close(); useSongLink(id, x.url, x.title); return; }
    const x = list[+b.dataset.play];
    const same = preview && preview.id === x.id;
    stop();
    if (same) return;
    b.innerHTML = '…';
    const url = await api.songStream(x.url);
    if (!url) { b.innerHTML = icon('play'); toast('Preview not available', x.title); return; }
    const audio = new Audio(url);
    audio.volume = S.settings.muteAll ? 0 : (S.settings.masterVolume ?? 1) * (S.settings.gameMusicVolume ?? 0.4);
    audio.play().catch(() => {});
    preview = { audio, btn: b, id: x.id };
    b.innerHTML = icon('x');
  });
  search();
}

// ---------------- image picker ----------------
function imagePicker(id, kind) {
  const g = gameById(id);
  let source = 'official';
  const md = modal({
    title: `Choose ${KINDS[kind].label.toLowerCase()} · ${g.name}`, cls: 'wide',
    body: `<div class="pick-top"><div class="seg"><button data-src="official" class="on">Official art</button><button data-src="steam">Steam search</button><button data-src="web">Internet</button><button data-src="sgdb">SteamGridDB</button></div>
      <input class="input" id="q" value="${esc(g.name)}"><button class="btn primary" id="go">${icon('search')} Search</button></div>
      <div id="res"></div>`,
  });
  const q = md.el.querySelector('#q');
  const res = md.el.querySelector('#res');
  const pick = async url => {
    md.close();
    toast('Downloading image…', '', { id: 'img', duration: 0 });
    try { await api.setImage(id, kind, { url, referer: referers.get(url) }); toast('Image updated', KINDS[kind].label, { id: 'img' }); }
    catch (e) { toast('Download failed', e.message, { id: 'img' }); }
  };
  const imgGrid = items => `<div class="results ${kind === 'hero' || kind === 'logo' || kind === 'background' ? 'wide' : ''}">${items.map(i => `<div class="res" data-url="${esc(i.url)}"><div class="im ${kind}"><img src="${esc(i.thumb || i.url)}" data-gone=".res"></div>${i.title ? `<div class="t">${esc(i.title)}${i.sub ? `<small>${esc(i.sub)}</small>` : ''}</div>` : ''}</div>`).join('')}</div>`;
  // pictures from the internet (DuckDuckGo): the "Internet" source, and "More from the internet" after Steam results
  const referers = new Map();
  let webNext;
  let webItems = [];
  let shown = [];
  const moreBtn = label => `<div style="text-align:center;margin-top:16px"><button class="btn" id="web-more">${label}</button></div>`;
  const web = async (append = false) => {
    if (!append) { webNext = undefined; webItems = []; res.innerHTML = '<div class="status">Searching the internet…</div>'; }
    const r = await api.webImages(q.value, kind, webNext || null);
    webNext = r.next;
    r.items.forEach(x => referers.set(x.url, x.referer));
    webItems = webItems.concat(r.items.map(x => ({ url: x.url, thumb: x.thumb, sub: `${x.width}×${x.height}` })));
    const all = source === 'web' ? webItems : shown.concat(webItems);
    res.innerHTML = all.length ? imgGrid(all) + (webNext ? moreBtn('Load more') : '') : '<div class="status">No pictures found.</div>';
  };
  const steam = async () => {
    if (kind === 'icon') { res.innerHTML = '<div class="status">Steam search doesn\'t include icons. Use “Download metadata”, SteamGridDB, or a file.</div>'; return; }
    res.innerHTML = '<div class="status">Searching Steam…</div>';
    const r = await api.searchSteam(q.value);
    const field = kind === 'tile' ? 'hero' : kind; // Steam has no square tiles; background = 2x key art
    shown = r.map(x => ({ url: x[field], title: x.name, sub: `App ${x.appId}` }));
    webNext = undefined; webItems = [];
    res.innerHTML = (shown.length ? imgGrid(shown) : '<div class="status">No results on Steam.</div>') + moreBtn('More from the internet');
  };
  const sgdb = async () => {
    if (!S.settings.sgdbKey) {
      res.innerHTML = `<div class="status">SteamGridDB needs a free API key.<br>Get one at <a class="hint" style="color:var(--accent2);cursor:pointer" id="sgdb-link">steamgriddb.com/profile/preferences/api</a> and paste it in Settings.</div>`;
      md.el.querySelector('#sgdb-link').onclick = () => api.openExternal('https://www.steamgriddb.com/profile/preferences/api');
      return;
    }
    res.innerHTML = '<div class="status">Searching SteamGridDB…</div>';
    const games = await api.searchSgdb(q.value);
    if (!games.length) { res.innerHTML = '<div class="status">No results.</div>'; return; }
    res.innerHTML = `<div class="results wide">${games.slice(0, 12).map(x => `<div class="res match" data-sg="${x.id}"><div class="t">${esc(x.name)}<small>${x.year || ''}</small></div></div>`).join('')}</div>`;
  };
  // SteamGridDB images come in pages; "Load more" appends the next one
  let sgGame = null;
  let sgPage = 0;
  let sgItems = [];
  const sgdbImages = async (gid, next = false) => {
    if (!next) { sgGame = gid; sgPage = 0; sgItems = []; res.innerHTML = '<div class="status">Loading images…</div>'; }
    else sgPage++;
    const imgs = await api.sgdbImages(sgGame, kind, sgPage);
    sgItems = sgItems.concat(imgs.map(i => ({ url: i.url, thumb: i.thumb, sub: `${i.width}×${i.height}` })));
    const more = imgs.length >= 20;
    res.innerHTML = sgItems.length
      ? imgGrid(sgItems) + (more ? '<div style="text-align:center;margin-top:16px"><button class="btn" id="sg-more">Load more</button></div>' : '')
      : '<div class="status">No images of this kind for that game.</div>';
  };
  // every official Steam image of the linked game that suits this kind (key art, backgrounds, screenshots…)
  const official = async () => {
    let appId = g.meta && g.meta.steamAppId;
    if (!appId) {
      const r = await api.searchSteam(q.value);
      appId = r[0] && r[0].appId;
    }
    if (!appId) { res.innerHTML = '<div class="status">Link this game to Steam first (Download metadata), or try SteamGridDB.</div>'; return; }
    res.innerHTML = '<div class="status">Loading official art…</div>';
    const list = (await api.steamArtwork(appId)).filter(x => x.kinds.includes(kind));
    shown = list.map(x => ({ url: x.url, thumb: x.thumb, title: x.title }));
    webNext = undefined; webItems = [];
    res.innerHTML = (shown.length ? imgGrid(shown) : '<div class="status">Steam has no official art of this kind.</div>') + moreBtn('More from the internet');
  };
  const search = () => (source === 'steam' ? steam() : source === 'official' ? official() : source === 'web' ? web() : sgdb()).catch(e => { res.innerHTML = `<div class="status">Search failed: ${esc(e.message)}</div>`; });
  md.el.querySelectorAll('[data-src]').forEach(b => b.onclick = () => {
    source = b.dataset.src;
    md.el.querySelectorAll('[data-src]').forEach(x => x.classList.toggle('on', x === b));
    search();
  });
  md.el.querySelector('#go').onclick = search;
  q.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
  res.addEventListener('click', e => {
    if (e.target.closest('#web-more')) { e.target.closest('#web-more').textContent = 'Loading…'; web(true).catch(err => toast('Could not load more', err.message)); return; }
    if (e.target.closest('#sg-more')) { e.target.closest('#sg-more').textContent = 'Loading…'; sgdbImages(null, true).catch(err => toast('Could not load more', err.message)); return; }
    const sg = e.target.closest('[data-sg]');
    if (sg) { sgdbImages(sg.dataset.sg).catch(err => { res.innerHTML = `<div class="status">${esc(err.message)}</div>`; }); return; }
    const r = e.target.closest('[data-url]');
    if (r) pick(r.dataset.url);
  });
  search();
}

// ---------------- adjust size & position ----------------
const FRAMES = { cover: 2 / 3, tile: 1, hero: 31 / 10, background: 16 / 9, logo: 16 / 7, icon: 1 };

function adjustDialog(id, kind) {
  const g = gameById(id);
  const start = (g.artAdjust || {})[kind] || {};
  const a = { z: start.z || 1, x: start.x || 0, y: start.y || 0, fit: start.fit || 'cover' };
  const wide = FRAMES[kind] > 1.2;
  const md = modal({
    title: `Adjust ${KINDS[kind].label.toLowerCase()} · ${g.name}`, cls: 'wide',
    body: `<div style="display:flex;gap:24px;align-items:center">
      <div class="adj-frame" style="position:relative;overflow:hidden;flex:none;${wide ? 'width:560px' : 'height:420px'};aspect-ratio:${FRAMES[kind]};outline:2px solid #fff;background:repeating-conic-gradient(#171a21 0 25%, #121419 0 50%) 0 0 / 16px 16px;cursor:grab">
        <img src="${m(g, kind)}" draggable="false" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></div>
      <div class="form" style="flex:1;grid-template-columns:90px 1fr">
        <label>Zoom</label><input type="range" name="z" min="0.3" max="4" step="0.01" style="width:100%">
        <label>Left/right</label><input type="range" name="x" min="-100" max="100" step="0.5" style="width:100%">
        <label>Up/down</label><input type="range" name="y" min="-100" max="100" step="0.5" style="width:100%">
        <label>Mode</label><select name="fit"><option value="cover">Fill the frame</option><option value="contain">Fit whole picture</option></select>
        <span></span><div class="hint">Drag the picture to move it; scroll to zoom.</div>
      </div></div>`,
    footer: '<button class="btn left" data-reset>Reset</button><button class="btn" data-no>Cancel</button><button class="btn primary" data-yes>Save</button>',
  });
  const el = md.el;
  const img = el.querySelector('.adj-frame img');
  const f = n => el.querySelector(`[name="${n}"]`);
  const show = () => {
    img.style.cssText = `position:absolute;inset:0;width:100%;height:100%;${adjustStyle(a)}`;
    f('z').value = a.z; f('x').value = a.x; f('y').value = a.y; f('fit').value = a.fit;
  };
  ['z', 'x', 'y'].forEach(k => f(k).addEventListener('input', () => { a[k] = Number(f(k).value); show(); }));
  f('fit').addEventListener('change', () => { a.fit = f('fit').value; show(); });
  const frame = el.querySelector('.adj-frame');
  let drag = null;
  frame.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, ax: a.x, ay: a.y }; });
  el.addEventListener('mousemove', e => {
    if (!drag) return;
    const r = frame.getBoundingClientRect();
    a.x = Math.max(-100, Math.min(100, drag.ax + ((e.clientX - drag.x) / r.width) * 100));
    a.y = Math.max(-100, Math.min(100, drag.ay + ((e.clientY - drag.y) / r.height) * 100));
    show();
  });
  el.addEventListener('mouseup', () => { drag = null; });
  frame.addEventListener('wheel', e => { e.preventDefault(); a.z = Math.max(0.3, Math.min(4, a.z + (e.deltaY < 0 ? 0.05 : -0.05))); show(); }, { passive: false });
  el.querySelector('[data-reset]').onclick = () => { Object.assign(a, { z: 1, x: 0, y: 0, fit: 'cover' }); show(); };
  el.querySelector('[data-no]').onclick = () => md.close();
  el.querySelector('[data-yes]').onclick = async () => {
    const isDefault = a.z === 1 && !a.x && !a.y && a.fit === 'cover';
    await api.updateGame(id, { artAdjust: { [kind]: isDefault ? null : { ...a } } });
    md.close();
    toast('Artwork adjusted', g.name);
  };
  show();
}

// ---------------- settings ----------------
function settingsDialog() {
  const s = S.settings;
  const av = avatarUrl(S);
  const md = modal({
    title: 'Settings',
    body: `<div class="form">
      <label>Profile name</label><input class="input" name="profileName" value="${esc(s.profileName)}">
      <label>Avatar</label><div class="with-btn" style="align-items:center">${av ? `<img src="${av}" style="width:36px;height:36px;object-fit:cover;border-radius:4px">` : ''}<button class="btn" id="avatar">Choose image…</button>${s.avatar ? '<button class="btn ghost" id="avatar-clear">Remove</button>' : ''}</div>
      <label>Start PC4 in</label><select name="startupMode"><option value="desktop" ${s.startupMode === 'desktop' ? 'selected' : ''}>Desktop mode</option><option value="fullscreen" ${s.startupMode === 'fullscreen' ? 'selected' : ''}>Console mode (fullscreen)</option></select>
      <label>While playing</label><div class="checks"><label><input type="checkbox" name="minimizeOnLaunch" ${s.minimizeOnLaunch ? 'checked' : ''}> Minimize PC4</label></div>
      <label>PS button</label><div class="checks"><label><input type="checkbox" name="psWake" ${s.psWake ? 'checked' : ''}> Press PS to start PC4 in Console Mode</label></div>
      <span></span><div class="hint">Works while PC4 is closed or in Desktop Mode, like turning on a PS4. A small helper starts when you sign in to Windows.</div>
      <div class="full side-h" style="padding-left:0">Console mode</div>
      <label>Console style</label><select name="uiStyle"><option value="ps4" ${s.uiStyle !== 'ps5' ? 'selected' : ''}>PS4</option><option value="ps5" ${s.uiStyle === 'ps5' ? 'selected' : ''}>PS5</option></select>
      <label>Theme</label><select name="theme">${Object.entries(THEME_NAMES).map(([k, v]) => `<option value="${k}" ${s.theme === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <label>Intro music</label><div class="with-btn"><input class="input" name="introMusic" value="${esc(s.introMusic || '')}" placeholder="${S.defaultIntro ? 'Built-in: assets/music/intro' : 'Plays on the startup screen'}" readonly><button class="btn" id="intro">Browse…</button><button class="btn ghost" id="intro-clear">Clear</button></div>
      <label>Home music</label><div class="with-btn"><input class="input" name="music" value="${esc(s.music || '')}" placeholder="${S.defaultMusic ? 'Built-in: assets/music/theme' : 'No music selected'}" readonly><button class="btn" id="music">Browse…</button><button class="btn ghost" id="music-clear">Clear</button></div>
      <label>Music volume</label><div class="with-btn" style="align-items:center"><input type="range" name="musicVolume" min="0" max="1" step="0.05" value="${s.musicVolume}" style="width:200px"><label style="color:var(--text);display:flex;gap:7px;align-items:center"><input type="checkbox" name="musicEnabled" ${s.musicEnabled ? 'checked' : ''}> Play music</label></div>
      <label>Master volume</label><div class="with-btn" style="align-items:center"><input type="range" name="masterVolume" min="0" max="1" step="0.05" value="${s.masterVolume ?? 1}" style="width:200px"><label style="color:var(--text);display:flex;gap:7px;align-items:center"><input type="checkbox" name="muteAll" ${s.muteAll ? 'checked' : ''}> Mute all</label></div>
      <label>Theme songs</label><div class="with-btn" style="align-items:center"><input type="range" name="gameMusicVolume" min="0" max="1" step="0.05" value="${s.gameMusicVolume ?? 0.4}" style="width:200px"><label style="color:var(--text);display:flex;gap:7px;align-items:center"><input type="checkbox" name="gameMusic" ${s.gameMusic !== false ? 'checked' : ''}> Play in game details</label></div>
      <label>Effects volume</label><input type="range" name="uiVolume" min="0" max="1" step="0.05" value="${s.uiVolume ?? 0.6}" style="width:200px">
      <label>Sounds</label><div class="checks"><label><input type="checkbox" name="uiSounds" ${s.uiSounds ? 'checked' : ''}> Navigation sounds</label><label><input type="checkbox" name="bootAnimation" ${s.bootAnimation ? 'checked' : ''}> Startup animation</label></div>
      <div class="full side-h" style="padding-left:0">Controller</div>
      <label>Light bar</label><div class="with-btn" style="align-items:center"><select name="lightBar">${Object.entries(LIGHT_COLORS).map(([k, c]) => `<option value="${k}" ${s.lightBar === k ? 'selected' : ''}>${c.label}</option>`).join('')}<option value="custom" ${/^#/.test(s.lightBar || '') ? 'selected' : ''}>Custom</option></select>
        <input type="color" name="lightHex" value="#${colorOf(s).map(v => v.toString(16).padStart(2, '0')).join('')}" style="width:44px;height:30px;padding:0;border:none;background:none">
        <select name="lightBarBrightness">${[['bright', 'Bright'], ['medium', 'Medium'], ['dim', 'Dim'], ['off', 'Off']].map(([k, l]) => `<option value="${k}" ${s.lightBarBrightness === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="full side-h" style="padding-left:0">Artwork</div>
      <label>SteamGridDB key</label><input class="input" type="password" name="sgdbKey" value="${esc(s.sgdbKey || '')}" placeholder="Optional">
      <span></span><div class="hint">SteamGridDB has community covers, square tiles, logos and icons. Get a free key at <a id="sgdb-link">steamgriddb.com</a>.</div>
    </div>`,
    footer: '<button class="btn" data-no>Cancel</button><button class="btn primary" data-save>Save</button>',
  });
  const el = md.el;
  const f = n => el.querySelector(`[name="${n}"]`);
  el.querySelector('#sgdb-link').onclick = () => api.openExternal('https://www.steamgriddb.com/profile/preferences/api');
  el.querySelector('#avatar').onclick = async () => { const p = await api.openFile({ title: 'Choose an avatar', filters: IMG_FILTERS }); if (p) { await api.setAvatar(p); md.close(); settingsDialog(); } };
  const clr = el.querySelector('#avatar-clear');
  if (clr) clr.onclick = async () => { await api.updateSettings({ avatar: null }); md.close(); settingsDialog(); };
  el.querySelector('#music').onclick = async () => {
    const p = await api.openFile({ title: 'Choose theme music', filters: [{ name: 'Audio', extensions: ['mp3', 'ogg', 'wav', 'm4a', 'flac', 'aac', 'opus', 'webm'] }] });
    if (p) f('music').value = p;
  };
  el.querySelector('#music-clear').onclick = () => { f('music').value = ''; };
  f('lightHex').addEventListener('input', () => { f('lightBar').value = 'custom'; });
  f('lightBar').addEventListener('change', () => {
    const c = LIGHT_COLORS[f('lightBar').value];
    if (c) f('lightHex').value = '#' + c.rgb.map(v => v.toString(16).padStart(2, '0')).join('');
  });
  el.querySelector('#intro').onclick = async () => {
    const p = await api.openFile({ title: 'Choose intro music', filters: [{ name: 'Audio', extensions: ['mp3', 'ogg', 'wav', 'm4a', 'flac', 'aac', 'opus', 'webm'] }] });
    if (p) f('introMusic').value = p;
  };
  el.querySelector('#intro-clear').onclick = () => { f('introMusic').value = ''; };
  el.querySelector('[data-no]').onclick = () => md.close();
  el.querySelector('[data-save]').onclick = async () => {
    await api.updateSettings({
      profileName: f('profileName').value.trim() || 'Player 1',
      startupMode: f('startupMode').value,
      minimizeOnLaunch: f('minimizeOnLaunch').checked,
      psWake: f('psWake').checked,
      theme: f('theme').value,
      uiStyle: f('uiStyle').value,
      music: f('music').value || null,
      introMusic: f('introMusic').value || null,
      musicVolume: Number(f('musicVolume').value),
      musicEnabled: f('musicEnabled').checked,
      uiSounds: f('uiSounds').checked,
      bootAnimation: f('bootAnimation').checked,
      sgdbKey: f('sgdbKey').value.trim(),
      masterVolume: Number(f('masterVolume').value),
      muteAll: f('muteAll').checked,
      gameMusicVolume: Number(f('gameMusicVolume').value),
      gameMusic: f('gameMusic').checked,
      uiVolume: Number(f('uiVolume').value),
      lightBar: f('lightBar').value === 'custom' ? f('lightHex').value : f('lightBar').value,
      lightBarBrightness: f('lightBarBrightness').value,
    });
    md.close();
    toast('Settings saved');
  };
}


// ---------------- updates (GitHub Releases, src/main/updater.js) ----------------
async function checkUpdates() {
  if (!S.update || S.update.status === 'dev') { alertBox('Updates', 'Only the installed PC4 updates itself.'); return; }
  toast('Checking for updates…');
  const r = await api.checkUpdate();
  if (r && r.status === 'latest') toast('PC4 is up to date', `Version ${await api.version()}`);
  else if (r && r.status === 'error') toast("Couldn't check for updates", r.error || '');
  else if (r) toast(`Version ${r.version} found`, 'Downloading in the background');
}
api.on('update', async v => {
  notify(`PC4 ${v} is ready`, 'It installs when you close PC4, or choose Restart to Update in the main menu');
  if (await confirmBox('Update ready', `PC4 ${v} has been downloaded. Restart now to install it? (Otherwise it installs when you close PC4.)`, 'Restart now')) api.installUpdate();
});

// ---------------- Playnite's menus: main menu, game menu, group / sort / presets ----------------
function mainMenu(x, y) {
  showMenu(x, y, [
    { label: 'Add Game', icon: 'plus', sub: [
      { label: 'Manually…', icon: 'exe', run: addExe },
      { label: 'Scan all launchers', icon: 'refresh', run: () => runImport() },
    ] },
    { label: 'Update Game Library', icon: 'refresh', key: 'F5', sub: [
      { label: 'All launchers', icon: 'refresh', run: () => runImport() },
      { label: 'Steam', icon: 'steam', run: () => runImport(['steam']) },
      { label: 'Epic Games', icon: 'epic', run: () => runImport(['epic']) },
      { label: 'GOG Galaxy', icon: 'gog', run: () => runImport(['gog']) },
    ] },
    { label: 'Download Missing Metadata', icon: 'image', run: () => { api.refreshAllMetadata(); notify('Downloading missing metadata', 'Artwork and descriptions for games that have none'); } },
    S.ytdlp && { label: 'Find Theme Songs for All Games', icon: 'music', run: () => { api.findAllThemeSongs(); toast('Finding theme songs', 'This runs in the background'); } },
    { label: 'New Category…', icon: 'folder', run: async () => { const n = await promptText('New category', 'Category name', `Category ${S.folders.length + 1}`); if (n) api.addFolder(n, []); } },
    S.folders.length && { label: 'Categories', icon: 'folder', sub: S.folders.map(f => ({ label: f.name, icon: 'folder', sub: [
      { label: 'Show its games', icon: 'funnel', run: () => setOnlyFilter('category', f.name) },
      { label: 'Rename…', icon: 'edit', run: async () => { const n = await promptText('Rename category', 'Category name', f.name); if (n) api.updateFolder(f.id, { name: n }); } },
      { label: 'Delete', icon: 'trash', danger: true, run: async () => { if (await confirmBox('Delete category', `Delete "${f.name}"? The games stay in your library.`, 'Delete')) api.removeFolder(f.id); } },
    ] })) },
    '-',
    { label: 'Random Game', icon: 'shuffle', key: 'Ctrl+R', run: randomGame },
    { label: 'Statistics', icon: 'chartBar', run: () => setSection('stats') },
    { label: 'Controller Test', icon: 'gameController', run: () => setSection('pad') },
    { label: "Post to What's New…", icon: 'edit', run: postDialog },
    '-',
    { label: 'Settings…', icon: 'gear', key: 'F4', run: settingsDialog },
    { label: 'Switch to Console Mode', icon: 'monitorPlay', key: 'F11', run: () => api.setMode('fullscreen') },
    S.update && S.update.status === 'ready'
      ? { label: `Restart to Update (${S.update.version})`, icon: 'download', run: () => api.installUpdate() }
      : { label: 'Check for Updates', icon: 'download', run: checkUpdates },
    { label: 'About PC4', icon: 'info', run: async () => alertBox('PC4', `Version ${await api.version()}\nA game library for Windows in the spirit of Playnite, with a PS4 / PS5-style console mode.`) },
    '-',
    { label: 'Exit', icon: 'exit', run: () => api.window('quit') },
  ].filter(Boolean));
}

function gameMenu(g, x, y) {
  const run = isRunning(g.id);
  const appId = g.meta && g.meta.steamAppId;
  showMenu(x, y, [
    run ? { label: 'Close Game', icon: 'close', run: () => closeGame(g) } : { label: g.installed ? 'Play' : 'Install', icon: g.installed ? 'play' : 'download', key: 'Enter', run: () => launch(g) },
    ui.view === 'grid' && { label: 'Show Details', icon: 'sidebarSimple', run: () => { ui.gridDetails = true; savePrefs(); selectGame(g.id); renderSidePane(); } },
    '-',
    { label: 'Edit…', icon: 'edit', key: 'F3', run: () => editGame(g.id) },
    { label: 'Download Metadata…', icon: 'image', run: () => matchDialog(g.id) },
    '-',
    { label: 'Set Completion Status', icon: 'checkCircle', sub: COMPLETION.map(c => ({ label: c, check: completion(g) === c, run: () => api.updateGame(g.id, { completion: c }) })) },
    { label: g.favorite ? 'Remove from Favorites' : 'Add to Favorites', icon: 'star', run: () => api.updateGame(g.id, { favorite: !g.favorite }) },
    { label: g.hidden ? 'Unhide' : 'Hide', icon: 'eye', run: () => api.updateGame(g.id, { hidden: !g.hidden }) },
    { label: 'Categories', icon: 'folder', sub: [
      ...S.folders.map(f => ({ label: f.name, check: f.gameIds.includes(g.id),
        run: () => api.updateFolder(f.id, { gameIds: f.gameIds.includes(g.id) ? f.gameIds.filter(x => x !== g.id) : [...f.gameIds, g.id] }) })),
      S.folders.length ? '-' : null,
      { label: 'New Category…', icon: 'plus', run: async () => { const n = await promptText('New category', 'Category name', `Category ${S.folders.length + 1}`); if (n) api.addFolder(n, [g.id]); } },
    ].filter(Boolean) },
    '-',
    { label: 'Open Install Folder', icon: 'folder', disabled: !(g.installDir || g.launch.type === 'exe'), run: () => api.openGameFolder(g.id) },
    appId && { label: 'Open Store Page', icon: 'arrowSquareOut', run: () => api.openExternal(`https://store.steampowered.com/app/${appId}`) },
    { label: 'Search PCGamingWiki', icon: 'globe', run: () => api.openExternal(`https://www.pcgamingwiki.com/w/index.php?search=${encodeURIComponent(g.name)}`) },
    '-',
    { label: 'Remove from Library', icon: 'trash', key: 'Del', danger: true, run: () => removeGame(g) },
  ].filter(Boolean));
}

function groupMenu(x, y) {
  showMenu(x, y, [
    { label: "Don't Group", check: ui.group === 'none', run: () => setGroup('none') },
    '-',
    ...Object.entries(FIELDS).map(([k, f]) => ({ label: f.label, check: ui.group === k, run: () => setGroup(k) })),
    '-',
    { label: 'Expand All Groups', icon: 'caretDown', disabled: ui.group === 'none', run: () => { ui.collapsed.clear(); savePrefs(); renderMain(); } },
    { label: 'Collapse All Groups', icon: 'caretRight', disabled: ui.group === 'none', run: () => { for (const gr of groupsOf(visible())) ui.collapsed.add(ui.group + ':' + gr.key); savePrefs(); renderMain(); } },
  ]);
}
function setGroup(k) { ui.group = k; savePrefs(); render(); }

function sortMenu(x, y) {
  showMenu(x, y, [
    ...Object.entries(SORT_BY).map(([k, s]) => ({ label: s.label, check: ui.sort === k, run: () => { ui.sort = k; ui.sortDir = s.desc ? 'desc' : 'asc'; savePrefs(); render(); } })),
    '-',
    { label: 'Ascending', check: ui.sortDir === 'asc', run: () => { ui.sortDir = 'asc'; savePrefs(); render(); } },
    { label: 'Descending', check: ui.sortDir === 'desc', run: () => { ui.sortDir = 'desc'; savePrefs(); render(); } },
  ]);
}

// filter presets: Playnite's built-in ones, then the user's own (filters + sort + grouping)
const BUILTIN_PRESETS = [
  { id: 'all', name: 'All Games', filters: {}, sort: 'name', sortDir: 'asc', group: 'none' },
  { id: 'recent', name: 'Recently Played', filters: {}, sort: 'lastPlayed', sortDir: 'desc', group: 'none' },
  { id: 'fav', name: 'Favorites', filters: { favorite: true }, sort: 'name', sortDir: 'asc', group: 'none' },
  { id: 'most', name: 'Most Played', filters: {}, sort: 'playtime', sortDir: 'desc', group: 'none' },
  { id: 'installed', name: 'Installed', filters: { installed: true }, sort: 'name', sortDir: 'asc', group: 'none' },
  { id: 'backlog', name: 'Backlog', filters: { completion: ['Not Played', 'Plan to Play', 'On Hold'] }, sort: 'added', sortDir: 'desc', group: 'none' },
];
function applyPreset(p) {
  ui.filters = normFilters(p.filters);
  ui.sort = SORT_BY[p.sort] ? p.sort : 'name';
  ui.sortDir = p.sortDir || 'asc';
  ui.group = FIELDS[p.group] ? p.group : 'none';
  ui.explore = null;
  ui.section = 'library';
  savePrefs();
  render();
}
function presetsMenu(x, y) {
  showMenu(x, y, [
    ...BUILTIN_PRESETS.map(p => ({ label: p.name, icon: 'bookmarkSimple', run: () => applyPreset(p) })),
    ui.presets.length ? '-' : null,
    ...ui.presets.map(p => ({ label: p.name, icon: 'tag', run: () => applyPreset(p) })),
    '-',
    { label: 'Save Current View as Preset…', icon: 'floppyDisk', run: savePreset },
    ui.presets.length ? { label: 'Delete a Preset', icon: 'trash', sub: ui.presets.map(p => ({ label: p.name, danger: true, run: () => { ui.presets = ui.presets.filter(x => x !== p); savePrefs(); toast('Preset deleted', p.name); } })) } : null,
  ].filter(Boolean));
}
async function savePreset() {
  const name = await promptText('Save filter preset', 'Preset name', `Preset ${ui.presets.length + 1}`);
  if (!name) return;
  ui.presets = [...ui.presets.filter(p => p.name !== name), { id: 'u' + Date.now(), name, filters: { ...ui.filters }, sort: ui.sort, sortDir: ui.sortDir, group: ui.group }];
  savePrefs();
  toast('Preset saved', name);
}
function setOnlyFilter(field, value) {
  ui.filters = normFilters({ [field]: [value] });
  ui.explore = null;
  ui.section = 'library';
  savePrefs();
  render();
  toast(`${FIELDS[field].label}: ${value}`, 'Clear the filter in the filter panel');
}

// ---------------- random game (Playnite's "Select random game") ----------------
function randomGame() {
  const pool = visible().filter(g => g.installed);
  const list = pool.length ? pool : visible();
  if (!list.length) { toast('No games to pick from'); return; }
  let g = list[Math.floor(Math.random() * list.length)];
  const md = modal({ title: 'Random Game', cls: 'small', body: '<div class="rnd"></div>',
    footer: '<button class="btn left" data-rnd="again">' + icon('shuffle') + ' Pick Another</button><button class="btn" data-rnd="go">Go to Game</button><button class="btn primary" data-rnd="play">' + icon('playFill') + ' Play</button>' });
  const show = () => {
    const cover = m(g, 'coverThumb') || m(g, 'cover');
    md.el.querySelector('.rnd').innerHTML = `<div class="rnd-cv">${cover ? `<img src="${cover}">` : `<span>${esc(g.name)}</span>`}</div><h3>${esc(g.name)}</h3><div class="hint">${esc(SOURCES[g.source] || '')}${g.playtime >= 60 ? ` · ${esc(fmtPlaytime(g.playtime))} played` : ' · Not played yet'}</div>`;
  };
  md.el.addEventListener('click', e => {
    const b = e.target.closest('[data-rnd]');
    if (!b) return;
    if (b.dataset.rnd === 'again') { if (list.length > 1) { let n; do n = list[Math.floor(Math.random() * list.length)]; while (n === g); g = n; } show(); }
    else { md.close(); ui.section = 'library'; selectGame(g.id, true); if (b.dataset.rnd === 'play') launch(g); }
  });
  show();
}

// ---------------- global search (Playnite's search view): games and commands ----------------
function globalSearch() {
  const COMMANDS = [
    ['Add a game…', 'exe', addExe], ['Update game library', 'refresh', () => runImport()], ['Download missing metadata', 'image', () => api.refreshAllMetadata()],
    ['Random game', 'shuffle', randomGame], ['Statistics', 'chartBar', () => setSection('stats')], ['Controller Test', 'gameController', () => setSection('pad')],
    ['Settings', 'gear', settingsDialog], ['Switch to Console Mode', 'monitorPlay', () => api.setMode('fullscreen')],
    ['Grid view', 'squaresFour', () => setView('grid')], ['Details view', 'sidebarSimple', () => setView('details')], ['List view', 'listBullets', () => setView('list')],
    ['Clear filters', 'funnel', clearFilters], ["Post to What's New", 'edit', postDialog],
  ];
  const md = modal({ title: 'Search', cls: 'search-md', body: `<div class="gs"><input class="input" id="gs-q" placeholder="Search games and commands" spellcheck="false"><div class="gs-res"></div></div>` });
  const q = md.el.querySelector('#gs-q');
  const res = md.el.querySelector('.gs-res');
  let items = [], sel = 0;
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    const games = S.games.filter(g => !t || g.name.toLowerCase().includes(t)).sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0)).slice(0, t ? 30 : 8)
      .map(g => ({ html: `${iconHtml(g)}<span>${esc(g.name)}</span><small>${g.hidden ? 'Hidden · ' : ''}${esc(SOURCES[g.source] || '')}</small>`, run: () => { ui.section = 'library'; if (g.hidden) ui.filters.hidden = true; selectGame(g.id, true); render(); }, play: () => launch(g) }));
    const cmds = COMMANDS.filter(([l]) => !t || l.toLowerCase().includes(t)).map(([l, ic, run]) => ({ html: `<span class="gi none">${icon(ic)}</span><span>${esc(l)}</span><small>Command</small>`, run }));
    items = [...games, ...cmds];
    sel = Math.min(sel, Math.max(0, items.length - 1));
    res.innerHTML = items.length ? items.map((it, i) => `<div class="gs-it ${i === sel ? 'on' : ''}" data-i="${i}">${it.html}</div>`).join('') : '<div class="status">Nothing found</div>';
  };
  const go = (i, play) => { const it = items[i]; if (!it) return; md.close(); (play && it.play ? it.play : it.run)(); };
  q.addEventListener('input', () => { sel = 0; draw(); });
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length); draw(); res.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter') go(sel, e.shiftKey);
  });
  res.addEventListener('click', e => { const it = e.target.closest('[data-i]'); if (it) go(Number(it.dataset.i)); });
  draw();
  setTimeout(() => q.focus(), 20);
}

// ---------------- navigation ----------------
function setSection(s) { ui.section = s; closeEditor(); render(); }
function setView(v) { ui.view = v; ui.section = 'library'; savePrefs(); render(); }
function clearFilters() { ui.filters = normFilters({}); ui.explore = null; savePrefs(); render(); }

function selectGame(id, scroll = false) {
  ui.selected = id;
  markSelected();
  if (ui.view === 'details' && ui.section === 'library') setHtml($('.dpane') || document.createElement('div'), 'dpane-' + id, detailsPane(gameById(id)));
  renderSidePane();
  if (scroll) { const c = document.querySelector(`.card[data-id="${id}"], .dl-it[data-id="${id}"], tr.row[data-id="${id}"]`); if (c) c.scrollIntoView({ block: 'nearest' }); }
}

// ---------------- wiring ----------------
$('.search .s-ico').innerHTML = icon('search');
$('#search').placeholder = 'Search';
$('#search').addEventListener('input', e => { ui.search = e.target.value.trim(); ui.section = 'library'; render(); });

$('#sidebar').addEventListener('click', e => {
  const b = e.target.closest('[data-sb]');
  if (!b) return;
  const a = b.dataset.sb;
  if (a === 'menu') { const r = b.getBoundingClientRect(); mainMenu(r.right + 4, r.top); }
  else if (a === 'console') api.setMode('fullscreen');
  else if (a === 'settings') settingsDialog();
  else setSection(a);
});

document.querySelector('.top').addEventListener('click', e => {
  const b = e.target.closest('[data-tp]');
  if (!b) return;
  const r = b.getBoundingClientRect();
  const a = b.dataset.tp;
  if (a === 'gsearch') globalSearch();
  else if (a === 'presets') presetsMenu(r.left, r.bottom + 4);
  else if (a === 'group') groupMenu(r.left, r.bottom + 4);
  else if (a === 'sort') sortMenu(r.left, r.bottom + 4);
  else if (a.startsWith('view-')) setView(a.slice(5));
  else if (a === 'random') randomGame();
  else if (a === 'explorer') { ui.explorer = !ui.explorer; if (!ui.explorer) ui.explore = null; ui.section = 'library'; savePrefs(); render(); }
  else if (a === 'filter') { ui.filterPanel = !ui.filterPanel; ui.section = 'library'; savePrefs(); render(); }
  else if (a === 'notes') notificationsMenu(r.right - 340, r.bottom + 4);
  else if (a === 'pad') setSection('pad');
});

$('#explorer').addEventListener('change', e => { if (e.target.id === 'ex-field') { ui.explorerField = e.target.value; ui.explore = null; savePrefs(); render(); } });
$('#explorer').addEventListener('click', e => {
  const it = e.target.closest('[data-ex]');
  if (!it) return;
  ui.explore = it.dataset.ex ? { field: ui.explorerField, value: it.dataset.ex } : null;
  render();
});

$('#filterpanel').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.fk) ui.filters[t.dataset.fk] = t.checked;
  else if (t.dataset.fl) { const k = t.dataset.fl; ui.filters[k] = t.checked ? [...ui.filters[k], t.value] : ui.filters[k].filter(v => v !== t.value); }
  else return;
  savePrefs();
  render();
});
$('#filterpanel').addEventListener('click', e => {
  const sh = e.target.closest('.fp-sh');
  if (sh) { const k = sh.parentElement.dataset.sec; if (openSections.has(k)) openSections.delete(k); else openSections.add(k); sh.parentElement.classList.toggle('open'); return; }
  const b = e.target.closest('[data-fp]');
  if (!b) return;
  if (b.dataset.fp === 'close') { ui.filterPanel = false; savePrefs(); render(); }
  else if (b.dataset.fp === 'clear') clearFilters();
  else if (b.dataset.fp === 'save') savePreset();
});

// clicks in the library views, the details panes and statistics
async function onDetailsAction(a, g, b) {
  if (a === 'play') launch(g);
  else if (a === 'close') closeGame(g);
  else if (a === 'edit') editGame(g.id);
  else if (a === 'fav') api.updateGame(g.id, { favorite: !g.favorite });
  else if (a === 'folder') api.openGameFolder(g.id);
  else if (a === 'more') { const r = b.getBoundingClientRect(); gameMenu(g, r.left, r.bottom + 4); }
  else if (a === 'completion') { const r = b.getBoundingClientRect(); showMenu(r.left, r.bottom + 4, COMPLETION.map(c => ({ label: c, check: completion(g) === c, run: () => api.updateGame(g.id, { completion: c }) }))); }
}
document.addEventListener('click', e => {
  const host = e.target.closest('#main, #sidepane');
  if (!host) return;
  const act = e.target.closest('[data-act]');
  if (act && act.dataset.act === 'scan') return runImport();
  if (act && act.dataset.act === 'add-exe') return addExe();
  if (act && act.dataset.act === 'clear-filters') return clearFilters();
  if (e.target.closest('[data-sp="close"]')) { ui.gridDetails = false; savePrefs(); renderSidePane(); return; }
  const url = e.target.closest('[data-url]');
  if (url) return api.openExternal(url.dataset.url);
  const fl = e.target.closest('[data-filter]');
  if (fl) return setOnlyFilter(fl.dataset.filter, fl.dataset.v);
  const gd = e.target.closest('[data-gd]');
  if (gd) { const g = gameById(gd.closest('.gd').dataset.id); if (g) onDetailsAction(gd.dataset.gd, g, gd); return; }
  const grp = e.target.closest('[data-grp]');
  if (grp) { const k = ui.group + ':' + grp.dataset.grp; if (ui.collapsed.has(k)) ui.collapsed.delete(k); else ui.collapsed.add(k); savePrefs(); renderMain(); return; }
  const th = e.target.closest('th[data-sort]');
  if (th) { const k = th.dataset.sort; if (ui.sort === k) ui.sortDir = ui.sortDir === 'asc' ? 'desc' : 'asc'; else { ui.sort = k; ui.sortDir = SORT_BY[k].desc ? 'desc' : 'asc'; } savePrefs(); render(); return; }
  const item = e.target.closest('[data-id]');
  if (!item) return;
  const g = gameById(item.dataset.id);
  if (!g) return;
  if (item.closest('.v-stats')) { ui.section = 'library'; render(); selectGame(g.id, true); return; }
  selectGame(g.id);
  if (!act) return;
  if (act.dataset.act === 'play') launch(g);
  else if (act.dataset.act === 'close') closeGame(g);
  else if (act.dataset.act === 'info') { ui.gridDetails = true; savePrefs(); renderSidePane(); }
});
$('#main').addEventListener('dblclick', e => {
  const c = e.target.closest('.card, .dl-it, tr.row');
  if (c && !e.target.closest('[data-act]')) launch(gameById(c.dataset.id));
});
$('#main').addEventListener('contextmenu', e => {
  const c = e.target.closest('.card, .dl-it, tr.row');
  if (!c) return;
  e.preventDefault();
  selectGame(c.dataset.id);
  gameMenu(gameById(c.dataset.id), e.clientX, e.clientY);
});
$('#main').addEventListener('input', e => {
  if (e.target.id !== 'zoom') return;
  ui.cover = Number(e.target.value);
  document.documentElement.style.setProperty('--cover', ui.cover + 'px');
});
$('#main').addEventListener('change', e => { if (e.target.id === 'zoom') { savePrefs(); forget(/^main$/); } });
// Ctrl + mouse wheel zooms the grid, like Playnite
$('#main').addEventListener('wheel', e => {
  if (!e.ctrlKey || ui.view !== 'grid') return;
  e.preventDefault();
  ui.cover = Math.max(120, Math.min(320, ui.cover + (e.deltaY < 0 ? 10 : -10)));
  document.documentElement.style.setProperty('--cover', ui.cover + 'px');
  const z = $('#zoom'); if (z) z.value = ui.cover;
  clearTimeout(zoomSave); zoomSave = setTimeout(() => { savePrefs(); forget(/^main$/); }, 500);
}, { passive: false });
let zoomSave = 0;

// arrow keys: by position in the grid (groups make rows uneven), by row in the details and list views
function moveSel(key) {
  const els = [...document.querySelectorAll('#main .card, #main .dl-it, #main tr.row')];
  if (!els.length) return;
  const seen = new Set();
  const uniq = els.filter(x => !seen.has(x.dataset.id) && seen.add(x.dataset.id));
  const cur = uniq.find(x => x.dataset.id === ui.selected) || null;
  let next = null;
  if (!cur) next = uniq[0];
  else if (ui.view !== 'grid' || key === 'ArrowLeft' || key === 'ArrowRight') {
    const i = uniq.indexOf(cur);
    const d = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
    if (ui.view !== 'grid' && (key === 'ArrowLeft' || key === 'ArrowRight')) return;
    next = uniq[i + d] || null;
  } else {
    const r = cur.getBoundingClientRect();
    const down = key === 'ArrowDown';
    const rows = uniq.map(x => ({ x, r: x.getBoundingClientRect() })).filter(o => (down ? o.r.top > r.top + 4 : o.r.top < r.top - 4));
    if (rows.length) {
      const rowTop = down ? Math.min(...rows.map(o => o.r.top)) : Math.max(...rows.map(o => o.r.top));
      next = rows.filter(o => Math.abs(o.r.top - rowTop) < 4).sort((a, b) => Math.abs(a.r.left - r.left) - Math.abs(b.r.left - r.left))[0].x;
    }
  }
  if (next) selectGame(next.dataset.id, true);
}

window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (openMenuEl) { closeMenu(); return; }
    const t = topModal();
    if (t) { t.querySelector('[data-close]').click(); return; }
    if (editing) { closeEditor(); renderSidePane(); return; }
    if (ui.section !== 'library') { setSection('library'); return; }
    if (document.activeElement === $('#search') && ui.search) { $('#search').value = ''; ui.search = ''; render(); return; }
  }
  const k = e.key.toLowerCase();
  if (e.ctrlKey && e.shiftKey && k === 'f') { e.preventDefault(); globalSearch(); return; }
  if (e.ctrlKey && k === 'f') { e.preventDefault(); $('#search').focus(); $('#search').select(); return; }
  if (e.ctrlKey && k === 'r') { e.preventDefault(); randomGame(); return; }
  if (e.key === 'F11') { e.preventDefault(); api.setMode('fullscreen'); return; }
  if (e.key === 'F5') { e.preventDefault(); runImport(); return; }
  if (e.key === 'F4') { e.preventDefault(); settingsDialog(); return; }
  const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
  if (inField || topModal() || ui.section !== 'library') return;
  if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); moveSel(e.key); return; }
  const g = gameById(ui.selected);
  if (!g) return;
  if (e.key === 'Enter') launch(g);
  else if (e.key === 'Delete') removeGame(g);
  else if (e.key === 'F2' || e.key === 'F3') { e.preventDefault(); editGame(g.id); }
});

// drag an .exe / shortcut onto the window to add it
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault();
  for (const file of e.dataTransfer.files) {
    const p = api.pathForFile(file);
    if (p && /\.(exe|lnk|url|bat)$/i.test(p)) addPath(p);
  }
});

// ---------------- main-process events ----------------
let lastLight = `${S.settings.lightBar}|${S.settings.lightBarBrightness}`;
applyLightBar(S.settings, api, { ask: true });
api.on('state', s => {
  S = s;
  const light = `${S.settings.lightBar}|${S.settings.lightBarBrightness}`;
  if (light !== lastLight) { lastLight = light; applyLightBar(S.settings, api); }
  if (ui.selected && !gameById(ui.selected)) ui.selected = null;
  render();
  if (editing) editing.refreshArt();
});
api.on('task', t => {
  progress = t.finished ? null : { text: t.total ? `${t.label.replace(/^Downloading artwork · /, 'Downloading artwork: ')} (${t.done + 1}/${t.total})` : t.label, value: t.total ? t.done / t.total : null };
  renderProgress();
  if (t.finished) notify(t.label);
});
api.on('game-failed', (id, name, reason) => { notify(`Couldn't start ${name}`, reason, 'error'); alertBox("Couldn't start the game", `${name}\n\n${reason}`); });
api.on('game-stopped', (id, secs, failed) => {
  const g = gameById(id);
  if (g && !failed) toast(g.name, secs >= 60 ? `You played for ${fmtPlaytime(secs)}` : 'Game closed');
});

render();

// a picture from the internet that fails takes its tile away: <img data-gone=".tile"> (data-gone-hide: hide it, the
// list's keyboard order stays the same). Instead of inline onerror handlers, which the page's security policy blocks.
document.addEventListener('error', e => {
  const t = e.target;
  if (!t || t.tagName !== 'IMG' || !t.dataset.gone) return;
  const tile = t.closest(t.dataset.gone);
  if (!tile) return;
  if (t.dataset.goneHide) { tile.classList.add('off'); tile.style.display = 'none'; } else tile.remove();
}, true);
