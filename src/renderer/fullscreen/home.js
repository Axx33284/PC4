// The PS4 home screen: function area, the content row of tiles, and the hub below the selected tile.
import { ctx, api, el, games, gameById, media, isRunning, gameArt, folderArt, sysArt, backdrop, cardArt, subscribe, padText } from './core.js';
import { sfx, Music } from './sound.js';
import { openPadTest } from './padtest.js';
import { openStore } from './gamestore.js';
import { openMedia, nowPlaying } from './media.js';
import { openGallery } from './gallery.js';
import { Player } from './player.js';
import { songResults } from './quickmenu.js';
import { textInput, openOptions } from './ui.js';
import { avatarUrl, esc, icon, fmtPlaytime, timeAgo, SOURCES, SORTS, fileUrl as fileUrlOf, adjustStyle, controllerIcon, controllerSupport, controllerAdvice, connectedPad, padStyle, SUPPORT_LABEL } from '../common/util.js';
import { launchGame, gameOptions, folderOptions, showInfo, linkArtwork, runImport, addExe, activityFeed, showNotifications, showProfile, powerMenu, switchMode, showArticle, whatsNewOptions, themeSongMenu, gameNews, newsFeed, editGame, openYouTube, clearYouTube, showTrending, trendLine } from './actions.js';
import { toast } from './ui.js';
import { gallery } from './editor.js';

const T = 19.6;          // tile size
const G = 0.6;           // gap
const STEP = T + G;
const SELW = 34.4;       // selected tile outer width
const RING = 0.3;
// the YouTube tile: a play button on red, like the app on a TV (drawn, not YouTube's own artwork)
const YT_ART = `<div class="art-sys art-yt">${icon('ytFill')}<div class="sys-label">YouTube</div></div>`;

const HOME_LIMIT = 24;   // PS4 keeps the most recent items on the home row

const FN = [
  { id: 'import', icon: 'bag', label: 'Game Import', sub: 'Scan your launchers or add a game' },
  { id: 'notif', icon: 'bell', label: 'Notifications' },
  { id: 'profile', icon: 'user', label: 'Profile' },
  { id: 'library', icon: 'library', label: 'Library' },
  { id: 'emulation', icon: 'swap', label: 'Xbox Controller Emulation', sub: 'Play Xbox-only games with your PlayStation controller' },
  { id: 'padtest', icon: 'pulse', label: 'Controller Test', sub: 'Check buttons, sticks, drift, triggers, vibration and battery' },
  { id: 'settings', icon: 'gear', label: 'Settings' },
  { id: 'desktop', icon: 'desktop', label: 'Desktop Mode', sub: 'Manage your library with mouse and keyboard' },
  { id: 'power', icon: 'power', label: 'Power' },
];

// PS5 style, rebuilt after Playnite's "PS5-ish" fullscreen theme (David Griggs), measured on the owner's 1080p screen
// with it running (1rem = 1/108 of the screen height = 10 px there): tabs All / Favorites (+ Media), the Store icon on
// the left, portrait covers 104x142 px with 11 px gaps, the focused one 176x240 px at x 167 with a rotating gradient
// ring, its name under the small covers beside it, a More Games tile at the end, the game's art filling the screen,
// "Play Game" + "···" bottom-left and a Time Played / Last Played card bottom-right.
const ps5 = () => ctx.settings.uiStyle === 'ps5';
const P5 = { W: 10.4, G: 1.1, SEL: 17.6, X: 16.7, GAP: 1.7 };
const TABS5 = ['all', 'favorites', 'media'];
const P5_IMG = name => new URL(`../../../assets/ps5/${name}`, import.meta.url).href;
// the PS5's top-right corner: Search, Settings, your avatar (the clock is the status bar)
const FN5 = [
  { id: 'search', icon: 'searchBold', label: 'Search' },
  { id: 'settings', icon: 'gearFill', label: 'Settings' },
  { id: 'account', icon: 'user', label: 'Profile' },
];
// the words above the cards of the PS5's non-game hubs
const TEXT5 = {
  import: ['Game Import', 'Bring in your games', 'Scan Steam, Epic Games and GOG Galaxy, or add any game by its .exe.'],
  library: ['Game Library', 'All your games', 'Installed games, favorites, folders and everything you own, sorted the way you like.'],
  store: ['Game Store', 'Free games and deals', 'Free games on Epic this week and next, Steam deals, top sellers and new releases.'],
  youtube: ['YouTube', 'Watch on the big screen', 'YouTube with your controller, just like on a TV.'],
  media: ['Media Player', 'Your videos and music', 'Videos and music on this PC. Videos carry on where you stopped.'],
  gallery: ['Capture Gallery', 'Your screenshots and clips', 'Press SHARE for a screenshot, hold it to record a clip.'],
};
const hero5 = (kicker, title, desc) => `${kicker ? `<div class="p5-kicker">${esc(kicker)}</div>` : ''}<div class="p5-title">${esc(title)}</div>${desc ? `<div class="p5-desc">${esc(desc)}</div>` : ''}`;

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize);
const vwRem = () => innerWidth / remPx();

export class Home {
  constructor(root, nav) {
    this.nav = nav;
    this.root = el(`<div id="home" class="screen area-row"><div class="home-scroller">
      <div class="p5-tabs"><span data-tab="all">All</span><span data-tab="favorites">Favorites</span><span data-tab="media">Media</span></div>
      <div class="fn-row"></div><div class="fn-label"></div>
      <div class="tile-row"></div><div class="tile-title"></div><div class="hub"></div></div></div>`);
    this.tab = 'all';
    this.root.querySelector('.p5-tabs').addEventListener('click', e => { const t = e.target.closest('[data-tab]'); if (t) this.setTab(t.dataset.tab); });
    root.appendChild(this.root);
    this.scroller = this.root.querySelector('.home-scroller');
    this.rowEl = this.root.querySelector('.tile-row');
    this.titleEl = this.root.querySelector('.tile-title');
    this.hubEl = this.root.querySelector('.hub');
    this.fnRow = this.root.querySelector('.fn-row');
    this.fnLabel = this.root.querySelector('.fn-label');
    this.area = 'row';
    this.sel = 1;
    this.fnSel = 3;
    this.hubSel = 0;
    this.tileEls = new Map();
    this.items = [];
    this.hub = null;

    this.rowEl.addEventListener('click', e => this.clickTile(e));
    this.rowEl.addEventListener('contextmenu', e => { e.preventDefault(); const t = e.target.closest('.tile'); if (t) { this.selectKey(t.dataset.key); this.handle('options'); } });
    this.fnRow.addEventListener('click', e => {
      const f = e.target.closest('[data-i]');
      if (!f) return;
      this.fnSel = Number(f.dataset.i);
      this.area = 'fn';
      this.renderFn();
      this.fnActivate();
    });
    this.hubEl.addEventListener('click', e => {
      const c = e.target.closest('[data-h]');
      if (!c || !this.hub) return;
      this.hubSel = Number(c.dataset.h);
      this.setArea('hub');
      this.hub.activate(this.hubSel);
    });
    subscribe(() => this.refresh());
    window.addEventListener('resize', () => this.layout());
  }

  // ---------------- items ----------------
  buildItems() {
    const s = ctx.state;
    const inFolder = new Set(s.folders.flatMap(f => f.gameIds));
    const gs = games().filter(g => !inFolder.has(g.id)).map(g => ({ key: 'g:' + g.id, kind: 'game', g, t: g.lastPlayed || 0, t2: g.added }));
    const fs = s.folders.map(f => {
      const last = Math.max(0, ...f.gameIds.map(id => (gameById(id) || {}).lastPlayed || 0));
      return { key: 'f:' + f.id, kind: 'folder', f, t: last || f.created, t2: f.created };
    });
    const recent = [...gs, ...fs].sort((a, b) => b.t - a.t || b.t2 - a.t2).slice(0, HOME_LIMIT);
    const st = ctx.settings;
    const on = k => st[k] !== false;
    const apps = [
      on('showYouTube') && { key: 'youtube', kind: 'youtube' },
      on('showMedia') && { key: 'media', kind: 'media' },
      on('showGallery') && { key: 'gallery', kind: 'gallery' },
    ].filter(Boolean);
    const store = on('showStore') ? [{ key: 'store', kind: 'store' }] : [];
    // like the PS4: the Library is always the last tile, at the far right of the row
    if (!ps5()) return [{ key: 'import', kind: 'import' }, { key: 'whatsnew', kind: 'whatsnew' }, ...recent, ...store, ...apps, { key: 'library', kind: 'library' }];
    // PS5 (PS5-ish): the Store icon first, the games most recent first (Favorites: only those), More Games last;
    // Explore, the TV & video apps and Game Import on the Media tab
    if (this.tab === 'media') return [{ key: 'whatsnew', kind: 'whatsnew' }, ...apps, { key: 'import', kind: 'import' }];
    const list = this.tab === 'favorites' ? recent.filter(x => x.kind === 'game' && x.g.favorite) : recent;
    return [...store, ...list, { key: 'library', kind: 'library' }];
  }

  // where PS / Home lands: PS4 the first item after Game Import, PS5 the most recent game
  homeIndex() {
    if (!ps5()) return 1;
    if (this.tab === 'media') return 0;
    const i = this.items.findIndex(it => it.kind === 'game' || it.kind === 'folder');
    return i >= 0 ? i : 0;
  }

  setTab(tab) {
    if (!ps5() || tab === this.tab || !TABS5.includes(tab)) return;
    sfx('move');
    this.tab = tab;
    this.items = [];
    this.sel = 0;
    this.refresh();
    this.sel = this.homeIndex();
    this.setArea('row');
    this.layout();
    this.renderHub(true);
  }

  // the console style changed (Settings > Themes > Console Style)
  restyle() {
    this.fnSel = ps5() ? 0 : 3;
    this.tab = 'all';
    this.items = [];
    this.area = 'row';
    this.refresh();
    this.sel = this.homeIndex();
    this.setArea('row');
    this.layout();
    this.renderHub(true);
  }

  artFor(it) {
    if (ps5()) {
      // PS5-ish: portrait covers; its own Store and More Games pictures
      if (it.kind === 'game') {
        const c = media(it.g, 'coverThumb') || media(it.g, 'cover');
        if (c) return `<img class="art-img art-cover5" src="${c}" decoding="async" style="${adjustStyle((it.g.artAdjust || {}).cover)}">`;
        return `<div class="art-ph5">${icon('gamepad')}<span>${esc(it.g.name)}</span></div>`;
      }
      if (it.kind === 'store') return `<div class="art-img5 store5"><img src="${P5_IMG('store.png')}" alt=""></div>`;
      if (it.kind === 'library') return `<div class="art-img5 more5"><img src="${P5_IMG('more-games.png')}" alt=""></div>`;
    }
    if (it.kind === 'game') return gameArt(it.g);
    if (it.kind === 'folder') return folderArt(it.f);
    if (it.kind === 'import') return sysArt('bag', 'Game Import', 'store');
    if (it.kind === 'whatsnew') return ps5() ? sysArt('rocket') : sysArt('shapes');
    if (it.kind === 'library') return sysArt('library', 'Library');
    if (it.kind === 'youtube') return YT_ART;
    if (it.kind === 'store') return sysArt('store', 'Game Store', 'store');
    if (it.kind === 'media') return sysArt('media', 'Media Player', 'app-media');
    if (it.kind === 'gallery') return sysArt('gallery', 'Capture Gallery', 'app-gallery');
    return '';
  }

  barFor(it) {
    if (it.kind === 'game') return isRunning(it.g.id) ? `${icon('play')}<span>Running</span>` : `<span>Start</span>`;
    if (['youtube', 'store', 'media', 'gallery'].includes(it.kind)) return '<span>Start</span>';
    return icon('down');
  }

  titleFor(it) {
    return { game: it.g && it.g.name, folder: it.f && it.f.name, import: 'Game Import', whatsnew: ps5() ? 'Explore' : "What's New", library: ps5() ? 'More Games' : 'Library', youtube: 'YouTube', store: 'Game Store', media: 'Media Player', gallery: 'Capture Gallery' }[it.kind];
  }

  refresh() {
    const selKey = this.items[this.sel] && this.items[this.sel].key;
    const first = !this.items.length;
    this.items = this.buildItems();
    const idx = this.items.findIndex(i => i.key === selKey);
    this.sel = idx >= 0 ? idx : first && ps5() ? this.homeIndex() : Math.min(this.sel, this.items.length - 1);
    const keep = new Set(this.items.map(i => i.key));
    for (const [k, e] of this.tileEls) if (!keep.has(k)) { e.remove(); this.tileEls.delete(k); }
    for (const it of this.items) {
      let e = this.tileEls.get(it.key);
      if (!e) {
        e = el(`<div class="tile" data-key="${esc(it.key)}"><div class="art"></div><div class="bar"></div></div>`);
        this.rowEl.appendChild(e);
        this.tileEls.set(it.key, e);
      }
      const art = this.artFor(it);
      if (e._art !== art) { e.querySelector('.art').innerHTML = art; e._art = art; }
      const bar = this.barFor(it);
      if (e._bar !== bar) { e.querySelector('.bar').innerHTML = bar; e._bar = bar; }
      const running = it.kind === 'game' && isRunning(it.g.id);
      const dot = e.querySelector('.run-dot');
      if (running && !dot) e.appendChild(el('<div class="run-dot"></div>'));
      if (!running && dot) dot.remove();
    }
    this.layout();
    this.renderHub(true);
    if (this.area === 'fn' || ps5()) this.renderFn();
    this.root.querySelectorAll('.p5-tabs [data-tab]').forEach(t => t.classList.toggle('on', t.dataset.tab === this.tab));
  }

  // ---------------- layout ----------------
  layout() {
    if (ps5()) return this.layout5();
    const sel = this.sel;
    const selX = sel === 0 ? 7 : 28;
    const vw = vwRem();
    this.items.forEach((it, i) => {
      const e = this.tileEls.get(it.key);
      let x;
      if (i < sel) x = selX - RING - G - T - (sel - i - 1) * STEP;
      else if (i === sel) x = selX;
      else x = selX + SELW + RING + G + (i - sel - 1) * STEP;
      e.style.transform = `translate3d(${x}rem,0,0)`;
      e.classList.toggle('sel', i === sel);
      e.classList.remove('gone');
      e.style.visibility = x < -60 || x > vw + 30 ? 'hidden' : '';
      if (this.intro) e.style.animationDelay = `${Math.max(0, i - sel + 1) * 45}ms`;
    });
    const it = this.items[sel];
    const name = it ? this.titleFor(it) : '';
    const left = selX + SELW + 2.4;
    this.titleEl.style.left = `${left}rem`;
    this.titleEl.style.maxWidth = `${vw - left - 5}rem`;
    if (this.titleEl.textContent !== name) {
      this.titleEl.textContent = name || '';
      this.titleEl.classList.toggle('small', (name || '').length > 26);
    }
  }

  layout5() {
    const { W, G, SEL, X, GAP } = P5;
    const sel = this.sel;
    const it = this.items[sel];
    const name = it ? this.titleFor(it) || '' : '';
    this.titleEl.style.maxWidth = '';
    this.titleEl.style.left = `${X + SEL + GAP}rem`;
    if (this.titleEl.textContent !== name) { this.titleEl.textContent = name; this.titleEl.classList.remove('small'); }
    const vw = vwRem();
    this.items.forEach((item, i) => {
      const e = this.tileEls.get(item.key);
      let x;
      if (i < sel) x = X - GAP - W - (sel - i - 1) * (W + G);
      else if (i === sel) x = X;
      else x = X + SEL + GAP + (i - sel - 1) * (W + G);
      e.style.transform = `translate3d(${x}rem,0,0)`;
      e.classList.toggle('sel', i === sel);
      e.classList.remove('gone');
      e.classList.toggle('k-store', item.kind === 'store');
      e.classList.toggle('k-more', item.kind === 'library');
      e.style.visibility = x < -30 || x > vw + 20 ? 'hidden' : '';
      if (this.intro) e.style.animationDelay = `${200 + Math.max(0, i - sel) * 100}ms`; // PS5-ish: one after another, 0.1 s apart
    });
  }

  playIntro() {
    this.intro = true;
    this.rowEl.classList.add('intro');
    this.layout();
    clearTimeout(this.introT);
    this.introT = setTimeout(() => { this.intro = false; this.rowEl.classList.remove('intro'); for (const e of this.tileEls.values()) e.style.animationDelay = ''; }, 1500);
  }

  select(i, sound = true) {
    if (i < 0 || i >= this.items.length) { sfx('bump'); return; }
    if (i === this.sel) return;
    this.sel = i;
    this.hubSel = 0;
    if (sound) sfx('move');
    this.layout();
    this.renderHub();
  }

  selectKey(key) {
    const i = this.items.findIndex(it => it.key === key);
    if (i >= 0) this.select(i, false);
  }

  selectGame(id) {
    this.setArea('row');
    this.selectKey('g:' + id);
  }

  clickTile(e) {
    const t = e.target.closest('.tile');
    if (!t) return;
    const i = this.items.findIndex(it => it.key === t.dataset.key);
    if (this.area !== 'row') this.setArea('row');
    if (i === this.sel) this.handle('accept');
    else this.select(i);
  }

  // ---------------- hub ----------------
  renderHub(fromState = false) {
    clearTimeout(this.hubT);
    const it = this.items[this.sel];
    const build = () => {
      this.hub = it ? this.hubFor(it) : null;
      const html = this.hub ? this.hub.html : '';
      if (this.hubEl._html !== html) {
        this.hubEl.innerHTML = html;
        this.hubEl._html = html;
      }
      this.hubEl.classList.remove('swap');
      this.hubSel = Math.min(this.hubSel, Math.max(0, (this.hub ? this.hub.count : 1) - 1));
      this.paintHubFocus();
      this.updateBackdrop();
    };
    if (fromState) { build(); return; }
    this.hubEl.classList.add('swap');
    this.hubT = setTimeout(build, 140);
  }

  // Game wallpaper: 'details' shows it only while you're down in the game's hub (like opening the game on PS4),
  // 'hover' shows it as soon as the tile is selected. The game's theme song plays while you're in its details.
  updateBackdrop() {
    clearTimeout(this.bgT);
    clearTimeout(this.musicT);
    const mode = ps5() && ctx.settings.gameWallpaper !== 'off' ? 'hover' : ctx.settings.gameWallpaper || 'details';
    const it = this.items[this.sel];
    let focused = null; // the game whose details are open
    if (it && this.area === 'hub') {
      if (it.kind === 'game') focused = it.g;
      if (it.kind === 'folder' && this.hub && this.hub.games) focused = this.hub.games[this.hubSel] || null;
    }
    let g = null;
    if (mode !== 'off' && it) g = focused || (mode === 'hover' && it.kind === 'game' ? it.g : null);
    const pic = !g && mode !== 'off' && ps5() && this.hub && this.hub.bg ? this.hub.bg(this.area === 'hub' ? this.hubSel : 0) : null;
    const delay = g || pic ? (this.area === 'hub' ? 120 : 380) : 0;
    this.bgT = setTimeout(() => {
      this.nav.bg.setGame(g ? backdrop(g) : pic, g && g.media.background ? (g.artAdjust || {}).background || null : null);
      // the menu takes on the colours of the game whose details are open
      this.nav.bg.setAccent(focused && focused.media.accent && !ps5() ? focused.media.accent : null);
    }, delay);

    let song = null;
    if (!focused && ps5() && it && it.kind === 'game' && this.area === 'row') focused = it.g; // PS5: Home Screen Music on hover
    if (focused && ctx.settings.gameMusic !== false) {
      if (focused.media.music) song = `${ctx.state.mediaDir}/${focused.id}/${focused.media.music}`;
      else if (ctx.state.ytdlp && ctx.settings.autoThemeSongs && !focused.media.musicMissing) api.findThemeSong(focused.id, false);
    }
    // a short wait so flicking past a game doesn't restart the music
    this.musicT = setTimeout(() => Music.setGame(song), song ? 650 : 250);
  }

  paintHubFocus() {
    const focusing = this.area === 'hub';
    if (!focusing) document.getElementById('statusbar').classList.remove('scrolled');
    this.hubEl.querySelectorAll('[data-h]').forEach(n => {
      const on = focusing && Number(n.dataset.h) === this.hubSel;
      n.classList.toggle('sel', on);
      n.classList.toggle('focus-ring', on && !n.classList.contains('tile'));
    });
    if (!this.hub) return;
    // keep the focused card on screen
    const strip = this.hubEl.querySelector('.hub-cards:not(.vertical)');
    if (strip) {
      const card = strip.querySelector(`[data-h="${this.hubSel}"]`);
      let shift = 0;
      if (focusing && card) {
        const r = remPx();
        const right = (card.offsetLeft + card.offsetWidth) / r;
        const vw = vwRem();
        if (right > vw - 6) shift = right - (vw - 6);
      }
      strip.style.transform = `translateX(${-shift}rem)`;
    }
    let extra = 0;
    if (focusing && this.hub.vertical) {
      const item = this.hubEl.querySelector(`[data-h="${this.hubSel}"]`);
      if (item) extra = Math.max(0, item.offsetTop / remPx() - 1);
    }
    if (this.hub.kind === 'folder') this.layoutFolder();
    // PS5: the cards under Play come up into view; other hubs already sit in the middle of the screen
    const shift = !ps5() ? this.hub.shift : this.hub.grid5 ? (this.hubSel >= 2 ? 48 : 0) : this.hub.kind === 'folder' ? 0 : 34;
    if (this.hub.hero5) {
      const h = this.hubEl.querySelector('.p5-hero');
      const html = this.hub.hero5(focusing ? this.hubSel : 0);
      if (h && h._html !== html) { h.innerHTML = html; h._html = html; }
    }
    const scrolled = !!(focusing && (shift || extra));
    this.scroller.style.transform = scrolled ? `translateY(${-(shift + extra)}rem)` : '';
    document.getElementById('statusbar').classList.toggle('scrolled', scrolled);
  }

  hubFor(it) {
    if (ps5() && it.kind === 'library') return null; // PS5-ish: More Games just opens the grid of all games
    const h = this.hubFor4(it);
    if (!ps5() || !h || !TEXT5[it.kind]) return h;
    const [kicker, title, desc] = TEXT5[it.kind];
    return { ...h, vertical: false, html: `<div class="p5-hero p5-text">${hero5(kicker, title, desc)}</div>${h.html.replace('class="hub-cards', 'class="hub-cards p5-cards')}` };
  }

  hubFor4(it) {
    if (it.kind === 'game') return this.gameHub(it.g);
    if (it.kind === 'whatsnew') return ps5() ? this.exploreHub() : this.whatsNewHub();
    if (it.kind === 'import') return this.importHub();
    if (it.kind === 'library') return this.libraryHub();
    if (it.kind === 'youtube') return this.youtubeHub();
    if (it.kind === 'store') return this.storeHub();
    if (it.kind === 'media') return this.mediaHub();
    if (it.kind === 'gallery') return this.galleryHub();
    if (it.kind === 'folder') return this.folderHub(it.f);
    return null;
  }

  gameHub(g) {
    const hero = media(g, 'hero') || backdrop(g);
    const logo = media(g, 'logo');
    const m = g.meta || {};
    const running = isRunning(g.id);
    const vertical = ctx.settings.hubLayout !== 'horizontal';
    const metaLine = [m.developers && m.developers[0], m.genres && m.genres.slice(0, 2).join(', '), m.releaseDate].filter(Boolean).join('  ·  ');
    const latest = gameNews(g.id)[0];
    const hasSong = !!g.media.music;
    const cards = [];
    const add = (html, run) => cards.push({ html: html.replace('data-h="#"', `data-h="${cards.length}"`), run });
    if (ps5()) {
      add(`<div class="p5-play" data-h="#">${running ? 'Running' : 'Play Game'}</div>`, () => launchGame(g, this.hubEl.querySelector('.p5-play')));
      add(`<div class="p5-more" data-h="#">${icon('dots')}</div>`, () => gameOptions(g));
    } else add(`<div class="card card-start" data-h="#">${hero ? `<img class="bg" src="${hero}" style="${media(g, 'hero') ? adjustStyle((g.artAdjust || {}).hero) : ''}">` : ''}${logo ? `<img class="logo" src="${logo}">` : `<div class="start-name">${esc(g.name)}</div>`}
      <div class="start-label">${icon('playFill')}${running ? 'Running' : 'Start'}</div></div>`, () => launchGame(g, this.hubEl.querySelector('[data-h="0"]')));
    add(`<div class="card card-info" data-h="#"><div class="card-pad"><h3>Information</h3>
      <p>${esc(m.description || 'No description yet. Choose "Link Artwork" to match this game with the Steam store.')}</p>
      ${metaLine ? `<div class="meta">${esc(metaLine)}</div>` : ''}</div></div>`, () => showInfo(g));
    add(`<div class="card card-stats" data-h="#"><div class="card-pad"><h3>Play Time</h3><div class="big">${esc(g.playtime >= 60 ? fmtPlaytime(g.playtime) : '0h')}</div>
      <div class="rows"><div><span class="muted">Last played</span><span>${esc(timeAgo(g.lastPlayed))}</span></div>
      <div><span class="muted">Times played</span><span>${g.playCount || 0}</span></div></div></div></div>`, () => showInfo(g));
    {
      const sup = controllerSupport(g);
      const pad = connectedPad();
      const psIcon = padStyle(ctx.settings) === 'ps5' ? 'ps5' : 'ps4';
      const row = (kind, label, level) => `<div class="ctl-row ${pad === kind ? 'mine' : ''} lvl-${level || 'unknown'}">${controllerIcon(kind === 'playstation' ? psIcon : kind)}
        <span class="ctl-name">${label}${pad === kind ? '<em>Connected</em>' : ''}</span><span class="ctl-lvl">${level ? SUPPORT_LABEL[level] : 'Unknown'}</span></div>`;
      add(`<div class="card card-controls" data-h="#"><div class="card-pad"><h3>Controls</h3>
        <div class="ctl-rows">${row('playstation', 'PlayStation Controller', sup.playstation)}${row('xbox', 'Xbox Controller', sup.xbox)}${row('keyboard', 'Keyboard &amp; Mouse', sup.keyboard)}</div>
        <p class="ctl-note">${esc(controllerAdvice(g, pad))}</p></div></div>`, () => { sfx('accept'); showInfo(g); });
    }
    if (latest) {
      add(`<div class="card card-news" data-h="#"><div class="n-img" style="background-image:url('${esc(latest.image || cardArt(g) || '')}')"></div>
        <div class="card-pad"><h3>News</h3><div class="n-title">${esc(latest.title)}</div><div class="n-date">${esc(timeAgo(latest.date))}</div></div></div>`, () => showArticle(latest));
    }
    if (m.steamAppId) {
      const pic = backdrop(g);
      add(`<div class="card card-news card-gallery" data-h="#"><div class="n-img" style="background-image:url('${esc(pic || '')}')"></div>
        <div class="card-pad"><h3>Screenshots &amp; Art</h3><div class="n-title">Browse official pictures and set any of them as the wallpaper</div><div class="n-date">${icon('image')} Pictures</div></div></div>`, () => gallery(g.id));
    }
    add(`<div class="card card-details" data-h="#"><div class="card-pad"><h3>Details</h3><span class="src">${esc(SOURCES[g.source] || g.source)}${g.installed ? '' : ' · Not installed'}</span>
      <div class="path">${esc(g.installDir || g.launch.target || '')}</div><div class="action">${icon('folder')} Open install folder</div></div></div>`, () => { sfx('accept'); api.openGameFolder(g.id); });
    add(`<div class="card card-action" data-h="#"><div class="card-pad">${icon('star', 'big')}<div><h3>${g.favorite ? 'Favorite' : 'Add to Favorites'}</h3><p>${g.favorite ? 'Remove it from your favorites.' : 'Pin it to the Favorites list in your library.'}</p></div></div></div>`,
      () => { sfx('accept'); api.updateGame(g.id, { favorite: !g.favorite }); toast({ title: g.favorite ? 'Removed from Favorites' : 'Added to Favorites', body: g.name, ico: 'star' }); });
    add(`<div class="card card-action" data-h="#"><div class="card-pad">${icon('music', 'big')}<div><h3>Theme Song</h3><p>${hasSong ? 'Plays while you look at this game. Change or remove it.' : ctx.state.ytdlp ? 'Find this game\'s theme song, or pick a music file.' : 'Pick a music file to play while you look at this game.'}</p></div></div></div>`, () => themeSongMenu(g));
    add(`<div class="card card-action" data-h="#"><div class="card-pad">${icon('edit', 'big')}<div><h3>Edit Game Details</h3><p>Rename it, change its artwork, wallpaper or theme song.</p></div></div></div>`, () => editGame(g.id));
    add(`<div class="card card-action" data-h="#"><div class="card-pad">${icon('link', 'big')}<div><h3>Link Artwork</h3><p>Pick the matching game to get its cover, wallpaper and logo.</p></div></div></div>`, () => linkArtwork(g));
    if (ps5()) {
      // PS5-ish's card in the bottom-right corner: Time Played / Last Played over a row of three small counts with its
      // trophy pictures (PC4 has no trophies: beaten/completed, times played, the library)
      const done = ['Beaten', 'Completed'].includes(g.completion);
      const played = g.playtime >= 60 ? fmtPlaytime(g.playtime) : g.playtime ? 'Under a minute' : 'Never';
      const stats = `<div class="p5-stats"><div class="p5-st"><span>Time Played</span><b>${esc(played)}</b></div>
        <div class="p5-st"><span>Last Played</span><b>${esc(g.lastPlayed ? new Date(g.lastPlayed).toLocaleDateString() : 'Never')}</b></div>
        <div class="p5-tro"><span title="Beaten"><img src="${P5_IMG('trophy-gold.png')}" alt="">${done ? 1 : 0}</span><span title="Times played"><img src="${P5_IMG('trophy-silver.png')}" alt="">${g.playCount || 0}</span><span title="Library"><img src="${P5_IMG('trophy-bronze.png')}" alt="">${esc(SOURCES[g.source] || 'PC')}</span></div></div>`;
      return {
        kind: 'cards', grid5: true, count: cards.length, shift: 0,
        html: `<div class="p5-hero p5-game">
          <div class="p5-actions">${cards[0].html}${cards[1].html}</div>${stats}</div>
          <div class="hub-cards p5-cards">${cards.slice(2).map(c => c.html).join('')}</div>`,
        activate: i => cards[i] && cards[i].run(),
        options: () => gameOptions(g),
      };
    }
    return {
      kind: 'cards', count: cards.length, shift: 34, vertical,
      html: `<div class="hub-cards ${vertical ? 'vertical' : ''}">${cards.map(c => c.html).join('')}</div>`,
      activate: i => cards[i] && cards[i].run(),
      options: () => gameOptions(g),
    };
  }

  actionCards(list) {
    return `<div class="hub-cards">${list.map((c, i) => `<div class="card card-action" data-h="${i}"><div class="card-pad">${icon(c.icon, 'big')}<div><h3>${esc(c.label)}</h3><p>${esc(c.desc)}</p></div></div></div>`).join('')}</div>`;
  }

  importHub() {
    const list = [
      { icon: 'refresh', label: 'Scan All Launchers', desc: 'Find installed games from Steam, Epic Games and GOG.', run: () => runImport() },
      { icon: 'bag', label: 'Steam', desc: 'Import your installed Steam games.', run: () => runImport(['steam']) },
      { icon: 'bag', label: 'Epic Games', desc: 'Import games from the Epic Games Launcher.', run: () => runImport(['epic']) },
      { icon: 'bag', label: 'GOG Galaxy', desc: 'Import games installed with GOG Galaxy.', run: () => runImport(['gog']) },
      { icon: 'exe', label: 'Add a Game', desc: 'Browse for any .exe or shortcut on your PC.', run: () => addExe() },
      { icon: 'image', label: 'Refresh All Artwork', desc: 'Download covers for games that are missing them.', run: () => { api.refreshAllMetadata(); } },
    ];
    return {
      kind: 'cards', count: list.length, shift: 34, html: this.actionCards(list),
      activate: i => { sfx('accept'); list[i].run(); },
    };
  }

  // cards with a picture (Store / Gallery): the picture on top, the words below
  pictureCards(list) {
    return `<div class="hub-cards">${list.map((c, i) => `<div class="card card-pic" data-h="${i}"><div class="cp-img">${c.image ? `<img src="${esc(c.image)}" loading="lazy" decoding="async" alt="">` : icon(c.icon || 'image', 'big')}${c.tag ? `<span class="cp-tag ${c.tagCls || ''}">${esc(c.tag)}</span>` : ''}</div>
      <div class="card-pad"><h3>${esc(c.label)}</h3><p>${esc(c.desc || '')}</p></div></div>`).join('')}</div>`;
  }

  storeHub() {
    if (!this.shopData && !this.shopLoading) {
      this.shopLoading = true;
      api.shop().then(d => { this.shopData = d; this.shopLoading = false; if (this.items[this.sel] && this.items[this.sel].kind === 'store') this.renderHub(true); }).catch(() => { this.shopLoading = false; });
    }
    const d = this.shopData;
    const day = iso => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const list = [];
    if (d) {
      d.epic.now.slice(0, 3).forEach(g => list.push({ image: g.image, tag: 'FREE NOW', tagCls: 'free', label: g.name, desc: `Free on Epic until ${day(g.end)}`, run: () => openStore(0) }));
      d.epic.soon.slice(0, 1).forEach(g => list.push({ image: g.image, tag: 'FREE NEXT', tagCls: 'soon', label: g.name, desc: `Free on Epic from ${day(g.start)}`, run: () => openStore(0) }));
      const deal = d.steam.deals[0];
      if (deal) list.push({ image: deal.image, tag: `−${deal.discount}%`, label: 'Steam Deals', desc: `${deal.name} and more`, run: () => openStore(1) });
    }
    list.push({ icon: 'store', label: 'Open Game Store', desc: 'Free games, deals, top sellers and new releases', run: () => openStore(0) });
    return { kind: 'cards', count: list.length, shift: 34, html: this.pictureCards(list), activate: i => { sfx('accept'); list[i].run(); } };
  }

  mediaHub() {
    const list = [];
    if (Player.active) list.push({ icon: 'music', label: 'Now Playing', desc: `${Player.current.title || ''}${Player.current.artist ? ` · ${Player.current.artist}` : ''}`, run: () => nowPlaying() });
    list.push({ icon: 'media', label: 'Open Media Player', desc: 'Videos and music on this PC', run: () => openMedia() });
    list.push({ icon: 'search', label: 'Search Music', desc: 'Play songs from YouTube Music, also while you play', run: async () => { const q = await textInput({ title: 'Search YouTube Music' }); if (q && q.trim()) songResults(q.trim()); } });
    return { kind: 'cards', count: list.length, shift: 34, html: this.actionCards(list), activate: i => { sfx('accept'); list[i].run(); } };
  }

  galleryHub() {
    if (!this.caps && !this.capsLoading) {
      this.capsLoading = true;
      api.listCaptures().then(c => { this.caps = c.slice(0, 4); this.capsLoading = false; if (this.items[this.sel] && this.items[this.sel].kind === 'gallery') this.renderHub(true); setTimeout(() => { this.caps = null; }, 30000); });
    }
    const list = (this.caps || []).map(c => ({ image: c.kind === 'screenshot' ? fileUrlOf(c.file) : null, icon: 'film', label: c.game, desc: new Date(c.time).toLocaleString(), run: () => openGallery() }));
    list.push({ icon: 'gallery', label: 'Open Capture Gallery', desc: 'Screenshots and clips. SHARE: screenshot · hold SHARE: record', run: () => openGallery() });
    return { kind: 'cards', count: list.length, shift: 34, html: this.pictureCards(list), activate: i => { sfx('accept'); list[i].run(); } };
  }

  youtubeHub() {
    const list = [
      { icon: 'play', label: 'Start', desc: 'Watch YouTube with your controller, just like on a TV.', run: () => openYouTube() },
      { icon: 'user', label: 'Sign In', desc: 'Open YouTube, choose Sign In, then enter the code on your phone.', run: () => openYouTube() },
      { icon: 'gamepad', label: 'Controls', desc: `${padText('square')} Play/Pause · ${padText('triangle')} Search · ${padText('l2')}/${padText('r2')} −10s/+10s · ${padText('l1')}/${padText('r1')} Previous/Next Video · ${padStyle(ctx.settings) === 'xbox' ? 'View' : 'PS'} button: back to PC4`, run: () => openYouTube() },
      { icon: 'exit', label: 'Sign Out', desc: 'Forget your account and history on this PC.', run: () => clearYouTube() },
    ];
    return {
      kind: 'cards', count: list.length, shift: 34, html: this.actionCards(list),
      activate: i => { sfx('accept'); list[i].run(); },
    };
  }

  libraryHub() {
    const all = games();
    const cats = [
      { id: 'all', label: 'All', n: all.filter(g => g.installed).length },
      ...(ctx.state.folders.length ? [{ id: 'folders', label: 'Folders', n: ctx.state.folders.length }] : []),
      { id: 'favorites', label: 'Favorites', n: all.filter(g => g.favorite).length },
      { id: 'recent', label: 'Recently Played', n: all.filter(g => g.lastPlayed).length },
      { id: 'purchased', label: 'Purchased', n: all.length },
      ...Object.keys(SOURCES).map(s => ({ id: 'src:' + s, label: SOURCES[s], n: all.filter(g => g.source === s).length })).filter(c => c.n),
    ];
    return {
      kind: 'cards', count: cats.length, shift: 34,
      html: `<div class="hub-cards">${cats.map((c, i) => `<div class="card card-action card-count" data-h="${i}"><div class="card-pad"><div class="num">${c.n}</div><h3>${esc(c.label)}</h3></div></div>`).join('')}</div>`,
      activate: i => { sfx('accept'); this.nav.openLibrary(cats[i].id); },
    };
  }

  whatsNewHub() {
    const all = games();
    const running = ctx.state.running.map(gameById).filter(Boolean)[0];
    const last = [...all].filter(g => g.lastPlayed).sort(SORTS.recent.fn)[0];
    const trends = (ctx.industry && ctx.industry.trends) || null;
    let entries = newsFeed(activityFeed(12));
    if (!entries.length) entries = [{ kind: 'welcome', html: `Welcome to <b>PC4</b>. Open <b>Game Import</b> to bring in your Steam, Epic and GOG games, or add any game by its .exe.`, ts: Date.now() }];
    // "Trending Now" leads the feed, like the featured tile on the PS4's What's New
    if (trends && trends.mostPlayed && trends.mostPlayed.length && ctx.settings.industryNews !== false) entries.unshift({ kind: 'trending' });
    const np = running || last;
    // pictures load only when they scroll into view, so a long feed stays light
    // (a picture a site refuses to share falls back to the site's name, see app.js)
    const pic = (url, label = '') => `<div class="n-img" data-label="${esc(label)}">${url ? `<img src="${esc(url)}" loading="lazy" decoding="async" alt="">` : ''}</div>`;
    const entryHtml = (a, i) => {
      if (a.kind === 'trending') {
        const top = trends.mostPlayed.slice(0, 5);
        return `<div class="wn-entry trending" data-h="${i}"><div class="tr-strip">${top.map(t => `<img src="${esc(t.image)}" loading="lazy" decoding="async" alt="">`).join('')}</div>
          <div class="txt"><span class="n-game">Trending Now on Steam</span><span class="n-title">${esc(top[0].name)} leads with ${esc(trendLine(top[0], 'mostPlayed').split(' · ')[1])}</span><span class="when">Most played, top sellers, new releases and deals</span></div></div>`;
      }
      if (a.kind === 'industry') {
        return `<div class="wn-entry news industry" data-h="${i}">${pic(a.image, a.sourceName)}
          <div class="txt"><span class="n-game">${esc(a.sourceName)}</span><span class="n-title">${esc(a.title)}</span><span class="when">${timeAgo(a.date)}</span></div></div>`;
      }
      if (a.kind === 'news') {
        const g = gameById(a.gameId);
        return `<div class="wn-entry news" data-h="${i}">${pic(a.image || (g && cardArt(g)))}
          <div class="txt"><span class="n-game">${esc(g ? g.name : 'News')}</span><span class="n-title">${esc(a.title)}</span><span class="when">${timeAgo(a.date)}</span></div></div>`;
      }
      if (a.kind === 'post') {
        const img = a.image ? `${ctx.state.mediaDir}/_posts/${a.image}` : null;
        return `<div class="wn-entry news post" data-h="${i}">${img ? `<div class="n-img" style="background-image:url('${esc(fileUrlOf(img))}')"></div>` : `<div class="thumb"><div class="art">${sysArt('shapes')}</div></div>`}
          <div class="txt"><span class="n-game">${esc(ctx.settings.profileName)} posted</span><span class="n-title">${esc(a.title)}</span><span class="when">${timeAgo(a.ts)}</span></div></div>`;
      }
      return `<div class="wn-entry" data-h="${i}"><div class="thumb"><div class="art">${a.g ? gameArt(a.g) : sysArt('shapes')}</div></div>
        <div class="txt">${a.html}<span class="when">${a.kind === 'welcome' ? 'Getting started' : timeAgo(a.ts)}</span></div></div>`;
    };
    const sideList = (title, list, key) => list && list.length ? `<section><h4>${title}</h4>${list.slice(0, 4).map(t => `<div class="tr-mini"><img src="${esc(t.image)}" loading="lazy" decoding="async" alt=""><span><b>${esc(t.name)}</b><br><span class="muted">${esc(trendLine(t, key))}</span></span></div>`).join('')}</section>` : '';
    const html = `<div class="wn"><div class="wn-feed">${entries.map(entryHtml).join('')}</div>
      <div class="wn-side">
        ${np ? `<section><h4>${running ? 'Now Playing' : 'Continue Playing'}</h4><div class="np"><div class="thumb"><div class="art">${gameArt(np)}</div></div><span>${esc(np.name)}<br><span class="muted" style="font-size:2.1rem">${running ? 'Running' : timeAgo(np.lastPlayed)}</span></span></div></section>` : ''}
        ${trends && ctx.settings.industryNews !== false ? sideList('Top Sellers', trends.topSellers, 'topSellers') + sideList('Deals', trends.deals, 'deals') : ''}
      </div></div>`;
    return {
      kind: 'feed', count: entries.length, shift: 34, html, vertical: true,
      activate: i => {
        const a = entries[i];
        if (!a) return;
        if (a.kind === 'trending') showTrending();
        else if (a.kind === 'news' || a.kind === 'post' || a.kind === 'industry') showArticle(a);
        else if (a.g) { sfx('accept'); showInfo(a.g); }
        else if (a.kind === 'welcome') { sfx('accept'); this.setArea('row'); this.select(0); }
        else sfx('bump');
      },
      options: i => whatsNewOptions(entries[i]),
    };
  }

  // PS5 Explore: the story in focus in big letters over its picture, the stories as cards along the bottom
  exploreHub() {
    const all = newsFeed(activityFeed(12)).filter(a => a.title && (a.kind === 'news' || a.kind === 'industry' || a.kind === 'post')).slice(0, 14);
    const imgOf = a => {
      if (a.kind === 'post') return a.image ? fileUrlOf(`${ctx.state.mediaDir}/_posts/${a.image}`) : null;
      const g = a.gameId ? gameById(a.gameId) : null;
      return a.image || (g && cardArt(g)) || null;
    };
    const who = a => a.kind === 'post' ? `${ctx.settings.profileName} posted` : a.sourceName || ((gameById(a.gameId) || {}).name) || 'News';
    const when = a => new Date(a.date || a.ts).toLocaleDateString();
    const text = a => (a.summary || a.body || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    const cards = all.map((a, i) => { const img = imgOf(a); return `<div class="card p5-news" data-h="${i}">${img ? `<img src="${esc(img)}" loading="lazy" decoding="async" alt="">` : ''}<span class="p5-cap">${esc(a.title)}</span></div>`; }).join('');
    const hero = i => {
      const a = all[i];
      return a ? hero5(`${who(a)}  |  ${when(a)}`, a.title, text(a)) : hero5('', 'Welcome to PC4', 'News about your games and the games industry shows up here.');
    };
    return {
      kind: 'cards', count: all.length, shift: 34,
      html: `<div class="p5-hero p5-text">${hero(0)}</div><div class="hub-cards p5-cards">${cards}</div>`,
      hero5: hero, bg: i => (all[i] ? imgOf(all[i]) : null),
      activate: i => all[i] && showArticle(all[i]),
      options: i => whatsNewOptions(all[i]),
    };
  }

  folderHub(f) {
    const list = f.gameIds.map(gameById).filter(g => g && !g.hidden).sort(SORTS.recent.fn);
    const html = list.length
      ? `<div class="fold-row">${list.map((g, i) => `<div class="tile" data-h="${i}"><div class="art">${gameArt(g)}</div></div>`).join('')}</div><div class="fold-caption"></div>`
      : `<div class="fold-empty">This folder is empty. Press OPTIONS on a game and choose "Add to Folder".</div>`;
    return {
      kind: 'folder', count: list.length, shift: 0, html, games: list,
      activate: i => list[i] && launchGame(list[i], this.hubEl.querySelector(`.fold-row [data-h="${i}"] .art`)),
      options: i => list[i] && gameOptions(list[i], { folder: f }),
    };
  }

  layoutFolder() {
    const tiles = [...this.hubEl.querySelectorAll('.fold-row .tile')];
    const focusing = this.area === 'hub';
    const start = 14;
    const bigW = 21;
    tiles.forEach((t, i) => {
      let x = start + i * STEP;
      if (focusing) {
        const first = Math.max(0, this.hubSel - 6);
        x = start + (i - first) * STEP;
        if (i > this.hubSel) x += bigW - T;
      }
      t.style.transform = `translate3d(${x}rem,0,0)`;
    });
    const cap = this.hubEl.querySelector('.fold-caption');
    if (cap && this.hub && this.hub.games) {
      const g = this.hub.games[this.hubSel];
      cap.textContent = g ? g.name : '';
      const first = Math.max(0, this.hubSel - 6);
      cap.style.left = `${start + (this.hubSel - first) * STEP}rem`;
    }
  }

  // ---------------- function area ----------------
  fnList() { return ps5() ? FN5 : FN; }

  // PS5: the avatar's menu holds what the PS4 keeps in its function area
  accountMenu() {
    openOptions({ title: ctx.settings.profileName, items: [
      { icon: 'user', label: 'Profile', action: () => showProfile() },
      { icon: 'bell', label: 'Notifications', action: () => showNotifications() },
      { icon: 'swap', label: 'Xbox Controller Emulation', action: () => this.nav.openSettings('emulation', { alone: true }) },
      { icon: 'pulse', label: 'Controller Test', action: () => openPadTest() },
      { icon: 'desktop', label: 'Desktop Mode', action: () => switchMode('desktop') },
      { icon: 'power', label: 'Power', action: () => powerMenu() },
    ] });
  }

  renderFn() {
    const list = this.fnList();
    this.fnSel = Math.min(this.fnSel, list.length - 1);
    const av = ps5() ? avatarUrl(ctx.state) : null;
    const face = f => f.id === 'account' ? `<span class="p5-avatar">${av ? `<img src="${av}" alt="">` : esc((ctx.settings.profileName || 'P')[0].toUpperCase())}<i></i></span>` : icon(f.icon);
    // PS5-ish: the focused icon's name sits under it
    this.fnRow.innerHTML = list.map((f, i) => `<div class="fn-item ${f.id === 'account' ? 'fn-avatar' : ''} ${i === this.fnSel ? 'sel focus-ring' : ''}" data-i="${i}">${face(f)}${ps5() ? `<span class="fn-cap">${esc(f.label)}</span>` : ''}</div>`).join('');
    const f = list[this.fnSel];
    this.fnLabel.innerHTML = `${esc(f.label)}${f.sub ? `<span class="fn-sub">${esc(f.sub)}</span>` : ''}`;
  }

  fnActivate() {
    const id = this.fnList()[this.fnSel].id;
    sfx('accept');
    if (id === 'search') { this.nav.searchLibrary(); return; }
    if (id === 'account') { this.accountMenu(); return; }
    if (id === 'import') { this.setArea('row'); this.select(0, false); this.setArea('hub'); }
    else if (id === 'notif') showNotifications();
    else if (id === 'profile') showProfile();
    else if (id === 'library') this.nav.openLibrary('all');
    else if (id === 'settings') this.nav.openSettings();
    else if (id === 'emulation') this.nav.openSettings('emulation', { alone: true });
    else if (id === 'padtest') openPadTest();
    else if (id === 'desktop') switchMode('desktop');
    else if (id === 'power') powerMenu();
  }

  setArea(a) {
    this.area = a;
    this.root.classList.toggle('area-row', a === 'row');
    this.root.classList.toggle('area-fn', a === 'fn');
    this.root.classList.toggle('area-hub', a === 'hub');
    if (a === 'fn') this.renderFn();
    this.paintHubFocus();
    this.updateBackdrop();
  }

  // ---------------- input ----------------
  handle(a, info) {
    if (a === 'home') {
      sfx('back');
      if (ps5() && this.tab !== 'all') { this.tab = 'all'; this.items = []; this.refresh(); }
      this.setArea('row'); this.select(this.homeIndex(), false); return;
    }
    // PS5: L1 / R1 move between the All, Favorites and Media tabs
    if (ps5() && (a === 'l1' || a === 'r1') && this.area !== 'hub') { if (!(info && info.repeat)) this.setTab(TABS5[TABS5.indexOf(this.tab) + (a === 'l1' ? -1 : 1)]); return; }
    if (this.area === 'row') return this.handleRow(a, info);
    if (this.area === 'fn') return this.handleFn(a);
    if (this.area === 'hub') return this.handleHub(a);
  }

  handleRow(a, info) {
    const it = this.items[this.sel];
    if (a === 'left' || a === 'wheel-up') this.select(this.sel - 1);
    else if (a === 'right' || a === 'wheel-down') this.select(this.sel + 1);
    else if (a === 'l1') { if (!(info && info.repeat)) this.select(0); } // all the way to the start / end of the row
    else if (a === 'r1') { if (!(info && info.repeat)) this.select(this.items.length - 1); }
    else if (a === 'up') { sfx('move'); this.setArea('fn'); }
    else if (a === 'down') {
      if (this.hub && this.hub.count) { sfx('move'); this.hubSel = 0; this.setArea('hub'); }
      else sfx('bump');
    } else if (a === 'accept') {
      if (!it) return;
      if (it.kind === 'game') launchGame(it.g, this.tileEls.get(it.key).querySelector('.art'));
      else if (it.kind === 'library') { sfx('accept'); this.nav.openLibrary('all'); }
      else if (it.kind === 'youtube') openYouTube();
      else if (it.kind === 'store') openStore(0);
      else if (it.kind === 'media') openMedia();
      else if (it.kind === 'gallery') openGallery();
      else if (this.hub && this.hub.count) { sfx('accept'); this.hubSel = 0; this.setArea('hub'); }
      else sfx('bump');
    } else if (a === 'options') {
      if (it && it.kind === 'game') gameOptions(it.g);
      else if (it && it.kind === 'folder') folderOptions(it.f);
      else if (it && it.kind === 'whatsnew') whatsNewOptions(null);
      else sfx('bump');
    } else if (a === 'triangle') { sfx('accept'); this.nav.openLibrary('all'); }
  }

  handleFn(a) {
    if (a === 'left') { if (this.fnSel > 0) { this.fnSel--; sfx('move'); this.renderFn(); } else sfx('bump'); }
    else if (a === 'right') { if (this.fnSel < this.fnList().length - 1) { this.fnSel++; sfx('move'); this.renderFn(); } else sfx('bump'); }
    else if (a === 'down' || a === 'back') { sfx(a === 'back' ? 'back' : 'move'); this.setArea('row'); }
    else if (a === 'accept') this.fnActivate();
    else if (a === 'up') sfx('bump');
  }

  handleHub(a) {
    const h = this.hub;
    if (!h) { this.setArea('row'); return; }
    if (h.grid5) return this.handleHub5(a);
    const vertical = h.vertical;
    const prev = vertical ? 'up' : 'left';
    const next = vertical ? 'down' : 'right';
    if (a === prev || (a === 'wheel-up')) {
      if (this.hubSel > 0) { this.hubSel--; sfx('move'); this.paintHubFocus(); this.updateBackdrop(); }
      else if (vertical) { sfx('move'); this.setArea('row'); }
      else sfx('bump');
    } else if (a === next || a === 'wheel-down') {
      if (this.hubSel < h.count - 1) { this.hubSel++; sfx('move'); this.paintHubFocus(); this.updateBackdrop(); }
      else sfx('bump');
    } else if ((a === 'up' && !vertical) || a === 'back') {
      sfx(a === 'back' ? 'back' : 'move');
      this.setArea('row');
    } else if (a === 'down' && !vertical) sfx('bump');
    else if (a === 'left' || a === 'right') sfx('bump');
    else if (a === 'accept') h.activate(this.hubSel);
    else if (a === 'options') { if (h.options) h.options(this.hubSel); else sfx('bump'); }
  }

  // PS5 game hub: Play and ··· side by side, the cards in a row below them
  handleHub5(a) {
    const h = this.hub;
    const i = this.hubSel;
    const go = n => { this.hubSel = n; sfx('move'); this.paintHubFocus(); };
    if (i < 2) {
      if (a === 'left') { if (i === 1) go(0); else sfx('bump'); }
      else if (a === 'right') { if (i === 0) go(1); else sfx('bump'); }
      else if (a === 'down' || a === 'wheel-down') { if (h.count > 2) go(2); else sfx('bump'); }
      else if (a === 'up' || a === 'back' || a === 'wheel-up') { sfx(a === 'back' ? 'back' : 'move'); this.setArea('row'); }
      else if (a === 'accept') h.activate(i);
      else if (a === 'options') h.options();
      return;
    }
    if (a === 'left' || a === 'wheel-up') { if (i > 2) go(i - 1); else sfx('bump'); }
    else if (a === 'right' || a === 'wheel-down') { if (i < h.count - 1) go(i + 1); else sfx('bump'); }
    else if (a === 'up') go(0);
    else if (a === 'back') { sfx('back'); this.setArea('row'); }
    else if (a === 'down') sfx('bump');
    else if (a === 'accept') h.activate(i);
    else if (a === 'options') h.options();
  }

  onShow() {
    this.refresh();
    this.updateBackdrop();
  }
}
