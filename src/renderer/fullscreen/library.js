// The PS4 Library app: Search and categories on the left (All, Folders, …, Purchased), a title with Sort at
// the top right, and a grid of square icons with their names, carrying PS4-style badges.
import { ctx, el, games, gameArt, folderArt, gameById, isRunning, subscribe, hintsHtml } from './core.js';
import { sfx } from './sound.js';
import { esc, icon, SOURCES, SORTS } from '../common/util.js';
import { launchGame, gameOptions, folderOptions } from './actions.js';
import { openOptions, textInput } from './ui.js';

const TILE = 19;
const GAP_X = 2.4;
const ROW_H = 19 + 1.2 + 5 + 3.4;
const NEW_FOR = 7 * 24 * 3600 * 1000; // "NEW" for a week after being added, until first played
const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize);

export class Library {
  constructor(root, nav) {
    this.nav = nav;
    this.root = el(`<div id="library" class="screen hidden">
      <div class="lib-side">
        <div class="lib-title">Library</div>
        <div class="list"></div>
      </div>
      <div class="lib-main">
        <div class="lib-head"><span class="ttl"></span><span class="cnt"></span><span class="lib-sort" data-sort="1"></span></div>
        <div class="lib-grid-wrap"><div class="lib-grid"></div></div>
      </div>
      <div class="hints">${hintsHtml([['cross', 'Select'], ['triangle', 'Search'], ['options', 'Options'], ['circle', 'Back']])}</div></div>`);
    root.appendChild(this.root);
    this.sideList = this.root.querySelector('.lib-side .list');
    this.grid = this.root.querySelector('.lib-grid');
    this.wrap = this.root.querySelector('.lib-grid-wrap');
    this.sortEl = this.root.querySelector('.lib-sort');
    this.focus = 'side';      // 'side' | 'sort' | 'grid'
    this.sideSel = 1;         // cursor in the left column (0 = Search)
    this.cat = 'all';
    this.folder = null;       // a folder opened from the Folders category
    this.gridSel = 0;
    this.firstRow = 0;
    this.sort = 'recent';
    this.search = '';
    this.items = [];
    this.open_ = false;

    this.sideList.addEventListener('click', e => {
      const c = e.target.closest('[data-side]');
      if (!c) return;
      this.focus = 'side';
      this.sideSel = Number(c.dataset.side);
      this.activateSide();
    });
    this.sortEl.addEventListener('click', () => { this.focus = 'sort'; this.paint(); this.sortMenu(); });
    this.grid.addEventListener('click', e => {
      const it = e.target.closest('[data-i]');
      if (!it) return;
      const i = Number(it.dataset.i);
      if (this.focus === 'grid' && i === this.gridSel) this.handle('accept');
      else { this.focus = 'grid'; this.gridSel = i; this.paint(); sfx('move'); }
    });
    this.grid.addEventListener('contextmenu', e => {
      e.preventDefault();
      const it = e.target.closest('[data-i]');
      if (!it) return;
      this.focus = 'grid'; this.gridSel = Number(it.dataset.i); this.paint();
      this.handle('options');
    });
    subscribe(() => { if (this.open_) this.render(); });
    window.addEventListener('resize', () => this.open_ && this.paint());
  }

  // left column: Search, then the categories (PS4 order), then launchers
  sideItems() {
    const all = games();
    const installed = all.filter(g => g.installed);
    const hidden = ctx.state.games.filter(g => g.hidden);
    const out = [
      { id: 'search' },
      { id: 'all', label: 'All', n: installed.length },
      ctx.state.folders.length && { id: 'folders', label: 'Folders', n: ctx.state.folders.length },
      { id: 'favorites', label: 'Favorites', n: all.filter(g => g.favorite).length },
      { id: 'recent', label: 'Recently Played', n: all.filter(g => g.lastPlayed).length },
      { id: 'purchased', label: 'Purchased', n: all.length },
      { sep: 'Launchers' },
      ...Object.keys(SOURCES).map(s => ({ id: 'src:' + s, label: SOURCES[s], n: all.filter(g => g.source === s).length })).filter(c => c.n),
      hidden.length && { sep: '' },
      hidden.length && { id: 'hidden', label: 'Hidden', n: hidden.length },
    ];
    return out.filter(Boolean);
  }

  itemsFor(cat) {
    if (cat === 'folders' && !this.folder) {
      return ctx.state.folders.map(f => ({ kind: 'folder', f }));
    }
    let list;
    if (this.folder) {
      const ids = new Set(this.folder.gameIds);
      list = games().filter(g => ids.has(g.id));
    } else if (cat === 'hidden') list = ctx.state.games.filter(g => g.hidden);
    else {
      list = games();
      if (cat === 'all') list = list.filter(g => g.installed);
      else if (cat === 'favorites') list = list.filter(g => g.favorite);
      else if (cat === 'recent') list = list.filter(g => g.lastPlayed);
      else if (cat.startsWith('src:')) list = list.filter(g => g.source === cat.slice(4));
    }
    if (this.search) {
      const q = this.search.toLowerCase();
      list = list.filter(g => g.name.toLowerCase().includes(q));
    }
    const sort = cat === 'recent' ? 'recent' : this.sort;
    return [...list].sort(SORTS[sort].fn).map(g => ({ kind: 'game', g }));
  }

  open(cat = 'all') {
    this.open_ = true;
    const map = { installed: 'all', all: 'all' };
    this.cat = map[cat] || cat;
    if (!this.sideItems().some(c => c.id === this.cat)) this.cat = 'all';
    this.sideSel = Math.max(1, this.sideItems().findIndex(c => c.id === this.cat));
    this.folder = null;
    this.gridSel = 0;
    this.firstRow = 0;
    this.search = '';
    this.render();
    this.focus = this.items.length ? 'grid' : 'side';
    this.paint();
    this.root.classList.remove('hidden');
  }

  close() {
    this.open_ = false;
    this.root.classList.add('hidden');
  }

  setCat(id) {
    if (id === this.cat && !this.folder) return;
    this.cat = id;
    this.folder = null;
    this.gridSel = 0;
    this.firstRow = 0;
    this.render();
  }

  // the PS4 badges drawn on top of a game's icon
  badges(g) {
    const isNew = !g.lastPlayed && Date.now() - (g.added || 0) < NEW_FOR;
    return `${isNew ? '<span class="b-new">NEW</span>' : ''}
      ${isRunning(g.id) ? `<span class="b-run">${icon('playFill')}</span>` : ''}
      ${g.favorite ? `<span class="b-fav">${icon('starFill')}</span>` : ''}
      ${g.installed ? '' : `<span class="b-dl" title="Not installed">${icon('download')}</span>`}`;
  }

  render() {
    if (this.folder) this.folder = ctx.state.folders.find(f => f.id === this.folder.id) || null;
    const side = this.sideItems();
    if (!side.some(c => c.id === this.cat)) { this.cat = 'all'; this.folder = null; }
    this.sideSel = Math.min(this.sideSel, side.length - 1);
    this.sideList.innerHTML = side.map((c, i) => {
      if (c.sep !== undefined) return `<div class="lib-sep"></div>${c.sep ? `<div class="lib-sechead">${esc(c.sep)}</div>` : ''}`;
      if (c.id === 'search') return `<div class="lib-search-box" data-side="${i}">${icon('search')}<span>${this.search ? esc(this.search) : 'Search'}</span></div>`;
      return `<div class="lib-cat ${c.id === this.cat ? 'active' : ''}" data-side="${i}"><span>${esc(c.label)}</span><span class="cnt">${c.n}</span></div>`;
    }).join('');

    this.items = this.itemsFor(this.cat);
    this.gridSel = Math.min(this.gridSel, Math.max(0, this.items.length - 1));
    const cat = side.find(c => c.id === this.cat);
    let title = cat ? cat.label : '';
    if (this.folder) title = `${title}  ›  ${this.folder.name}`;
    if (this.search) title = `Search: “${this.search}”`;
    this.root.querySelector('.ttl').textContent = title;
    this.root.querySelector('.lib-head .cnt').textContent = `${this.items.length} item${this.items.length === 1 ? '' : 's'}`;
    const sortKey = this.cat === 'recent' ? 'recent' : this.sort;
    this.sortEl.innerHTML = `${icon('sort')}<span>Sort: ${esc(SORTS[sortKey].label)}</span>`;
    this.sortEl.style.visibility = this.cat === 'folders' && !this.folder ? 'hidden' : '';

    const html = this.items.length
      ? this.items.map((it, i) => it.kind === 'folder'
        ? `<div class="lib-item folder" data-i="${i}"><div class="sq"><div class="art">${folderArt(it.f)}</div><span class="b-count">${it.f.gameIds.filter(gameById).length}</span></div><div class="nm">${esc(it.f.name)}</div></div>`
        : `<div class="lib-item ${it.g.installed ? '' : 'uninstalled'}" data-i="${i}"><div class="sq"><div class="art">${gameArt(it.g)}</div>${this.badges(it.g)}</div><div class="nm">${esc(it.g.name)}</div></div>`).join('')
      : `<div class="lib-empty">${this.search ? 'No games match your search.' : this.cat === 'folders' ? 'No folders yet. Press OPTIONS on a game and choose "Add to Folder".' : 'Nothing here yet.'}</div>`;
    if (this.grid._html !== html) { this.grid.innerHTML = html; this.grid._html = html; }
    this.paint();
  }

  cols() {
    const w = this.wrap.clientWidth / remPx();
    return Math.max(1, Math.floor((w - 2 + GAP_X) / (TILE + GAP_X)));
  }

  paint() {
    const cols = this.cols();
    this.grid.style.setProperty('--cols', cols);
    this.sideList.querySelectorAll('[data-side]').forEach(c => {
      const on = this.focus === 'side' && Number(c.dataset.side) === this.sideSel;
      c.classList.toggle('sel', on);
      c.classList.toggle('focus-ring', on);
    });
    this.sortEl.classList.toggle('sel', this.focus === 'sort');
    this.sortEl.classList.toggle('focus-ring', this.focus === 'sort');
    this.grid.querySelectorAll('.lib-item').forEach(n => {
      const on = this.focus === 'grid' && Number(n.dataset.i) === this.gridSel;
      n.classList.toggle('sel', on);
      n.querySelector('.sq').classList.toggle('focus-ring', on);
    });
    const row = Math.floor(this.gridSel / cols);
    const visible = Math.max(1, Math.floor((this.wrap.clientHeight / remPx()) / ROW_H));
    if (row < this.firstRow) this.firstRow = row;
    if (row >= this.firstRow + visible) this.firstRow = row - visible + 1;
    this.grid.style.transform = `translateY(${-this.firstRow * ROW_H}rem)`;
    // keep the cursor visible in a long left column
    const cur = this.sideList.querySelector(`[data-side="${this.sideSel}"]`);
    if (cur) {
      const side = this.root.querySelector('.lib-side');
      const limit = side.clientHeight - remPx() * 30;
      const off = Math.max(0, cur.offsetTop + cur.offsetHeight - limit);
      this.sideList.style.transform = `translateY(${-off}px)`;
    }
  }

  async searchPrompt() {
    const q = await textInput({ title: 'Search your library', value: this.search });
    if (q === null) return;
    this.search = q;
    this.folder = null;
    this.gridSel = 0;
    this.firstRow = 0;
    this.render();
    if (this.items.length) { this.focus = 'grid'; this.paint(); }
  }

  sortMenu() {
    openOptions({
      title: 'Sort',
      items: Object.entries(SORTS).map(([k, s]) => ({ label: s.label, icon: 'sort', value: this.sort === k ? '✓' : '', action: () => { this.sort = k; this.gridSel = 0; this.firstRow = 0; this.render(); } })),
    });
  }

  activateSide() {
    const it = this.sideItems()[this.sideSel];
    if (!it) return;
    if (it.id === 'search') { sfx('accept'); this.searchPrompt(); return; }
    this.setCat(it.id);
    if (this.items.length) { this.focus = 'grid'; sfx('accept'); this.paint(); } else sfx('bump');
  }

  handle(a) {
    if (a === 'back' || a === 'home') {
      if (a === 'back' && this.folder) { this.folder = null; this.gridSel = 0; this.firstRow = 0; sfx('back'); this.render(); return; }
      if (a === 'back' && this.search) { this.search = ''; sfx('back'); this.render(); return; }
      if (a === 'back' && this.focus !== 'side') { this.focus = 'side'; sfx('back'); this.paint(); return; }
      sfx('back');
      this.nav.closeScreen(this);
      return;
    }
    if (a === 'triangle') { sfx('accept'); this.searchPrompt(); return; }

    if (this.focus === 'side') {
      const side = this.sideItems();
      const step = d => {
        let n = this.sideSel + d;
        while (side[n] && side[n].sep !== undefined) n += d;
        if (!side[n]) { sfx('bump'); return; }
        this.sideSel = n;
        sfx('move');
        // moving onto a category shows it straight away, like the PS4
        if (side[n].id !== 'search') this.setCat(side[n].id); else this.paint();
      };
      if (a === 'up' || a === 'wheel-up') step(-1);
      else if (a === 'down' || a === 'wheel-down') step(1);
      else if (a === 'accept') this.activateSide();
      else if (a === 'right') { if (this.items.length) { this.focus = 'grid'; sfx('move'); this.paint(); } else sfx('bump'); }
      else if (a === 'options') this.sortMenu();
      return;
    }

    if (this.focus === 'sort') {
      if (a === 'accept' || a === 'options') this.sortMenu();
      else if (a === 'down') { if (this.items.length) { this.focus = 'grid'; sfx('move'); this.paint(); } }
      else if (a === 'left') { this.focus = 'side'; sfx('move'); this.paint(); }
      return;
    }

    const cols = this.cols();
    const n = this.items.length;
    const move = to => {
      if (to < 0 || to >= n) { sfx('bump'); return; }
      this.gridSel = to; sfx('move'); this.paint();
    };
    const cur = this.items[this.gridSel];
    if (a === 'left') {
      if (this.gridSel % cols === 0) { this.focus = 'side'; sfx('move'); this.paint(); }
      else move(this.gridSel - 1);
    } else if (a === 'right') move(this.gridSel + 1 < n && (this.gridSel + 1) % cols !== 0 ? this.gridSel + 1 : -1);
    else if (a === 'up' || a === 'wheel-up') {
      if (this.gridSel < cols && this.sortEl.style.visibility !== 'hidden') { this.focus = 'sort'; sfx('move'); this.paint(); }
      else move(this.gridSel - cols);
    } else if (a === 'down' || a === 'wheel-down') {
      if (this.gridSel + cols < n) move(this.gridSel + cols);
      else if (Math.floor(this.gridSel / cols) < Math.floor((n - 1) / cols)) move(n - 1);
      else sfx('bump');
    } else if (a === 'l1') move(Math.max(0, this.gridSel - cols * 3));
    else if (a === 'r1') move(Math.min(n - 1, this.gridSel + cols * 3));
    else if (a === 'accept' && cur) {
      if (cur.kind === 'folder') { sfx('accept'); this.folder = cur.f; this.gridSel = 0; this.firstRow = 0; this.render(); }
      else launchGame(cur.g, this.grid.querySelector(`.lib-item[data-i="${this.gridSel}"] .sq`));
    } else if (a === 'options' && cur) {
      if (cur.kind === 'folder') folderOptions(cur.f);
      else gameOptions(cur.g, { folder: this.folder });
    }
  }
}
