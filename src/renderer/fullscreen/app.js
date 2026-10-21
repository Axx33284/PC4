import { ctx, api, el, setState, subscribe, dispatch, pushLayer, removeLayer, topLayer, refreshKeyHints } from './core.js';
import { Input } from './input.js';
import { Background, lastPlayedGame } from './background.js';
import { Home } from './home.js';
import { Library } from './library.js';
import { Settings } from './settings.js';
import { Music, sfx, loadSoundPack, warmUp, sleepAudio } from './sound.js';
import { toast, showDialog } from './ui.js';
import { onGameStopped, hideLaunch, onYouTubeClosed, onYouTubeShown, loadIndustry } from './actions.js';
import { bootLogo, login } from './boot.js';
import { openQuickMenu, initQuickMenu, quickMenuOpen } from './quickmenu.js';
import { Player, playFiles } from './player.js';
import { applyLightBar } from '../common/lightbar.js';
import { icon, esc, fmtHours, avatarUrl, loadCustomFonts, padStyle, padGlyph, fileUrl } from '../common/util.js';

const appRoot = document.getElementById('app');
const status = document.getElementById('statusbar');

setState(await api.getState());
const fontsReady = loadCustomFonts(ctx.state);
warmUp();

document.body.classList.toggle('perf-light', !!(ctx.state.perf && ctx.state.perf.light));
// Console Style: PS4 or PS5 (Settings > Themes); the body class switches the whole look
let uiStyle = ctx.settings.uiStyle === 'ps5' ? 'ps5' : 'ps4';
document.body.classList.toggle('ui-ps5', uiStyle === 'ps5');
const bg = new Background(document.getElementById('bg'));
bg.applyTheme();
// PS5: the home screen's own background picture (the player's background.* in the PS5 folder, or PS5-ish's from Playnite)
let wall5 = null;
function applyWall5() {
  const w = ctx.state.wallpaper5 || null;
  if (w === wall5) return;
  wall5 = w;
  document.getElementById('bg').style.setProperty('--p5-wall', w ? `url("${fileUrl(w)}")` : 'none');
}
applyWall5();
// the time-of-day theme moves on by itself
setInterval(() => { if (ctx.settings.themeMode === 'time') bg.applyTheme(); }, 60000);

// ---------------- screens ----------------
const nav = {
  bg,
  openLibrary(cat) { openScreen(library, () => library.open(cat)); },
  openSettings(page, opts) { openScreen(settings, () => settings.open(page, opts)); },
  searchLibrary() { openScreen(library, () => library.open('all')); library.searchPrompt(); },
  closeScreen(screen) {
    screen.close();
    removeLayer(screen);
    home.root.classList.remove('hidden');
    status.classList.remove('hidden');
    home.updateBackdrop();
  },
};

function openScreen(screen, open) {
  if (topLayer() === screen) return;
  if (topLayer() === library) nav.closeScreen(library);
  if (topLayer() === settings) nav.closeScreen(settings);
  open();
  home.root.classList.add('hidden');
  status.classList.add('hidden');
  bg.setGame(null);
  bg.setAccent(null);
  pushLayer(screen);
}

const home = new Home(appRoot, nav);
initQuickMenu(nav);
const library = new Library(appRoot, nav);
const settings = new Settings(appRoot, nav);

// PS4 / PS5 / Xbox button icons: picked in Settings, or following the controller that is plugged in
let lastPadStyle = '';
function applyPadStyle() {
  const st = padStyle(ctx.settings);
  if (st === lastPadStyle) return;
  document.body.classList.remove('pads-ps4', 'pads-ps5', 'pads-xbox');
  document.body.classList.add(`pads-${st}`);
  const first = !lastPadStyle;
  lastPadStyle = st;
  if (!first) { home.renderHub(true); renderStatus(); } // the Controls card and the status bar show the matching controller
}
applyPadStyle();

// ---------------- status bar ----------------
// top left: the controller in your hands (PS4 / PS5 / Xbox); while Xbox emulation runs, an Xbox pad with a green dot
function padBadge() {
  const emu = ctx.state.emulator || {};
  const emulating = emu.running && (emu.pads || []).length > 0;
  const kind = emulating ? 'xbox' : padStyle(ctx.settings);
  const title = emulating ? 'Xbox controller emulation is on' : kind === 'xbox' ? 'Xbox controller' : kind === 'ps5' ? 'DualSense' : 'DUALSHOCK 4';
  return `<span class="sb-item sb-pad ${padConnected || emulating ? '' : 'pad-off'}" title="${title}">${padGlyph(kind)}${emulating ? '<i class="sb-emu"></i>' : ''}${batteryBadge()}</span>`;
}
// the controller's battery next to its icon (PS4 and PS5 status bars), from PC4's controller helper
function batteryBadge() {
  const p = ((ctx.state.emulator && ctx.state.emulator.pads) || [])[0];
  if (!p || !(p.battery >= 0)) return '';
  return `<span class="sb-batt ${p.battery <= 15 ? 'low' : ''} ${p.charging ? 'chg' : ''}"><i style="width:${p.battery}%"></i></span><span class="sb-pct">${p.battery}%</span>`;
}
let padConnected = false;
function renderStatus() {
  const s = ctx.settings;
  const all = ctx.state.games.filter(g => !g.hidden);
  const total = all.reduce((n, g) => n + (g.playtime || 0), 0);
  const av = avatarUrl(ctx.state);
  const warpOn = ctx.state.warp && ctx.state.warp.status === 'connected' ? `<span class="sb-item sb-warp" title="Secure Connection on">${icon('shieldCheck')}</span>` : '';
  // PS5: only the clock in the top-right corner (Search, Settings and the avatar are home.js's icons, left of it)
  const html = uiStyle === 'ps5' ? `<div class="sb-right">${warpOn}${batteryBadge() ? padBadge() : ''}<span class="sb-item clock"></span></div>` : `
    <div class="sb-left">${padBadge()}<span class="sb-item">${icon('bell')}</span>${ctx.state.warp && ctx.state.warp.status === 'connected' ? `<span class="sb-item sb-warp" title="Secure Connection on">${icon('shieldCheck')}</span>` : ''}</div>
    <div class="sb-center">
      <span class="sb-item sb-badge">${icon('grid')}<small>${all.length}</small></span>
      <span class="sb-item sb-user"><span class="dot"></span><span class="avatar">${av ? `<img src="${av}">` : esc((s.profileName || 'P')[0].toUpperCase())}</span><span>${esc(s.profileName)}</span></span>
    </div>
    <div class="sb-right"><span class="sb-item">${icon('trophy')}<span>${fmtHours(total)}</span></span><span class="sb-item clock"></span></div>`;
  if (html === status._html) return; // state pushes are frequent; only redraw when something changed
  status._html = html;
  status.innerHTML = html;
  tick();
  // PS5: room for the status icons, so the function icons line up beside them
  document.documentElement.style.setProperty('--sbw', `${status.offsetWidth / parseFloat(getComputedStyle(document.documentElement).fontSize)}rem`);
}
function tick() {
  const c = status.querySelector('.clock');
  if (c) c.textContent = new Date().toLocaleTimeString(ctx.settings.clock24 ? 'en-GB' : 'en-US', { hour: 'numeric', minute: '2-digit', hour12: !ctx.settings.clock24 });
}
setInterval(tick, 5000);

let lastThemeKey = '';
let lastIndustry = null;
let lastVol = '';
let lastLight = '';
let lastKeys = '';
subscribe(() => {
  const light = `${ctx.settings.lightBar}|${ctx.settings.lightBarBrightness}`;
  if (light !== lastLight) { lastLight = light; applyLightBar(ctx.settings, api); }
  applyPadStyle();
  applyWall5();
  const style = ctx.settings.uiStyle === 'ps5' ? 'ps5' : 'ps4';
  if (style !== uiStyle) {
    uiStyle = style;
    document.body.classList.toggle('ui-ps5', style === 'ps5');
    status._html = '';
    home.restyle();
    bg.applyTheme();
  }
  renderStatus();
  if (ctx.input) {
    const keys = JSON.stringify(ctx.settings.keyBindings || {});
    if (keys !== lastKeys) { lastKeys = keys; ctx.input.setBindings(ctx.settings); refreshKeyHints(); }
    ctx.input.ignoreVirtual = !!(ctx.state.emulator && ctx.state.emulator.running);
    ctx.input.ignoreVirtualDs4 = !!(ctx.state.emulator && ctx.state.emulator.passthrough);
  }
  document.body.classList.toggle('perf-light', !!(ctx.state.perf && ctx.state.perf.light));
  if (ctx.state.industryVersion !== lastIndustry) { lastIndustry = ctx.state.industryVersion; loadIndustry().then(() => home.renderHub(true)); }
  const s = ctx.settings;
  const last = s.themeMode === 'game' ? (lastPlayedGame() || {}).id : '';
  const key = [s.theme, s.customBackground, s.gameWallpaper, s.themeMode, last].join('|');
  if (key !== lastThemeKey) { lastThemeKey = key; bg.applyTheme(); home.updateBackdrop(); }
  Music.sync();
  const vol = [s.masterVolume, s.musicVolume, s.gameMusicVolume, s.muteAll, s.playerVolume].join('|');
  if (vol !== lastVol) { lastVol = vol; Music.refreshVolume(); Player.refreshVolume(); }
  loadSoundPack();
});
renderStatus();
await loadSoundPack();
lastLight = `${ctx.settings.lightBar}|${ctx.settings.lightBarBrightness}`;
applyLightBar(ctx.settings, api, { ask: true });

// ---------------- input ----------------
const input = new Input((a, info) => {
  if (a === 'quickmenu') { if (ctx.settings.quickMenu !== false) openQuickMenu(); else dispatch('home', info); return; }
  // SHARE makes captures (the helper sees it, so PC4 needn't); without captures it opens options as before
  // (the keyboard's SHARE key always takes the screenshot here)
  if (a === 'share') { if (ctx.settings.captureShare !== false || info.source === 'key') { if (info.source === 'key' || !(ctx.state.emulator && ctx.state.emulator.watching)) api.screenshot(); return; } a = 'options'; }
  if (a === 'home' && (topLayer() === library || topLayer() === settings)) { topLayer().handle('home'); return; }
  dispatch(a, info);
}, (connected, pad, count) => {
  padConnected = count > 0;
  renderStatus();
  toast({ title: connected ? 'Controller connected' : 'Controller disconnected', body: pad && pad.id ? pad.id.replace(/\(.*?\)/g, '').trim().slice(0, 48) : '', ico: 'gamepad' });
  lastPadStyle = ''; applyPadStyle();
  home.renderHub(true); // the Controls card shows which controller is plugged in
  // (a controller already plugged in is reported while 'input' is still being made)
  if (connected) { setTimeout(() => input.setMode('pad'), 0); setTimeout(() => applyLightBar(ctx.settings, api, { ask: true }), 600); }
}, mode => {
  document.body.classList.toggle('input-key', mode === 'key');
  document.body.classList.toggle('input-pad', mode === 'pad');
  if (mode === 'pad') applyPadStyle(); // browsers only reveal a controller once a button is pressed
});
ctx.input = input;
input.setBindings(ctx.settings);
padConnected = [...(navigator.getGamepads ? navigator.getGamepads() : [])].some(Boolean);
input.setMode(padConnected ? 'pad' : 'key');

// mouse cursor hides itself while you use a controller/keyboard
let cursorT = 0;
window.addEventListener('mousemove', () => {
  document.body.classList.remove('hide-cursor');
  clearTimeout(cursorT);
  cursorT = setTimeout(() => document.body.classList.add('hide-cursor'), 2500);
});
document.body.classList.add('hide-cursor');

// ---------------- events from the main process ----------------
api.on('state', s => setState(s));
api.on('game-started', () => setTimeout(sleepAudio, 3000)); // after the launch sound
api.on('youtube', (open, reason) => { if (open) onYouTubeShown(); else onYouTubeClosed(reason); });
// the PS button during a game (seen by the controller helper): Quick Menu on hold, home on tap
api.on('quickmenu', () => { if (!quickMenuOpen()) openQuickMenu({ fromGame: ctx.state.running.length > 0 }); });
api.on('go-home', () => { if (topLayer() === library || topLayer() === settings) nav.closeScreen(topLayer()); if (topLayer() === home) home.handle('home'); });
api.on('pad-home', () => dispatch('home', { source: 'pad' }));
api.on('capture', m => {
  if (m.event === 'saved') toast({ title: m.title, body: m.body, ico: m.kind === 'video' ? 'video' : 'camera', sound: false });
  else if (m.event === 'recording') toast({ id: 'rec', title: m.title, body: m.body, ico: 'record', sound: false });
  else if (m.event === 'error') toast({ title: m.title, body: m.body, ico: 'x', error: true });
});
api.on('game-stopped', (id, secs, failed) => onGameStopped(id, secs, failed));
// Secure Connection switched for a game (main.js warpForGame)
api.on('warp', m => {
  const base = { id: 'warp', ico: 'shieldCheck', sound: false };
  if (m.event === 'connecting') toast({ ...base, title: 'Secure Connection', body: `Connecting before ${m.game} starts…`, duration: 0 });
  else if (m.event === 'on') toast({ ...base, title: 'Secure Connection On', body: `${m.game} goes through Cloudflare WARP` });
  else if (m.event === 'off') toast({ ...base, title: 'Secure Connection Off' });
  else if (m.event === 'failed') toast({ ...base, title: "Secure Connection Didn't Connect", body: `${m.game} starts anyway · ${m.error || ''}`, ico: 'x', error: true });
  else if (m.event === 'missing') toast({ ...base, title: 'Cloudflare WARP Is Not Installed', body: 'Settings › Network', ico: 'x', error: true });
});
// the game ended before it really started: say why (the launch screen is already gone)
api.on('game-failed', (id, name, reason) => showDialog({ title: "Can't Start the Game", message: `${name}\n\n${reason}`, error: true }));

// ---------------- the Quick Menu over a game ----------------
// The overlay window remote-controls the music player that plays here, and hands over rows that need PC4 itself.
let overlayShown = false;
const playerSnap = () => ({ current: Player.current, paused: Player.paused, time: Player.time, duration: Player.duration, loading: Player.loading, at: Date.now() });
let lastPlaying = null;
Player.subscribe(() => {
  if (overlayShown) api.playerState(playerSnap());
  // the main process keeps this window out of efficiency mode while music plays (it would stutter)
  const playing = !!Player.current && !Player.paused;
  if (playing !== lastPlaying) { lastPlaying = playing; api.playerState({ playing, only: true }); }
});
api.on('overlay-shown', on => { overlayShown = on; if (on) api.playerState(playerSnap()); });
api.on('player-cmd', (cmd, args = []) => {
  if (cmd === 'snapshot') api.playerState(playerSnap());
  else if (cmd === 'playFiles') playFiles(...args);
  else if (typeof Player[cmd] === 'function') Player[cmd](...args);
});
api.on('qm-action', async name => {
  if (name === 'media') (await import('./media.js')).openMedia();
  else if (name === 'padtest') (await import('./padtest.js')).openPadTest();
  else if (name === 'gallery') (await import('./gallery.js')).openGallery();
  else if (name === 'power') (await import('./actions.js')).powerMenu();
  else if (name === 'settings') nav.openSettings('controllers');
  else if (name === 'notifications') (await import('./actions.js')).showNotifications();
  // 'home' (PS5 Control Center): PC4 coming to the front is all it takes
});
api.on('task', t => {
  if (t.finished) {
    toast({ id: 'task', title: t.label, ico: 'check', progress: 1, duration: 2500, sound: false });
  } else {
    toast({ id: 'task', title: t.total ? 'Downloading artwork' : t.label, body: t.total ? `${t.label.replace(/^Downloading artwork · /, '')}  (${t.done + 1}/${t.total})` : '', ico: 'image', progress: t.total ? t.done / t.total : null, duration: 0, sound: false });
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) Music.pause(300);
  else if (!ctx.state.running.length && !ctx.appOpen) Music.resume();
});
window.addEventListener('focus', () => { if (!ctx.state.running.length && !ctx.appOpen) Music.resume(); });

// web pictures that fail (sites that block hotlinking, removed images) quietly disappear
document.addEventListener('error', e => {
  const t = e.target;
  if (t && t.tagName === 'IMG' && /^https?:/.test(t.src)) t.classList.add('broken');
}, true);

// a picture from the internet that fails takes its tile away: <img data-gone=".tile"> (data-gone-hide: hide it, the
// list's keyboard order stays the same). Instead of inline onerror handlers, which the page's security policy blocks.
document.addEventListener('error', e => {
  const t = e.target;
  if (!t || t.tagName !== 'IMG' || !t.dataset.gone) return;
  const tile = t.closest(t.dataset.gone);
  if (!tile) return;
  if (t.dataset.goneHide) { tile.classList.add('off'); tile.style.display = 'none'; } else tile.remove();
}, true);

// ---------------- start ----------------
pushLayer(home);
home.onShow();
Music.sync();

const params = new URLSearchParams(location.search);
const firstBoot = params.get('boot') === '1';
if (firstBoot && ctx.settings.bootAnimation) {
  Music.setTrack('intro');
  appRoot.style.opacity = '0';
  status.classList.add('hidden');
  home.root.classList.add('hidden');
  const block = { handle() {} }; // swallow input during the logo
  pushLayer(block);
  // while the logo shows, finish loading fonts and the first tiles so the reveal is instant and smooth
  const ready = Promise.all([
    fontsReady,
    document.fonts ? document.fonts.ready : null,
    ...[...document.querySelectorAll('#home img')].slice(0, 24).map(img => img.decode().catch(() => {})),
  ]);
  const boot = await bootLogo(ready);
  removeLayer(block);
  appRoot.style.transition = 'none';
  appRoot.style.opacity = '1';
  const signedIn = login();
  Music.play();
  await boot.reveal();
  await signedIn;
  Music.setTrack('home');
  appRoot.style.opacity = '';
  appRoot.style.transition = '';
  status.classList.remove('hidden');
  home.root.classList.remove('hidden');
} else {
  sfx('login');
}
home.playIntro();
Music.play();
if (!ctx.state.games.length) {
  setTimeout(() => toast({ title: 'Welcome to PC4', body: 'Open Game Import (first tile) to add your games.', ico: 'shapes', duration: 8000 }), 900);
}
