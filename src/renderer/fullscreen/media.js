// Media Player, like the PS4's: videos and music on this PC (Videos, Music, Downloads and any folders you
// add). Videos play full screen and remember where you stopped; music plays in the background.
import { ctx, api, el, pushLayer, removeLayer, hintsHtml } from './core.js';
import { sfx, Music } from './sound.js';
import { esc, icon, fileUrl } from '../common/util.js';
import { toast, openOptions, raise } from './ui.js';
import { Player, playFiles, fmtTime } from './player.js';

const COLS = 5;
const thumbs = new Map();       // path -> data URL | null
let open_ = false;

// pictures for the grid, a few at a time (Windows makes them: video frames, album covers)
const queue = [];
let busy = 0;
function thumbFor(path, cb) {
  if (thumbs.has(path)) { cb(thumbs.get(path)); return; }
  queue.push([path, cb]);
  pump();
}
function pump() {
  while (busy < 3 && queue.length) {
    const [p, cb] = queue.shift();
    if (thumbs.has(p)) { cb(thumbs.get(p)); continue; }
    busy++;
    api.mediaThumb(p).then(url => { thumbs.set(p, url); cb(url); }).catch(() => {}).finally(() => { busy--; pump(); });
  }
}

export async function openMedia() {
  if (open_) return;
  open_ = true;
  sfx('accept');
  const node = el(`<div class="layer app-screen media-app"><div class="as-head">${icon('media')}<h1>Media Player</h1><div class="md-path"></div></div>
    <div class="md-body"><div class="md-side"></div><div class="md-main"><div class="md-grid"></div></div></div>
    <div class="hints">${hintsHtml([['cross', 'Open'], ['triangle', 'Options'], ['circle', 'Back']])}</div></div>`);
  document.body.appendChild(raise(node));
  requestAnimationFrame(() => node.classList.add('in'));
  const side = node.querySelector('.md-side'), grid = node.querySelector('.md-grid');
  let roots = [], src = 0, zone = 'side', sel = 0, stack = [], items = [];

  const sideRows = () => [...roots, { name: 'Add a Folder…', icon: 'plus', add: true }];
  const loadRoots = async () => { roots = await api.mediaRoots(); };
  const load = async dir => { items = await api.mediaList(dir); sel = 0; render(); };

  const renderSide = () => {
    side.innerHTML = sideRows().map((r, i) => `<div class="md-src ${i === src ? 'on' : ''} ${zone === 'side' && i === src ? 'sel focus-ring' : ''}" data-s="${i}">${icon(r.icon)}<span>${esc(r.name)}</span></div>`).join('')
      + (Player.active ? `<div class="md-np" data-np="1">${icon('music')}<span><small>Now Playing</small>${esc(Player.current.title || '')}</span></div>` : '');
  };
  const renderGrid = () => {
    const root = roots[src];
    node.querySelector('.md-path').textContent = root ? [root.name, ...stack.map(p => p.split(/[\\/]/).pop())].join('  ›  ') : '';
    grid.innerHTML = items.length ? items.map((it, i) => `<div class="md-item ${it.kind} ${zone === 'grid' && i === sel ? 'sel focus-ring' : ''}" data-i="${i}">
      <div class="md-th" data-th="${esc(it.path)}">${icon(it.kind === 'folder' ? 'folderFill' : it.kind === 'video' ? 'film' : 'music')}</div>
      <div class="md-name">${esc(it.name.replace(/\.[^.]+$/, it.kind === 'folder' ? '$&' : ''))}</div></div>`).join('')
      : `<div class="pick-status">${roots.length ? 'No videos or music here.' : 'No media folders found.'}</div>`;
    // pictures: only for files near the selection
    grid.querySelectorAll('[data-th]').forEach((th, i) => {
      const it = items[i];
      if (!it || it.kind === 'folder' || Math.abs(i - sel) > COLS * 4) return;
      thumbFor(it.path, url => { if (url && th.isConnected && !th.querySelector('img')) th.innerHTML = `<img src="${url}" alt="">`; });
    });
    const s = grid.querySelector('.sel');
    if (s) s.scrollIntoView({ block: 'nearest' });
  };
  const render = () => { renderSide(); renderGrid(); };

  const openRoot = async i => {
    const r = sideRows()[i];
    if (!r) return;
    if (r.add) { const p = await api.mediaAddFolder(); if (p) { await loadRoots(); src = roots.findIndex(x => x.path === p); stack = []; await load(p); zone = 'grid'; render(); } return; }
    src = i; stack = []; zone = 'grid';
    await load(r.path);
  };

  const openItem = async i => {
    const it = items[i];
    if (!it) return;
    sfx('accept');
    if (it.kind === 'folder') { stack.push(it.path); await load(it.path); return; }
    if (it.kind === 'video') { const vids = items.filter(x => x.kind === 'video'); playVideo(vids, vids.indexOf(it)); return; }
    const songs = items.filter(x => x.kind === 'audio');
    await playFiles(songs.map(s => ({ file: s.path, thumb: thumbs.get(s.path) || null })), songs.indexOf(it));
    nowPlaying();
  };

  const options = () => {
    const r = roots[src], it = items[sel];
    const songs = items.filter(x => x.kind === 'audio');
    openOptions({
      title: 'Media Player',
      items: [
        songs.length && { label: 'Play All Music Here', icon: 'music', action: async () => { await playFiles(songs.map(s => ({ file: s.path })), 0); nowPlaying(); } },
        songs.length > 1 && { label: 'Shuffle', icon: 'refresh', action: async () => { const sh = songs.slice().sort(() => Math.random() - 0.5); await playFiles(sh.map(s => ({ file: s.path })), 0); nowPlaying(); } },
        Player.active && { label: 'Now Playing', icon: 'music', action: () => nowPlaying() },
        it && it.kind === 'video' && ctx.settings.mediaResume && ctx.settings.mediaResume[it.path] && { label: 'Play From the Beginning', icon: 'restart', action: () => { const vids = items.filter(x => x.kind === 'video'); playVideo(vids, vids.indexOf(it), true); } },
        it && zone === 'grid' && { label: 'Show in Folder', icon: 'folder', action: () => api.mediaShow(it.path) },
        { label: 'Add a Folder…', icon: 'plus', action: () => openRoot(sideRows().length - 1) },
        r && r.custom && { label: 'Remove This Folder', icon: 'trash', action: async () => { await api.mediaRemoveFolder(r.path); await loadRoots(); src = 0; stack = []; zone = 'side'; items = []; render(); } },
        { label: 'Refresh', icon: 'refresh', action: async () => { await loadRoots(); if (roots[src]) await load(stack.length ? stack[stack.length - 1] : roots[src].path); render(); } },
      ].filter(Boolean),
    });
  };

  const layer = {
    handle(a) {
      if (zone === 'side') {
        const n = sideRows().length;
        if (a === 'up' || a === 'wheel-up') { if (src > 0) { src--; sfx('move'); render(); } }
        else if (a === 'down' || a === 'wheel-down') { if (src < n - 1) { src++; sfx('move'); render(); } }
        else if (a === 'right' || a === 'accept') { sfx('accept'); openRoot(src); }
        else if (a === 'triangle') options();
        else if (a === 'back' || a === 'home') close();
        return;
      }
      const move = d => { const k = sel + d; if (k >= 0 && k < items.length) { sel = k; sfx('move'); renderGrid(); } };
      if (a === 'left') { if (sel % COLS) move(-1); else { zone = 'side'; sfx('move'); render(); } }
      else if (a === 'right') { if (sel % COLS < COLS - 1) move(1); }
      else if (a === 'up' || a === 'wheel-up') move(-COLS);
      else if (a === 'down' || a === 'wheel-down') move(Math.min(COLS, items.length - 1 - sel));
      else if (a === 'accept') openItem(sel);
      else if (a === 'triangle') options();
      else if (a === 'back') {
        sfx('back');
        if (stack.length) { stack.pop(); load(stack.length ? stack[stack.length - 1] : roots[src].path); }
        else { zone = 'side'; render(); }
      } else if (a === 'home') close();
    },
  };
  const close = () => {
    if (!open_) return;
    open_ = false;
    unsub();
    removeLayer(layer);
    node.classList.remove('in');
    setTimeout(() => node.remove(), 300);
    sfx('back');
  };
  side.addEventListener('click', e => { const s = e.target.closest('[data-s]'); if (s) { src = Number(s.dataset.s); openRoot(src); } else if (e.target.closest('[data-np]')) nowPlaying(); });
  grid.addEventListener('click', e => { const c = e.target.closest('[data-i]'); if (c) { zone = 'grid'; sel = Number(c.dataset.i); render(); openItem(sel); } });
  const unsub = Player.subscribe(() => renderSide());
  pushLayer(layer);
  await loadRoots();
  render();
  if (roots.length) openRoot(0).then(() => { zone = 'side'; render(); });
}

// ---------------- video player ----------------
export function playVideo(list, index, fromStart = false) {
  let i = index;
  const wasPlaying = Player.active && !Player.paused;
  if (wasPlaying) Player.toggle(); // the music waits
  Music.hold(300, 'video');
  const node = el(`<div class="layer vp"><video playsinline></video><div class="vp-ui"><div class="vp-title"></div>
    <div class="vp-bar"><span class="vp-t"></span><div class="vp-prog"><i></i></div><span class="vp-d"></span></div>
    <div class="vp-hints hints">${hintsHtml([['cross', 'Pause'], ['left', '−10 s'], ['right', '+10 s'], ['l1', ''], ['r1', 'Previous / Next'], ['triangle', 'Restart'], ['circle', 'Back']])}</div></div>
    <div class="vp-toast"></div></div>`);
  document.body.appendChild(raise(node));
  const v = node.querySelector('video');
  const ui = node.querySelector('.vp-ui');
  let hideT = 0, saveT = 0;
  const s = ctx.settings;
  v.volume = s.muteAll ? 0 : (s.masterVolume ?? 1);

  const showUi = () => { ui.classList.add('show'); clearTimeout(hideT); hideT = setTimeout(() => { if (!v.paused) ui.classList.remove('show'); }, 3000); };
  const flash = t => { const e = node.querySelector('.vp-toast'); e.textContent = t; e.classList.add('show'); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove('show'), 1600); };
  const saveResume = () => {
    const it = list[i]; if (!it || !v.duration) return;
    const map = { ...(ctx.settings.mediaResume || {}) };
    if (v.currentTime > 10 && v.currentTime < v.duration - 15) map[it.path] = Math.floor(v.currentTime); else delete map[it.path];
    const keys = Object.keys(map); if (keys.length > 200) delete map[keys[0]];
    ctx.settings.mediaResume = map;
    api.updateSettings({ mediaResume: map });
  };
  const tick = () => {
    const d = v.duration || 0;
    node.querySelector('.vp-t').textContent = fmtTime(v.currentTime);
    node.querySelector('.vp-d').textContent = fmtTime(d);
    node.querySelector('.vp-prog i').style.width = d ? `${(v.currentTime / d) * 100}%` : '0';
  };
  const load = (k, start = false) => {
    saveResume();
    i = k;
    const it = list[i];
    node.querySelector('.vp-title').textContent = it.name.replace(/\.[^.]+$/, '');
    v.src = fileUrl(it.path);
    const at = !start && ctx.settings.mediaResume && ctx.settings.mediaResume[it.path];
    v.onloadedmetadata = () => { if (at && at < v.duration - 15) { v.currentTime = at; flash(`Continuing from ${fmtTime(at)}`); } };
    v.play().catch(() => flash("This video can't be played"));
    showUi();
  };
  v.addEventListener('timeupdate', tick);
  v.addEventListener('ended', () => { if (i < list.length - 1) load(i + 1, true); else close(); });
  v.addEventListener('error', () => flash("This video can't be played (format not supported)"));
  v.addEventListener('pause', () => { ui.classList.add('show'); });
  saveT = setInterval(saveResume, 5000);

  const layer = {
    handle(a, info) {
      showUi();
      if (a === 'accept' || a === 'square') { v.paused ? v.play() : v.pause(); flash(v.paused ? 'Paused' : 'Playing'); }
      else if (a === 'left' || a === 'right') { v.currentTime = Math.max(0, Math.min((v.duration || 0) - 1, v.currentTime + (a === 'left' ? -10 : 10))); }
      else if (a === 'l2' || a === 'r2') { v.currentTime = Math.max(0, Math.min((v.duration || 0) - 1, v.currentTime + (a === 'l2' ? -60 : 60))); }
      else if (a === 'l1') { if (!(info && info.repeat) && i > 0) load(i - 1, true); }
      else if (a === 'r1') { if (!(info && info.repeat) && i < list.length - 1) load(i + 1, true); }
      else if (a === 'triangle') { v.currentTime = 0; flash('From the beginning'); }
      else if (a === 'up' || a === 'down') { v.volume = Math.max(0, Math.min(1, v.volume + (a === 'up' ? 0.1 : -0.1))); flash(`Volume ${Math.round(v.volume * 100)}%`); }
      else if (a === 'back' || a === 'home') close();
    },
  };
  const close = () => {
    saveResume();
    clearInterval(saveT); clearTimeout(hideT);
    v.pause(); v.removeAttribute('src'); v.load();
    removeLayer(layer);
    node.remove();
    Music.release('video');
    if (wasPlaying && Player.paused) Player.toggle();
    sfx('back');
  };
  node.addEventListener('click', () => layer.handle('accept'));
  pushLayer(layer);
  load(i, fromStart);
}

// ---------------- Now Playing (music) ----------------
export function nowPlaying() {
  if (!Player.active) return;
  const node = el(`<div class="layer np-screen"><div class="np-card"><div class="np-cover"></div><div class="np-info"><small>Now Playing</small><h1></h1><div class="np-artist"></div>
    <div class="np-bar"><span class="np-t"></span><div class="vp-prog"><i></i></div><span class="np-d"></span></div><div class="np-ctl"></div><div class="np-next"></div></div></div>
    <div class="hints">${hintsHtml([['cross', 'Play / Pause'], ['left', ''], ['right', 'Previous / Next'], ['square', 'Stop'], ['circle', 'Back']])}</div></div>`);
  document.body.appendChild(raise(node));
  requestAnimationFrame(() => node.classList.add('in'));
  const render = () => {
    const c = Player.current;
    if (!c) { close(); return; }
    node.querySelector('.np-cover').innerHTML = c.cover ? `<img src="${esc(c.cover)}" alt="">` : icon('music');
    node.querySelector('h1').textContent = c.title || '';
    node.querySelector('.np-artist').textContent = Player.loading ? 'Loading…' : c.artist || '';
    node.querySelector('.np-t').textContent = fmtTime(Player.time);
    node.querySelector('.np-d').textContent = fmtTime(Player.duration);
    node.querySelector('.np-bar i').style.width = Player.duration ? `${(Player.time / Player.duration) * 100}%` : '0';
    node.querySelector('.np-ctl').innerHTML = `${icon('prev')}${icon(Player.paused ? 'playFill' : 'pause')}${icon('next')}`;
    const nx = Player.queue[Player.index + 1];
    node.querySelector('.np-next').textContent = nx ? `Next: ${nx.title}` : '';
  };
  const unsub = Player.subscribe(render);
  const layer = {
    handle(a) {
      if (a === 'accept') { sfx('accept'); Player.toggle(); }
      else if (a === 'left' || a === 'l1') { sfx('move'); Player.prev(); }
      else if (a === 'right' || a === 'r1') { sfx('move'); Player.next(); }
      else if (a === 'square') { Player.stop(); }
      else if (a === 'back' || a === 'home') close();
    },
  };
  const close = () => { unsub(); removeLayer(layer); node.classList.remove('in'); setTimeout(() => node.remove(), 300); sfx('back'); };
  pushLayer(layer);
  render();
}
