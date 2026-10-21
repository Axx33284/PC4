// The PS4 Quick Menu: hold the PS button (also during a game) for music, volume, the game you're playing,
// Xbox emulation, the controller's battery, captures and power — without leaving what you're doing.
import { ctx, api, el, pushLayer, removeLayer, topLayer, hintsHtml, gameById, cardArt, gameArt } from './core.js';
import { sfx } from './sound.js';
import { esc, icon } from '../common/util.js';
import { toast, openPanel, textInput, raise, confirmDialog } from './ui.js';
import { Player, fmtTime } from './player.js';

let open_ = null;
let nav = null;
export function initQuickMenu(n) { nav = n; }
export const quickMenuOpen = () => !!open_;
export function closeQuickMenu(backToGame = false, quiet = false) { if (open_) open_.close(backToGame, quiet); }

// Over a game (the overlay window, ctx.overlay) the menu can't open PC4's own screens itself:
// those rows hand over to PC4, which comes to the front and opens them.
const inPC4 = (name, run, close) => (ctx.overlay ? () => { close(false, true); api.overlayHandoff(name); } : run);

const wait = ms => new Promise(r => setTimeout(r, ms));

export async function openQuickMenu({ fromGame = false } = {}) {
  if (ctx.settings.quickMenu === false) return;
  if (open_) { open_.close(); return; }
  sfx('options');
  // PS5 style: the Control Center along the bottom (cards above a row of round icons) instead of the PS4's side list
  const p5 = ctx.settings.uiStyle === 'ps5';
  const node = el(p5 ? `<div class="layer qm-layer cc-layer"><div class="qm-shade"></div><div class="cc">
    <div class="cc-top"><span class="cc-bat"></span><span class="qm-clock"></span></div>
    <div class="cc-cards"></div><div class="cc-icons"></div><div class="cc-label"></div>
    <div class="qm-hints hints">${hintsHtml([['cross', 'Select'], ['circle', 'Back']])}</div><div class="cc-pop"></div></div></div>`
    : `<div class="layer qm-layer"><div class="qm-shade"></div><div class="qm">
    <div class="qm-head"><h1>Quick Menu</h1><span class="qm-clock"></span></div>
    <div class="qm-list"></div>
    <div class="qm-hints hints">${hintsHtml([['cross', 'Select'], ['circle', 'Back']])}</div></div></div>`);
  document.body.appendChild(raise(node));
  requestAnimationFrame(() => node.classList.add('in'));
  const list = node.querySelector(p5 ? '.cc' : '.qm-list');
  let sel = 0, rows = [];
  let vol = null; // system volume { level, muted } (null: PC4's own volume)
  let outputs = null; // the PC's sound outputs
  api.getVolume().then(v => { vol = v && v.level >= 0 ? v : null; render(); });
  api.audioOutputs().then(l => { outputs = l && l.length ? l : null; render(); });

  const running = () => ctx.state.running.map(gameById).filter(Boolean)[0];
  const pad = () => ((ctx.state.emulator && ctx.state.emulator.pads) || [])[0];

  const build = () => {
    const g = running();
    const s = ctx.settings;
    const p = pad();
    const cur = Player.current;
    const r = [];
    if (g) {
      r.push({ type: 'game', g });
      r.push({ icon: 'play', label: 'Go to Game', run: () => close(true) });
      r.push({ icon: 'close', label: 'Close Game', run: async () => {
        if (!ctx.overlay) { close(false); (await import('./actions.js')).closeGame(g); return; }
        if (await confirmDialog('Close Game', `Close ${g.name}? Any unsaved progress will be lost.`, 'Close Game')) { close(false); api.closeGame(g.id); }
      } });
    }
    r.push({ type: 'section', label: 'Music' });
    if (cur) {
      r.push({ type: 'music' });
      r.push({ icon: 'x', label: 'Stop Music', run: () => { Player.stop(); render(); } });
      r.push({ icon: 'volume', label: 'Music Volume', type: 'slider', get: () => ctx.settings.playerVolume ?? 0.8, set: v => Player.setVolume(v) });
    }
    r.push({ icon: 'search', label: 'Search Music…', value: 'YouTube Music', run: () => musicSearch() });
    r.push({ icon: 'media', label: 'Media Player', value: 'Music and videos on this PC', run: inPC4('media', async () => { close(false); (await import('./media.js')).openMedia(); }, close) });
    r.push({ type: 'section', label: 'Sound' });
    r.push({ icon: 'volume', label: vol ? 'Volume' : 'PC4 Volume', type: 'slider', get: () => (vol ? vol.level : s.masterVolume ?? 1),
      set: async v => {
        if (vol) { const nv = await api.setVolume(v); if (nv && nv.level >= 0) vol = nv; render(); }
        else api.updateSettings({ masterVolume: v });
      } });
    if (outputs && outputs.length > 1) r.push({ icon: 'headphones', label: 'Sound Output', type: 'choice', options: outputs.map(o => [o.id, o.name]),
      get: () => (outputs.find(o => o.default) || outputs[0]).id,
      set: async id => {
        const l = await api.setAudioOutput(id);
        if (l && l.length) outputs = l;
        const v = await api.getVolume(); if (v && v.level >= 0) vol = v; // each output has its own volume
        render();
        const cur = outputs.find(o => o.default);
        if (cur) toast({ title: 'Sound output', body: cur.name, ico: 'headphones', sound: false });
      } });
    r.push({ icon: 'volumeMute', label: 'Mute', type: 'toggle', get: () => (vol ? vol.muted : !!s.muteAll),
      set: async on => { if (vol) { const nv = await api.setVolume(on); if (nv) vol = nv; render(); } else api.updateSettings({ muteAll: on }); } });
    r.push({ type: 'section', label: 'Controller' });
    if (p) r.push({ icon: p.battery < 25 ? 'batteryLow' : p.charging ? 'batteryCharge' : 'battery', label: `${p.kind} · ${p.bus}`, value: p.battery >= 0 ? `${p.battery}%${p.charging ? ' · charging' : ''}` : '', run: () => {} });
    r.push({ icon: 'swap', label: 'Xbox Emulation', type: 'toggle', get: () => !!s.emuMode && s.emuMode !== 'off', set: on => api.updateSettings({ emuMode: on ? 'always' : 'off' }) });
    r.push({ icon: 'pulse', label: 'Test Controller', run: inPC4('padtest', async () => { close(false); (await import('./padtest.js')).openPadTest(); }, close) });
    // Secure Connection (Cloudflare WARP): on and off right here, also over a game
    const w = ctx.state.warp;
    if (w) {
      r.push({ type: 'section', label: 'Network' });
      if (w.installed) {
        r.push({ icon: 'shieldCheck', label: 'Secure Connection', type: 'toggle', get: () => w.status === 'connected',
          status: w.busy || w.status === 'connecting' ? 'Connecting…' : w.status === 'connected' ? 'On' : 'Off',
          set: on => import('./actions.js').then(m => m.warpSwitch(on)).then(() => render()) });
      } else {
        r.push({ icon: 'shieldCheck', label: 'Secure Connection', value: 'Install Cloudflare WARP…', run: () => import('./actions.js').then(m => m.warpInstall()) });
      }
    }
    r.push({ type: 'section', label: 'Capture' });
    r.push({ icon: 'camera', label: 'Take Screenshot', run: () => shot() });
    r.push({ icon: 'record', label: ctx.state.recording ? 'Stop Recording' : 'Start Recording', value: ctx.state.recording ? 'Recording…' : '', run: () => record() });
    r.push({ icon: 'gallery', label: 'Capture Gallery', run: inPC4('gallery', async () => { close(false); (await import('./gallery.js')).openGallery(); }, close) });
    r.push({ type: 'section', label: 'More' });
    r.push({ icon: 'power', label: 'Power', run: inPC4('power', async () => { close(false); (await import('./actions.js')).powerMenu(); }, close) });
    r.push({ icon: 'gear', label: 'Quick Menu Settings', run: inPC4('settings', () => { close(false); nav && nav.openSettings('controllers'); }, close) });
    return r;
  };

  const valueHtml = row => {
    if (row.type === 'slider') { const v = Math.round((row.get() || 0) * 100); return `<span>${v}%</span><span class="slider"><i style="width:${v}%"></i><b style="left:${v}%"></b></span>`; }
    if (row.type === 'toggle') return `${row.status ? `<span>${esc(row.status)}</span>` : ''}<span class="check ${row.get() ? 'on' : ''}">${icon('check')}</span>`;
    if (row.type === 'choice') { const v = row.get(); return `<span class="qm-choice">‹ ${esc((row.options.find(o => o[0] === v) || row.options[0])[1])} ›</span>`; }
    return esc(row.value || '');
  };

  const rowHtml = (row, i, on) => {
    if (row.type === 'music') {
      const cur = Player.current;
      const pct = Player.duration ? (Player.time / Player.duration) * 100 : 0;
      return `<div class="qm-row qm-music ${on}" data-i="${i}"><div class="qm-cover">${cur.cover ? `<img src="${esc(cur.cover)}">` : icon('music')}</div>
          <div class="qm-song"><b>${esc(cur.title || '…')}</b><span>${esc(Player.loading ? 'Loading…' : cur.artist || '')}</span>
          <div class="qm-prog"><i style="width:${pct.toFixed(1)}%"></i></div><span class="qm-t">${fmtTime(Player.time)} / ${fmtTime(Player.duration)}</span></div>
          <div class="qm-ctl">${icon('prev')}${icon(Player.paused ? 'playFill' : 'pause')}${icon('next')}</div></div>`;
    }
    return `<div class="qm-row ${on}" data-i="${i}">${icon(row.icon)}<span class="lbl">${esc(row.label)}</span><span class="val">${valueHtml(row)}</span></div>`;
  };
  const clockText = () => new Date().toLocaleTimeString(ctx.settings.clock24 ? 'en-GB' : 'en-US', { hour: 'numeric', minute: '2-digit', hour12: !ctx.settings.clock24 });

  const render4 = () => {
    rows = build();
    sel = Math.min(Math.max(sel, 0), rows.length - 1);
    while (rows[sel] && (rows[sel].type === 'section' || rows[sel].type === 'game')) sel++; // start on "Go to Game"
    list.innerHTML = rows.map((row, i) => {
      const on = i === sel ? 'sel focus-ring' : '';
      if (row.type === 'section') return `<div class="qm-sec">${esc(row.label)}</div>`;
      if (row.type === 'game') return `<div class="qm-game"><div class="qm-art">${cardArt(row.g) ? `<img src="${esc(cardArt(row.g))}">` : gameArt(row.g)}</div><div><small>Now Playing</small><b>${esc(row.g.name)}</b></div></div>`;
      return rowHtml(row, i, on);
    }).join('');
    const selEl = list.querySelector('.sel');
    if (selEl) selEl.scrollIntoView({ block: 'nearest' });
    node.querySelector('.qm-clock').textContent = clockText();
  };

  // ---- PS5 Control Center: the same rows, grouped by their section behind cards and round icons ----
  // An item with `row` acts at once (✕), one with `rows` opens a small card above it with those rows.
  let zone = 'cards', ci = 0, ii = 0, pop = null, psel = 0, items = { cards: [], icons: [] };
  const items5 = () => {
    const gr = {}; let cur = null, game = null;
    for (const row of build()) {
      if (row.type === 'section') { cur = gr[row.label] = []; continue; }
      if (row.type === 'game') { game = row.g; cur = gr.Game = []; continue; }
      cur.push(row);
    }
    const find = (sec, label) => (gr[sec] || []).find(r => r.label === label);
    const s = ctx.settings, p = pad(), w = ctx.state.warp;
    const cards = [];
    if (game) cards.push({ id: 'game', label: game.name, g: game, rows: gr.Game });
    cards.push({ id: 'music', label: 'Music', rows: gr.Music });
    cards.push({ id: 'capture', label: 'Captures', rows: gr.Capture });
    const muted = vol ? vol.muted : !!s.muteAll;
    const icons = [
      { id: 'home', icon: 'home', label: 'Home', row: { run: inPC4('home', () => close(false), close) } },
      { id: 'notif', icon: 'bell', label: 'Notifications', row: { run: inPC4('notifications', async () => { close(false); (await import('./actions.js')).showNotifications(); }, close) } },
      { id: 'music', icon: 'music', label: 'Music', rows: gr.Music },
      { id: 'sound', icon: muted ? 'volumeMute' : 'volume', label: 'Sound', rows: gr.Sound },
      { id: 'emu', icon: 'swap', label: 'Xbox Emulation', row: find('Controller', 'Xbox Emulation'), dot: !!s.emuMode && s.emuMode !== 'off',
        sub: !!s.emuMode && s.emuMode !== 'off' ? 'On' : 'Off' },
      { id: 'pad', icon: p ? (p.battery < 25 ? 'batteryLow' : p.charging ? 'batteryCharge' : 'battery') : 'gamepad', label: 'Accessories', rows: gr.Controller,
        sub: p && p.battery >= 0 ? `${p.battery}%` : '' },
      gr.Network && { id: 'net', icon: 'shieldCheck', label: 'Secure Connection', rows: gr.Network, dot: w && w.status === 'connected' },
      { id: 'capture', icon: 'camera', label: 'Captures', rows: gr.Capture, dot: !!ctx.state.recording },
      { id: 'settings', icon: 'gear', label: 'Customize', row: find('More', 'Quick Menu Settings') },
      { id: 'power', icon: 'power', label: 'Power', row: find('More', 'Power') },
    ].filter(it => it && (it.row || (it.rows && it.rows.length)));
    return { cards, icons };
  };
  const focused = () => (zone === 'cards' ? items.cards[ci] : items.icons[ii]);
  const popRows = () => (pop && pop.rows) || [];

  const cardHtml = (c, k, on) => {
    let body;
    if (c.id === 'game') {
      const art = cardArt(c.g);
      body = `<div class="cc-art">${art ? `<img src="${esc(art)}">` : gameArt(c.g)}</div><div class="cc-cap"><small>Now Playing</small><b>${esc(c.g.name)}</b></div>`;
    } else if (c.id === 'music') {
      const cur = Player.current;
      if (cur) {
        const pct = Player.duration ? (Player.time / Player.duration) * 100 : 0;
        body = `<div class="cc-music"><div class="qm-cover">${cur.cover ? `<img src="${esc(cur.cover)}">` : icon('music')}</div>
          <div class="qm-song"><small>Music</small><b>${esc(cur.title || '…')}</b><span>${esc(Player.loading ? 'Loading…' : cur.artist || '')}</span></div>
          <div class="cc-play">${icon(Player.paused ? 'playFill' : 'pause')}</div></div><div class="qm-prog"><i style="width:${pct.toFixed(1)}%"></i></div>`;
      } else body = `<div class="cc-plain">${icon('music')}<div><small>Music</small><b>Play music while you play</b></div></div>`;
    } else {
      body = `<div class="cc-plain">${icon(ctx.state.recording ? 'record' : 'camera')}<div><small>Captures</small><b>${ctx.state.recording ? 'Recording…' : 'Screenshots and recordings'}</b></div></div>`;
    }
    return `<div class="cc-card cc-k-${c.id} ${on}" data-z="cards" data-k="${k}">${body}</div>`;
  };

  const render5 = () => {
    items = items5();
    items.cards.forEach(c => { c.key = `c-${c.id}`; });
    items.icons.forEach(it => { it.key = `i-${it.id}`; });
    if (!items.cards.length) zone = 'icons';
    ci = Math.max(0, Math.min(ci, items.cards.length - 1)); ii = Math.max(0, Math.min(ii, items.icons.length - 1));
    if (pop) pop = [...items.cards, ...items.icons].find(it => it.key === pop.key && it.rows) || null; // fresh rows
    const f = focused();
    const on = (z, k) => (z === zone && k === (z === 'cards' ? ci : ii) ? `sel${pop ? '' : ' focus-ring'}` : '');
    node.querySelector('.cc-cards').innerHTML = items.cards.map((c, k) => cardHtml(c, k, on('cards', k))).join('');
    node.querySelector('.cc-icons').innerHTML = items.icons.map((it, k) =>
      `<div class="cc-ico ${on('icons', k)}" data-z="icons" data-k="${k}">${icon(it.icon)}${it.dot ? '<i class="cc-dot"></i>' : ''}</div>`).join('');
    // the focused icon's name under it
    const lab = node.querySelector('.cc-label');
    const fe = list.querySelector(`.cc-${zone === 'cards' ? 'card' : 'ico'}.sel`);
    lab.innerHTML = zone === 'icons' && f ? `${esc(f.label)}${f.sub ? `<span>${esc(f.sub)}</span>` : ''}` : '';
    if (fe && zone === 'icons') { lab.style.left = `${fe.offsetLeft + fe.offsetWidth / 2}px`; lab.style.top = `${fe.offsetTop + fe.offsetHeight + 18}px`; }
    // the open card above the focused item
    const pe = node.querySelector('.cc-pop');
    if (pop && fe) {
      const rs = popRows();
      psel = Math.min(Math.max(psel, 0), rs.length - 1);
      pe.innerHTML = `<div class="cc-pop-head">${esc(pop.id === 'game' ? 'Game' : pop.label)}</div><div class="cc-pop-list">${rs.map((row, i) => rowHtml(row, i, i === psel ? 'sel focus-ring' : '')).join('')}</div>`;
      pe.classList.add('open');
      const W = list.clientWidth, pw = pe.offsetWidth;
      pe.style.left = `${Math.max(16, Math.min(W - pw - 16, fe.offsetLeft))}px`;
      pe.style.bottom = `${list.clientHeight - fe.offsetTop + 16}px`;
      const s = pe.querySelector('.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
    } else { pe.classList.remove('open'); pe.innerHTML = ''; }
    const p = pad();
    node.querySelector('.cc-bat').innerHTML = p && p.battery >= 0 ? `${icon(p.battery < 25 ? 'batteryLow' : p.charging ? 'batteryCharge' : 'battery')}<span>${p.battery}%</span>` : '';
    node.querySelector('.qm-clock').textContent = clockText();
  };
  const render = () => (p5 ? render5() : render4());

  const handle5 = a => {
    if (a === 'home' || a === 'quickmenu') { close(fromGame); return; }
    if (pop) {
      const rs = popRows(), row = rs[psel];
      if (a === 'back') { pop = null; sfx('back'); render(); }
      else if (a === 'up' || a === 'wheel-up') { if (psel > 0) { psel--; sfx('move'); render(); } }
      else if (a === 'down' || a === 'wheel-down') { if (psel < rs.length - 1) { psel++; sfx('move'); render(); } }
      else if ((a === 'left' || a === 'right') && row) adjust(row, a === 'left' ? -1 : 1);
      else if (a === 'accept' && row) activate(row);
      else if (a === 'square' && row && row.type === 'music') { Player.stop(); render(); }
      return;
    }
    if (a === 'back') { close(fromGame); return; }
    const n = zone === 'cards' ? items.cards.length : items.icons.length;
    const k = zone === 'cards' ? ci : ii;
    if (a === 'up' && zone === 'icons' && items.cards.length) { zone = 'cards'; sfx('move'); render(); }
    else if (a === 'down' && zone === 'cards') { zone = 'icons'; sfx('move'); render(); }
    else if ((a === 'left' || a === 'wheel-up') && k > 0) { if (zone === 'cards') ci--; else ii--; sfx('move'); render(); }
    else if ((a === 'right' || a === 'wheel-down') && k < n - 1) { if (zone === 'cards') ci++; else ii++; sfx('move'); render(); }
    else if (a === 'accept') {
      const it = focused();
      if (!it) return;
      if (it.row) activate(it.row);
      else { pop = it; psel = 0; sfx('accept'); render(); }
    } else if (a === 'square' && zone === 'cards' && focused() && focused().id === 'music' && Player.current) { Player.stop(); render(); }
  };

  const step = d => {
    let n = sel + d;
    while (rows[n] && rows[n].type === 'section') n += d;
    if (!rows[n] || rows[n].type === 'game') return;
    sel = n; sfx('move'); render();
  };

  const adjust = (row, d) => {
    if (row.type === 'slider') { const v = Math.max(0, Math.min(1, Math.round(((row.get() || 0) + d * 0.05) * 20) / 20)); row.set(v); sfx('move'); setTimeout(render, 30); }
    else if (row.type === 'choice') { const i = row.options.findIndex(o => o[0] === row.get()); const n = row.options[(i + d + row.options.length) % row.options.length]; row.set(n[0]); sfx('move'); setTimeout(render, 60); }
    else if (row.type === 'music') { sfx('move'); d < 0 ? Player.prev() : Player.next(); }
  };

  // screenshots and recordings are of the game, so the menu gets out of the way first
  const shot = async () => {
    close(fromGame);
    await wait(fromGame ? 900 : 450);
    await api.screenshot();
  };
  const record = async () => {
    const was = ctx.state.recording;
    close(fromGame && !was);
    if (!was) await wait(fromGame ? 900 : 450);
    await api.toggleRecording();
  };

  const musicSearch = async () => {
    const q = await textInput({ title: 'Search YouTube Music', value: '' });
    if (!q || !q.trim()) return;
    songResults(q.trim());
  };

  const activate = row => {
    if (row.type === 'music') { sfx('accept'); Player.toggle(); }
    else if (row.type === 'toggle') { sfx('accept'); row.set(!row.get()); setTimeout(render, 60); }
    else if (row.type === 'choice') adjust(row, 1);
    else if (row.type === 'slider') { /* left / right */ }
    else if (row.run) { sfx('accept'); row.run(); }
  };

  const layer = {
    handle(a, info) {
      if (p5) { handle5(a); return; }
      const row = rows[sel];
      if (a === 'up' || a === 'wheel-up') step(-1);
      else if (a === 'down' || a === 'wheel-down') step(1);
      else if ((a === 'left' || a === 'right') && row) adjust(row, a === 'left' ? -1 : 1);
      else if (a === 'accept' && row) activate(row);
      else if (a === 'square' && row && row.type === 'music') { Player.stop(); render(); }
      else if (a === 'back' || a === 'home' || a === 'quickmenu') close(fromGame);
    },
  };

  const unsubP = Player.subscribe(() => render());
  const onState = () => { if (node.isConnected) render(); };
  ctx.subs.add(onState);
  const clock = setInterval(render, 15000);
  // quiet: the overlay is already being hidden or handed over (no sound, nothing more to tell the main process)
  const close = (backToGame = false, quiet = false) => {
    if (!open_) return;
    open_ = null;
    unsubP(); ctx.subs.delete(onState); clearInterval(clock);
    removeLayer(layer);
    node.classList.remove('in');
    setTimeout(() => node.remove(), 300);
    if (!quiet) sfx('back');
    if (ctx.overlay) { if (!quiet) setTimeout(() => api.overlayClose(backToGame), 260); } // after the slide-out
    else if (backToGame && running()) api.backToGame();
  };
  node.querySelector('.qm-shade').addEventListener('click', () => close(fromGame));
  list.addEventListener('click', e => {
    if (p5) {
      const r = e.target.closest('.cc-pop [data-i]');
      if (r) { psel = Number(r.dataset.i); render(); handle5('accept'); return; }
      const it = e.target.closest('[data-z]');
      if (it) { pop = null; zone = it.dataset.z; if (zone === 'cards') ci = Number(it.dataset.k); else ii = Number(it.dataset.k); render(); handle5('accept'); }
      return;
    }
    const r = e.target.closest('[data-i]'); if (r) { sel = Number(r.dataset.i); render(); layer.handle('accept'); }
  });
  open_ = { close };
  pushLayer(layer);
  render();
}

// YouTube Music results: ✕ plays the song, and the rest of the list after it
export async function songResults(q) {
  let results = null, sel = 0, error = '';
  const p = openPanel(`<div class="pick song-pick"><h1>Music</h1><div class="sub">YouTube Music · “${esc(q)}”</div><div class="pick-list"></div></div>
    <div class="hints">${hintsHtml([['cross', 'Play'], ['triangle', 'Search'], ['circle', 'Back']])}</div>`, {
    handle(a) {
      const n = results ? results.length : 0;
      if (a === 'up' || a === 'wheel-up') { if (sel > 0) { sel--; sfx('move'); render(); } return true; }
      if (a === 'down' || a === 'wheel-down') { if (sel < n - 1) { sel++; sfx('move'); render(); } return true; }
      if (a === 'accept' && results && results[sel]) { sfx('accept'); Player.play(results, sel); p.close(true); return true; }
      if (a === 'triangle') { textInput({ title: 'Search YouTube Music', value: q }).then(t => { if (t && t.trim()) { p.close(true); songResults(t.trim()); } }); return true; }
    },
  });
  const listEl = p.node.querySelector('.pick-list');
  const render = () => {
    if (!results) { listEl.innerHTML = `<div class="pick-status">${esc(error || 'Searching…')}</div>`; return; }
    listEl.innerHTML = results.length ? results.map((r, i) => `<div class="pick-item song ${i === sel ? 'sel focus-ring' : ''}" data-i="${i}">
      <div class="yt-thumb sq"><img src="${esc(r.thumb)}" loading="lazy"></div>
      <div class="yt-text"><span class="yt-title">${esc(r.title)}</span><span class="yt-meta">${esc(r.artist || 'Song')}</span></div></div>`).join('')
      : `<div class="pick-status">Nothing found for “${esc(q)}”.</div>`;
    const s = listEl.querySelector('.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
  };
  listEl.addEventListener('click', e => { const it = e.target.closest('[data-i]'); if (it && results) { sel = Number(it.dataset.i); Player.play(results, sel); p.close(true); } });
  render();
  const r = await api.musicSearch(q);
  if (!p.node.isConnected) return;
  if (r.ok) results = r.results; else error = r.error;
  render();
}
