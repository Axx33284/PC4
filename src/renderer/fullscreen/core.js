// Shared state, layer stack and tile artwork for console mode.
import { mediaUrl, esc, icon, adjustStyle, adjustTransform } from '../common/util.js';
import { keyLabel } from './keys.js';

export const ctx = {
  state: null,
  layers: [],
  subs: new Set(),
  get settings() { return this.state.settings; },
};

export const api = window.pc4;

export function subscribe(fn) { ctx.subs.add(fn); return () => ctx.subs.delete(fn); }
export function setState(s) { ctx.state = s; for (const fn of ctx.subs) fn(s); }

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const games = () => ctx.state.games.filter(g => !g.hidden);
export const gameById = id => ctx.state.games.find(g => g.id === id);
export const media = (game, kind) => mediaUrl(ctx.state, game, kind);
export const isRunning = id => ctx.state.running.includes(id);

// ---- layer stack: the top layer receives input ----
export function topLayer() { return ctx.layers[ctx.layers.length - 1]; }

export function pushLayer(layer) {
  const prev = topLayer();
  if (prev && prev.onBlur) prev.onBlur();
  ctx.layers.push(layer);
  if (layer.onFocus) layer.onFocus();
}

export function removeLayer(layer) {
  const i = ctx.layers.indexOf(layer);
  if (i < 0) return;
  const wasTop = i === ctx.layers.length - 1;
  ctx.layers.splice(i, 1);
  if (wasTop) { const t = topLayer(); if (t && t.onFocus) t.onFocus(); }
}

export function dispatch(action, info) {
  const t = topLayer();
  if (t && t.handle) t.handle(action, info);
}

// ---- artwork ----
// thumbnails keep the home row and library light; full images are only used full-screen
const thumb = (g, kind) => media(g, kind + 'Thumb') || media(g, kind);

export function gameArt(g, { style } = {}) {
  const s = style || ctx.settings.tileStyle;
  const tile = thumb(g, 'tile');
  const hero = thumb(g, 'hero');
  const logo = media(g, 'logo');
  const cover = thumb(g, 'cover');
  const ic = media(g, 'icon');
  const adj = g.artAdjust || {};
  // tileArt = how the user framed the picture inside the square tile (whatever image it uses);
  // tileLogo = where they put the logo on it
  const pic = adj.tileArt;
  const logoStyle = adj.tileLogo ? `transform:${adjustTransform(adj.tileLogo)}` : '';
  if (tile) return `<img class="art-img" src="${tile}" decoding="async" style="${adjustStyle(pic || adj.tile)}">`;
  if (s !== 'cover' && hero && logo) return `<div class="art-comp"><img class="art-bg" src="${hero}" decoding="async" style="${adjustStyle(pic || adj.hero)}"><img class="art-logo" src="${logo}" decoding="async" style="${logoStyle}"></div>`;
  // a cover the user positioned is shown the way they framed it
  if (cover && (pic || adj.cover)) return `<img class="art-img" src="${cover}" decoding="async" style="${adjustStyle(pic || adj.cover)}">`;
  if (cover) return `<div class="art-fit"><img class="blur" src="${cover}" decoding="async"><img class="fg" src="${cover}" decoding="async"></div>`;
  if (hero) return `<div class="art-comp"><img class="art-bg" src="${hero}" decoding="async" style="${adjustStyle(pic)}"><span class="art-name">${esc(g.name)}</span></div>`;
  if (ic) return `<div class="art-ph"><img class="art-icon" src="${ic}"><span>${esc(g.name)}</span></div>`;
  return `<div class="art-ph"><span>${esc(g.name)}</span></div>`;
}

export function folderArt(f) {
  const list = f.gameIds.map(gameById).filter(Boolean).slice(0, 3);
  const cells = [0, 1, 2].map(i => `<div class="cell">${list[i] ? gameArt(list[i]) : ''}</div>`).join('');
  return `<div class="art-folder">${cells}<div class="cell fi">${icon('folderFill')}</div></div>`;
}

export function sysArt(name, label, extra = '') {
  return `<div class="art-sys ${label ? 'labelled' : ''} ${extra}">${icon(name)}${label ? `<div class="sys-label">${esc(label)}</div>` : ''}</div>`;
}

// the image used as a full-screen backdrop for a game
export function backdrop(g) {
  return media(g, 'background') || media(g, 'hero') || media(g, 'cover') || media(g, 'tile');
}

// a mid-size image for cards (Start card, What's New thumbnails)
export function cardArt(g) {
  return media(g, 'heroThumb') || media(g, 'hero') || media(g, 'backgroundThumb') || media(g, 'coverThumb') || media(g, 'cover');
}

// Controller button icons (drawn as vectors so they stay sharp on any TV) and the matching keyboard keys.
// Every set is always in the page; CSS shows the one for the input device you used last
// (body.input-key) and the controller family (body.pads-ps4 / pads-ps5 / pads-xbox).
const PS4_FACE = {
  cross: '<path d="M8 8l8 8M16 8l-8 8" stroke="#8cb2ff"/>',
  circle: '<circle cx="12" cy="12" r="4.9" stroke="#ff6f6f"/>',
  triangle: '<path d="M12 6.6 17.3 15.9H6.7Z" stroke="#3fd8a8"/>',
  square: '<rect x="7.3" y="7.3" width="9.4" height="9.4" stroke="#f184dc"/>',
};
// PS5: the same symbols, all white like on the DualSense
const PS5_FACE = Object.fromEntries(Object.entries(PS4_FACE).map(([k, v]) => [k, v.replace(/stroke="#\w+"/, 'stroke="#f4f6fa"')]));
const XBOX_FACE = { cross: ['A', '#6cc644'], circle: ['B', '#f0524a'], square: ['X', '#3d8fef'], triangle: ['Y', '#f5c518'] };
const TAG = { l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2', l3: 'L3', r3: 'R3' };
const XBOX_TAG = { l1: 'LB', r1: 'RB', l2: 'LT', r2: 'RT', l3: 'LS', r3: 'RS' };
const KEY = { cross: 'Enter', circle: 'Esc', triangle: 'Y', square: 'Del', options: 'Tab', l1: 'PgUp', r1: 'PgDn', l2: 'Shift', r2: 'Enter', l3: 'Alt', r3: 'F1', home: 'Home', up: '↑', down: '↓', left: '←', right: '→' };
const PS_TEXT = { cross: '✕', circle: '○', triangle: '△', square: '□' };
const MENU = '<svg class="pad-mini" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 7.5h12M6 12h12M6 16.5h12"/></svg>';
const XGUIDE = '<svg class="pad-face" viewBox="0 0 24 24" fill="none" stroke-linecap="round"><circle cx="12" cy="12" r="11.2" fill="#15171c" stroke="rgba(255,255,255,.35)" stroke-width=".8"/><circle cx="12" cy="12" r="6.4" stroke="#fff" stroke-width="1.7"/><path d="M9.4 9.2c1.3.9 2.1 1.8 2.6 2.8c.5-1 1.3-1.9 2.6-2.8M9.4 14.8c1.2-.9 2-1.8 2.6-2.8c.6 1 1.4 1.9 2.6 2.8" stroke="#fff" stroke-width="1.3"/></svg>';

const faceSvg = (inner, ring = 'rgba(255,255,255,.22)') => `<svg class="pad-face" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><circle cx="12" cy="12" r="11.2" fill="#15171c" stroke="${ring}" stroke-width=".8"/>${inner}</svg>`;

function ps4Icon(kind) {
  if (PS4_FACE[kind]) return faceSvg(PS4_FACE[kind]);
  if (TAG[kind]) return `<span class="pad-tag">${TAG[kind]}</span>`;
  if (kind === 'options') return '<span class="pad-tag pad-opt">OPTIONS</span>';
  if (kind === 'home') return '<span class="pad-tag pad-ps">PS</span>';
  return null;
}
function ps5Icon(kind) {
  if (PS5_FACE[kind]) return faceSvg(PS5_FACE[kind], 'rgba(255,255,255,.55)');
  if (TAG[kind]) return `<span class="pad-tag pad-w">${TAG[kind]}</span>`;
  if (kind === 'options') return `<span class="pad-tag pad-w pad-opt">${MENU}</span>`;
  if (kind === 'home') return '<span class="pad-tag pad-w pad-ps">PS</span>';
  return null;
}
function xboxIcon(kind) {
  if (XBOX_FACE[kind]) { const [l, c] = XBOX_FACE[kind]; return faceSvg(`<text x="12" y="16.4" text-anchor="middle" font-size="12.5" font-weight="700" font-family="Segoe UI, Arial, sans-serif" fill="${c}" stroke="none">${l}</text>`); }
  if (XBOX_TAG[kind]) return `<span class="pad-tag">${XBOX_TAG[kind]}</span>`;
  if (kind === 'options') return `<span class="pad-tag pad-round">${MENU}</span>`;
  if (kind === 'home') return XGUIDE;
  return null;
}

// the keyboard key for a button, as bound in Settings › Keyboard
const keyText = kind => keyLabel(kind, ctx.settings) || KEY[kind] || kind;

export function padIcon(kind) {
  const a = ps4Icon(kind);
  if (!a) return `<span class="pad-tag">${keyText(kind)}</span>`;
  return `<span class="pv pv-ps4">${a}</span><span class="pv pv-ps5">${ps5Icon(kind)}</span><span class="pv pv-xbox">${xboxIcon(kind)}</span>`;
}

// the button's name as plain text, for sentences and small labels ("Press △", "Press Y")
export function padText(kind) {
  const x = document.body.classList.contains('pads-xbox');
  if (PS_TEXT[kind]) return x ? XBOX_FACE[kind][0] : PS_TEXT[kind];
  if (TAG[kind]) return x ? XBOX_TAG[kind] : TAG[kind];
  if (kind === 'options') return x ? 'Menu' : 'OPTIONS';
  return kind;
}

export function glyph(kind) {
  return `<span class="glyph"><span class="gp">${padIcon(kind)}</span><span class="gk"><span class="kc" data-k="${kind}">${esc(keyText(kind))}</span></span></span>`;
}

// keys changed in Settings › Keyboard: every hint already on screen shows the new key
export function refreshKeyHints() {
  for (const k of document.querySelectorAll('.kc[data-k]')) k.textContent = keyText(k.dataset.k);
}

export function hintsHtml(list) {
  return list.map(([g, label]) => `<span>${glyph(g)}${esc(label)}</span>`).join('');
}
