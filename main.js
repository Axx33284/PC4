const { app, BrowserWindow, ipcMain, dialog, shell, session, clipboard, desktopCapturer, globalShortcut, Notification, screen } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const Store = require('./src/main/store');
const { SCANNERS } = require('./src/main/importers');
const metadata = require('./src/main/metadata');
const Launcher = require('./src/main/launcher');
const { Assets } = require('./src/main/assets');
const { News } = require('./src/main/news');
const { Industry, readArticle } = require('./src/main/industry');
const { makeThumb, makeAllThumbs, accentColor, THUMBS_VERSION } = require('./src/main/images');
const themesong = require('./src/main/themesong');
const { searchImages } = require('./src/main/webimages');
const { YouTube } = require('./src/main/youtube');
const { Emulator, lightColor } = require('./src/main/emulator');
const perf = require('./src/main/perf');
const { Capture } = require('./src/main/capture');
const { shop } = require('./src/main/shop');
const Warp = require('./src/main/warp');
const { Updater } = require('./src/main/updater');

app.setAppUserModelId('com.ahmad.pc4');

// Dev harness: PC4_TEST=<steps.json> drives the UI off-screen and saves screenshots. Its steps run code in the main
// process, so it (and PC4_DATA / PC4_BENCH) only exists while developing, never in the installed app.
const DEV = !app.isPackaged;
const TEST = DEV && process.env.PC4_TEST ? JSON.parse(fs.readFileSync(process.env.PC4_TEST, 'utf8')) : null;
if (DEV && process.env.PC4_DATA) app.setPath('userData', process.env.PC4_DATA);

if (!TEST && !app.requestSingleInstanceLock()) app.quit();

// ---------------- log file ----------------
// userData/logs/pc4.log (kept under 1 MB, the previous one as pc4.old.log): what went wrong on a player's PC
const LOG = path.join(app.getPath('userData'), 'logs', 'pc4.log');
function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.map(p => (p instanceof Error ? p.stack || p.message : typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`;
  if (DEV) process.stdout.write(line);
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 1024 * 1024) fs.renameSync(LOG, LOG.replace(/\.log$/, '.old.log'));
    fs.appendFileSync(LOG, line);
  } catch {}
}
// an error in the main process is written down instead of stopping PC4 with an error box
process.on('uncaughtException', e => log('uncaught:', e));
process.on('unhandledRejection', e => log('unhandled rejection:', e));

// ---------------- hardening ----------------
// PC4's own pages never navigate away or open windows (links go out through app:openExternal, which checks them);
// pages with rules of their own (YouTube, the image search window) set them after this
app.on('web-contents-created', (_e, wc) => {
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e, url) => { if (wc.getURL().startsWith('file:') && !url.startsWith('file:')) e.preventDefault(); });
  wc.on('will-attach-webview', e => e.preventDefault());
});
// what PC4's pages may ask for: full screen, screen capture (recordings), the controller, copying text
const ALLOWED = new Set(['fullscreen', 'media', 'display-capture', 'hid', 'clipboard-sanitized-write']);
function lockPermissions(ses) {
  // 'media' (camera / microphone / capture) only for the hidden recorder page
  const ok = (wc, perm) => ALLOWED.has(perm) && (perm !== 'media' || !!(wc && /\/recorder\/index\.html/.test(wc.getURL())));
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(ok(wc, perm)));
  ses.setPermissionCheckHandler((wc, perm) => ok(wc, perm));
}
// a page that crashes comes back by itself instead of leaving a black screen (a few times, then it's written down)
const crashes = [];
function guardCrashes(w, name, recover) {
  w.webContents.on('render-process-gone', (_e, d) => {
    log(`${name} page gone:`, d.reason, d.exitCode);
    if (d.reason === 'clean-exit') return;
    const now = Date.now();
    crashes.push(now);
    while (crashes.length && now - crashes[0] > 60000) crashes.shift();
    if (crashes.length <= 3) setTimeout(recover, 500);
  });
  w.webContents.on('unresponsive', () => log(`${name} page not responding`));
}
app.on('child-process-gone', (_e, d) => { if (d.reason !== 'clean-exit') log('process gone:', d.type, d.reason, d.exitCode); });

let win = null;
let store = null;
let assets = null;
let news = null;
let industry = null;
let emulator = null;
let updater = null;
let hw = null; // this PC's hardware, for the Automatic performance mode
let capture = null;
let ytdlp = null;
let mode = 'desktop';
const launcher = new Launcher();
const youtube = new YouTube(() => win, (open, reason) => send('youtube', open, reason));

const PAGES = {
  desktop: path.join(__dirname, 'src', 'renderer', 'desktop', 'index.html'),
  fullscreen: path.join(__dirname, 'src', 'renderer', 'fullscreen', 'index.html'),
};
// The player's own sound pack, music and fonts (PC4 never ships Sony's). While developing: the folders next to the
// app. Installed, the app is a read-only archive, so they live in PC4's data folder: %APPDATA%\PC4\Sounds, Music, Fonts
const USER_ASSETS = app.isPackaged ? app.getPath('userData') : null;
const ASSET_DIRS = USER_ASSETS
  ? { sounds: path.join(USER_ASSETS, 'Sounds'), music: path.join(USER_ASSETS, 'Music'), fonts: path.join(USER_ASSETS, 'Fonts') }
  : { sounds: path.join(__dirname, 'assets', 'sounds'), music: path.join(__dirname, 'assets', 'music'), fonts: path.join(__dirname, 'assets', 'fonts') };
// installed: the folders exist from the first start, each with its README explaining what goes in it
function prepareAssetFolders() {
  if (!USER_ASSETS) return;
  for (const [k, dir] of Object.entries(ASSET_DIRS)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const readme = path.join(dir, 'README.txt');
      if (!fs.existsSync(readme)) fs.copyFileSync(path.join(__dirname, 'assets', k, 'README.txt'), readme);
      // each console style's own sounds / music
      if (k !== 'fonts') for (const sub of ['PS4', 'PS5']) {
        fs.mkdirSync(path.join(dir, sub), { recursive: true });
        const r = path.join(dir, sub, 'README.txt');
        if (k === 'sounds' && !fs.existsSync(r)) fs.copyFileSync(path.join(__dirname, 'assets', k, 'README.txt'), r);
      }
    } catch {}
  }
}

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function state() {
  return {
    ...store.snapshot(),
    ...assets.get(),
    news: store.settings.showNews ? news.items : [],
    industryVersion: industry.version, // the stories themselves are fetched with industry:get (they're big)
    emulator: emulator.state,
    update: updater ? updater.state : null,
    warp: warp ? warp.state : null,
    perf: perfState(),
    recording: capture ? capture.recording : false,
    capturesDir: capturesDir(),
    newsSources: Industry.sources,
    running: launcher.runningIds(),
    ytdlp: !!ytdlp,
    globalKeyErrors,
    mode,
  };
}

let pushT = null;
let statePending = false;
// While a game runs and PC4 is out of sight, the (large) state isn't sent at all: it goes out once PC4 or the
// Quick Menu overlay is on screen again. Nothing re-renders behind the game.
function pushState() {
  clearTimeout(pushT);
  pushT = setTimeout(() => {
    const hidden = inGame() && win && !win.isDestroyed() && (win.isMinimized() || !win.isVisible());
    const s = hidden && !overlayShown ? null : state();
    if (hidden) statePending = true;
    else { statePending = false; send('state', s); }
    if (overlayShown) overlaySend('state', s || state());
    else if (overlay) overlayStale = true;
  }, 80);
}
function flushState() { if (statePending) pushState(); }

const inGame = () => launcher.runningIds().length > 0;
// resolves once no game is running (background jobs wait for it)
function gameOver() {
  if (!inGame()) return Promise.resolve();
  return new Promise(resolve => {
    const check = () => { if (!inGame()) { launcher.off('stopped', check); setTimeout(resolve, 5000); } };
    launcher.on('stopped', check);
  });
}

// ---------------- game mode ----------------
// While a game runs PC4 steps back: its windows' processes go to Windows 11 efficiency mode (EcoQoS + idle
// priority, the main window's only below normal while music plays so it can't stutter), the rest below normal.
// The controller helper goes above normal so emulated input stays instant. Background jobs wait (gameOver()).
let gameModeOn = false;
let musicPlaying = false;
function applyGameMode() {
  const on = inGame();
  const ov = overlay && !overlay.isDestroyed() ? overlay.webContents.getOSProcessId() : 0;
  const main = win && !win.isDestroyed() ? win.webContents.getOSProcessId() : 0;
  const eco = [], low = [], normal = [];
  for (const m of app.getAppMetrics()) {
    if (!on) normal.push(m.pid);
    else if (m.pid === ov && overlayShown) normal.push(m.pid);
    else if (m.type === 'Utility' && /audio/i.test(m.serviceName || m.name || '')) normal.push(m.pid); // sound
    else if (m.type === 'GPU') (overlayShown ? normal : eco).push(m.pid); // the overlay draws through it
    else if (m.pid === main) (musicPlaying ? low : eco).push(m.pid);
    else if (m.type === 'Tab') eco.push(m.pid);
    else low.push(m.pid); // the main process (PS button, captures) and the other helpers
  }
  if (!on && !gameModeOn) return;
  gameModeOn = on;
  Launcher.setPriority(normal, 0);
  Launcher.setPriority(low, 1);
  Launcher.setPriority(eco, 2);
  const helper = emulator && emulator.proc;
  if (helper && helper.pid) try { os.setPriority(helper.pid, on ? os.constants.priority.PRIORITY_ABOVE_NORMAL : os.constants.priority.PRIORITY_NORMAL); } catch {}
}

// ---------------- the Quick Menu over a game ----------------
// Hold PS during a game: a transparent, always-on-top window shows the Quick Menu over the game, like the
// PS4's, instead of switching back to PC4. It's made a little after a game starts and closed with the game.
const OVERLAY_PAGE = path.join(__dirname, 'src', 'renderer', 'overlay', 'index.html');
let overlay = null;
let overlayReady = null;
let overlayShown = false;
let overlayShownAt = 0;
let overlayStale = false;
let overlayTimer = null;
let gameHwnd = 0;
let overlayTookFocus = false; // false: the game kept the screen (Xbox emulation: its virtual pad is frozen instead)

function overlaySend(ch, ...args) { if (overlay && !overlay.isDestroyed()) overlay.webContents.send(ch, ...args); }
const hwndOf = w => { const b = w.getNativeWindowHandle(); return b.length >= 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0); };
// the screen PC4 runs on (where games open too)
const gameDisplay = () => (TEST ? { bounds: { x: -5000, y: 0, width: 1920, height: 1080 } } : screen.getDisplayMatching(win && !win.isDestroyed() ? win.getBounds() : screen.getPrimaryDisplay().bounds));

function createOverlay() {
  if (overlay && !overlay.isDestroyed()) return overlayReady;
  overlay = new BrowserWindow({
    ...gameDisplay().bounds,
    show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, title: 'PC4 Quick Menu',
    // paintWhenInitiallyHidden false: otherwise Electron paints the never-shown window at 60 fps during the game
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: true, spellcheck: false, paintWhenInitiallyHidden: false },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setMenuBarVisibility(false);
  overlayReady = new Promise(r => overlay.webContents.once('did-finish-load', r));
  overlay.loadFile(OVERLAY_PAGE);
  overlay.on('closed', () => { overlay = null; overlayReady = null; overlayShown = false; });
  guardCrashes(overlay, 'Quick Menu', () => { hideOverlay(false); destroyOverlay(); }); // made again the next time
  if (TEST) overlay.webContents.on('console-message', e => console.log(`[overlay:${e.level}] ${e.message}`));
  // Alt+Tab or a click on the game: the menu goes away (a moment after opening, focus can still settle)
  overlay.on('blur', () => { if (overlayShown && overlayTookFocus && Date.now() - overlayShownAt > 700) hideOverlay(false); });
  return overlayReady;
}

function destroyOverlay() {
  clearTimeout(overlayTimer);
  if (overlay && !overlay.isDestroyed()) overlay.destroy();
  overlay = null; overlayShown = false;
}

async function showOverlay({ keyboard = false } = {}) {
  if (overlayShown) { overlaySend('overlay-toggle'); return; }
  await createOverlay();
  if (!overlay || !inGame()) return;
  overlayShown = true;
  overlayShownAt = Date.now();
  gameHwnd = await Launcher.foregroundWindow(); // to give the screen back to exactly this window
  overlay.setBounds(gameDisplay().bounds);
  overlaySend('state', state());
  overlayStale = false;
  applyGameMode();
  // The menu reads the controller through the helper, not the focused window. With Xbox emulation the game only
  // sees the virtual pad, which holds still while the menu is open, so the game keeps the screen: nothing flickers
  // and fullscreen games don't minimize. Without emulation the game reads the controller itself, so the menu has
  // to take the focus for the game to ignore it.
  const emulating = !!(emulator && emulator.emulating);
  overlayTookFocus = (!emulating || keyboard) && !TEST;
  if (emulator) emulator.freeze(true);
  send('overlay-shown', true);
  if (overlayTookFocus) { overlay.show(); overlay.focus(); } else overlay.showInactive();
  overlaySend('overlay-open');
  if (emulator) emulator.menu(true); // after the page reset its buttons: the first report is "already held"
  if (!overlayTookFocus) return;
  // Windows may refuse the focus to a background app: take it the way elevated games are brought forward
  setTimeout(async () => {
    if (!overlayShown || !overlay || overlay.isFocused()) return;
    await Launcher.frontWindow(hwndOf(overlay));
    await new Promise(r => setTimeout(r, 150));
    // an administrator game keeps the focus from a normal program: PC4's elevated assistant takes it
    // (registered with the game's tasks, running while such a game runs)
    if (overlayShown && overlay && !overlay.isFocused() && Launcher.assistFront(hwndOf(overlay))) await new Promise(r => setTimeout(r, 350));
    // still no focus (no assistant: "Ask Every Time" mode): the game still reads the controller while the menu is open
    if (overlayShown && overlay && !overlay.isFocused()) {
      overlayTookFocus = false;
      overlaySend('overlay-hint', 'The game still reacts to your controller while this menu is open (it runs as administrator). Turn on Xbox Emulation so only the menu gets the buttons.');
    }
  }, 120);
}

function hideOverlay(backToGame = true) {
  if (!overlayShown) return;
  overlayShown = false;
  overlaySend('overlay-close');
  if (overlay && !overlay.isDestroyed()) overlay.hide();
  if (emulator) { emulator.menu(false); emulator.freeze(false); }
  send('overlay-shown', false);
  applyGameMode();
  if (overlayTookFocus && backToGame && gameHwnd && !TEST) {
    const hwnd = gameHwnd;
    Launcher.frontWindow(hwnd).then(ok => { if (!ok) Launcher.assistFront(hwnd); });
  }
  overlayTookFocus = false;
}

function createWindow() {
  const argMode = process.argv.includes('--fullscreen') ? 'fullscreen' : process.argv.includes('--desktop') ? 'desktop' : null;
  mode = argMode || store.settings.startupMode || 'desktop';
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    backgroundColor: mode === 'fullscreen' ? '#000000' : '#151515',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#151515', symbolColor: '#f2f2f2', height: 50 }, // Playnite's top panel
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false, // no dictionaries to load: saves memory and start-up time
    },
  });
  win.setMenuBarVisibility(false);
  guardCrashes(win, 'PC4', () => { if (win && !win.isDestroyed()) loadMode(mode); });
  loadMode(mode, true);
  if (TEST) runTest();
  else win.once('ready-to-show', () => win.show());
  win.on('enter-full-screen', () => send('fullscreen-changed', true));
  win.on('leave-full-screen', () => send('fullscreen-changed', false));
  // PC4 back on screen after a game: send what changed while it was hidden
  for (const ev of ['restore', 'show', 'focus']) win.on(ev, flushState);
}

async function runTest() {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  win.setBounds({ x: -5000, y: 0, width: TEST.width || 1920, height: TEST.height || 1080 });
  win.showInactive();
  win.webContents.on('console-message', e => console.log(`[renderer:${e.level}] ${e.message}`));
  await new Promise(r => win.webContents.once('did-finish-load', r));
  for (const s of TEST.steps) {
    if (s.wait) await wait(s.wait);
    if (s.key) {
      for (let i = 0; i < (s.repeat || 1); i++) {
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: s.key });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: s.key });
        await wait(s.gap || 120);
      }
    }
    if (s.eval) console.log('[eval]', JSON.stringify(await win.webContents.executeJavaScript(s.eval)));
    if (s.main) console.log('[main]', JSON.stringify(await eval(s.main))); // eslint-disable-line no-eval
    if (s.shot) {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.resolve(path.dirname(process.env.PC4_TEST), s.shot), img.toPNG());
      console.log('[shot]', s.shot);
    }
  }
  app.quit();
}

function loadMode(m, initial = false) {
  mode = m;
  youtube.close();
  if (!TEST) win.setFullScreen(m === 'fullscreen');
  win.setBackgroundColor(m === 'fullscreen' ? '#000000' : '#151515');
  win.loadFile(PAGES[m], { query: { boot: initial ? '1' : '0' } });
}

function restoreWindow() {
  if (!win || TEST) return; // the test harness never takes the screen
  if (win.isMinimized()) win.restore();
  win.show();
  // Windows blocks focus stealing; briefly going on top brings us back in front of the game's desktop
  win.setAlwaysOnTop(true);
  win.focus();
  setTimeout(() => win && win.setAlwaysOnTop(false), 400);
  if (mode === 'fullscreen' && !win.isFullScreen() && !TEST) win.setFullScreen(true);
}

// ---------------- artwork ----------------
const IMAGE_KINDS = ['cover', 'hero', 'background', 'logo', 'icon'];

function removeMedia(dir, file) {
  if (file) try { fs.unlinkSync(path.join(dir, file)); } catch {}
}

function replaceMedia(dir, media, kind, file) {
  removeMedia(dir, media[kind]);
  if (file) media[kind] = file;
  else delete media[kind];
  try { makeThumb(dir, media, kind); } catch {}
  if (['background', 'hero', 'cover'].includes(kind)) { try { media.accent = accentColor(dir, media); } catch {} }
}

async function fetchMetadata(gameId, { appId = null, force = false } = {}) {
  const game = store.getGame(gameId);
  if (!game) return null;
  let id = appId || (game.meta && game.meta.steamAppId);
  if (!id) {
    try {
      const m = await metadata.bestSteamMatch(game.name);
      if (m) id = m.appId;
    } catch {}
  }
  const dir = store.gameDir(game.id);
  const media = { ...game.media };
  let meta = { ...game.meta };
  if (id) {
    const { info, urls } = await metadata.steamDetails(id);
    meta = {
      ...meta,
      steamAppId: Number(id),
      description: info.description || (force ? '' : meta.description) || '',
      developers: info.developers || meta.developers || [],
      publishers: info.publishers || meta.publishers || [],
      genres: info.genres || meta.genres || [],
      releaseDate: info.releaseDate || meta.releaseDate || '',
      controllers: info.controllers || meta.controllers || null,
    };
    for (const kind of IMAGE_KINDS) {
      if (!force && media[kind]) continue;
      const f = await metadata.downloadFirst(urls[kind], path.join(dir, `${kind}-${Date.now()}`));
      if (f) replaceMedia(dir, media, kind, path.basename(f));
      else if (force) replaceMedia(dir, media, kind, null);
    }
  }
  const l = game.launch || {};
  if (!media.icon && l.type === 'exe' && /\.exe$/i.test(l.target || '') && fs.existsSync(l.target)) {
    try {
      const img = await app.getFileIcon(l.target, { size: 'large' });
      const file = `icon-${Date.now()}.png`;
      fs.writeFileSync(path.join(dir, file), img.toPNG());
      media.icon = file;
    } catch {}
  }
  media.thumbsV = THUMBS_VERSION;
  return store.updateGame(game.id, { media, meta });
}

const queue = [];
let queueBusy = false;
let queueDone = 0;
let queueTotal = 0;

function enqueueMetadata(ids) {
  for (const id of ids) if (!queue.includes(id)) { queue.push(id); queueTotal++; }
  runQueue();
}

async function runQueue() {
  if (queueBusy) return;
  queueBusy = true;
  while (queue.length) {
    await gameOver(); // artwork downloads wait while a game runs
    const id = queue.shift();
    const g = store.getGame(id);
    if (g) {
      send('task', { label: `Downloading artwork · ${g.name}`, done: queueDone, total: queueTotal });
      try { await fetchMetadata(id); } catch (e) { console.warn('metadata failed', g.name, e.message); }
    }
    queueDone++;
  }
  send('task', { label: 'Artwork up to date', done: queueTotal, total: queueTotal, finished: true });
  queueDone = queueTotal = 0;
  queueBusy = false;
}

// One-time upgrade for games added before wallpapers/thumbnails existed.
async function upgradeLibrary() {
  // drop entries whose files are gone (older versions could leave these behind)
  for (const g of [...store.games]) {
    const dir = path.join(store.mediaDir, g.id);
    const media = { ...(g.media || {}) };
    let changed = false;
    for (const [k, v] of Object.entries(media)) {
      if (typeof v === 'string' && /\.\w+$/.test(v) && !fs.existsSync(path.join(dir, v))) { delete media[k]; changed = true; }
    }
    if (changed) store.updateGame(g.id, { media });
  }
  for (const g of [...store.games]) {
    if (g.media && g.media.thumbsV !== THUMBS_VERSION) {
      const media = makeAllThumbs(store.gameDir(g.id), { ...g.media });
      store.updateGame(g.id, { media });
      await new Promise(r => setImmediate(r));
    }
  }
  enqueueMetadata(store.games.filter(g => g.meta && g.meta.steamAppId && !g.media.background).map(g => g.id));
  // controller support for games that were added before PC4 read it
  const need = store.games.filter(g => g.meta && g.meta.steamAppId && !(g.meta.controllers && g.meta.controllers.checked));
  if (need.length) {
    try {
      const info = await metadata.steamControllers(need.map(g => g.meta.steamAppId));
      for (const g of need) if (info[g.meta.steamAppId]) store.updateGame(g.id, { meta: { controllers: info[g.meta.steamAppId] } });
    } catch (e) { console.warn('controller info failed', e.message); }
  }
}

// ---------------- theme songs ----------------
const songJobs = new Map(); // gameId -> promise

async function findThemeSong(gameId, { manual = false, url = null } = {}) {
  const g = store.getGame(gameId);
  if (!g) return { ok: false, error: 'Game not found' };
  if (!ytdlp) return { ok: false, error: 'yt-dlp is not installed. Install it with "winget install yt-dlp", then restart PC4.' };
  if (!manual && (g.media.music || g.media.musicMissing)) return { ok: !!g.media.music };
  if (songJobs.has(gameId)) return songJobs.get(gameId);
  const job = (async () => {
    const dir = store.gameDir(gameId);
    try {
      // a song the user picked from the search or pasted as a link, otherwise the best match for the name
      const file = url ? await themesong.downloadSongUrl(ytdlp, url, dir) : await themesong.downloadThemeSong(ytdlp, g.name, dir);
      const cur = store.getGame(gameId);
      const media = { ...cur.media };
      removeMedia(dir, media.music);
      media.music = path.basename(file);
      delete media.musicMissing;
      store.updateGame(gameId, { media });
      return { ok: true };
    } catch (e) {
      const cur = store.getGame(gameId);
      if (cur && !cur.media.music && !url) store.updateGame(gameId, { media: { ...cur.media, musicMissing: true } });
      return { ok: false, error: e.message };
    } finally {
      songJobs.delete(gameId);
    }
  })();
  songJobs.set(gameId, job);
  return job;
}

async function findAllThemeSongs() {
  const todo = store.games.filter(g => !g.hidden && !g.media.music);
  let done = 0;
  for (const g of todo) {
    await gameOver();
    send('task', { label: `Finding theme song · ${g.name}`, done, total: todo.length });
    await findThemeSong(g.id, { manual: true });
    done++;
  }
  send('task', { label: 'Theme songs up to date', done: todo.length, total: todo.length, finished: true });
}

// ---------------- news ----------------
async function refreshIndustry() {
  if (store.settings.industryNews === false) return industry.data();
  try { return await industry.refresh(store.settings.newsSources || {}); } catch (e) { console.warn('industry news failed', e.message); return industry.data(); }
}

async function refreshNews() {
  if (industry.stale()) refreshIndustry();
  if (!store.settings.showNews) return [];
  try { await news.refresh(store.games); } catch (e) { console.warn('news failed', e.message); }
  return news.items;
}

// ---------------- importing ----------------
async function importLibraries(sources = Object.keys(SCANNERS)) {
  const summary = { added: 0, updated: 0, sources: {} };
  const newIds = [];
  for (const s of sources) {
    send('task', { label: `Scanning ${s === 'gog' ? 'GOG' : s[0].toUpperCase() + s.slice(1)} library…`, done: 0, total: 0 });
    let r;
    try { r = await SCANNERS[s](); } catch (e) { r = { found: false, games: [], error: e.message }; }
    summary.sources[s] = { found: r.found, count: r.games.length };
    const seen = new Set();
    for (const g of r.games) {
      seen.add(String(g.sourceId));
      const existing = store.findBySource(s, g.sourceId);
      if (existing) {
        store.updateGame(existing.id, { installDir: g.installDir, installed: g.installed, launch: g.launch });
        summary.updated++;
      } else {
        newIds.push(store.addGame(g).id);
        summary.added++;
      }
    }
    for (const g of store.games) {
      if (g.source === s && g.installed && !seen.has(String(g.sourceId))) store.updateGame(g.id, { installed: false });
    }
  }
  if (summary.added) store.addActivity({ type: 'import', count: summary.added });
  const missing = store.games.filter(g => !g.media || !g.media.cover).map(g => g.id);
  enqueueMetadata([...new Set([...newIds, ...missing])]);
  if (!queue.length && !queueBusy) send('task', { label: 'Import finished', done: 1, total: 1, finished: true });
  if (summary.added) setTimeout(() => gameOver().then(refreshNews), 20000);
  return summary;
}

function productName(file) {
  return new Promise(resolve => {
    const ps = `(Get-Item -LiteralPath '${file.replace(/'/g, "''")}').VersionInfo.ProductName`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }, (err, out) => resolve(err ? '' : out.trim()));
  });
}

function prettify(s) {
  return s.replace(/[-_.]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
}

const GENERIC_EXE = /^(game|launcher|start|play|run|setup|client|main|app|win64|win32|x64|bin|binaries|shipping)$/i;

async function addFromPath(file) {
  const ext = path.extname(file).toLowerCase();
  let launch = { type: 'exe', target: file, args: '', workingDir: path.dirname(file) };
  let installDir = path.dirname(file);
  let name = prettify(path.basename(file, ext));
  const meta = {};
  if (ext === '.lnk') {
    try {
      const s = shell.readShortcutLink(file);
      if (s.target) {
        launch = { type: 'exe', target: s.target, args: s.args || '', workingDir: s.cwd || path.dirname(s.target) };
        installDir = path.dirname(s.target);
      }
    } catch {}
  } else if (ext === '.url') {
    const m = fs.readFileSync(file, 'utf8').match(/^URL=(.+)$/m);
    if (m) {
      launch = { type: 'url', target: m[1].trim(), args: '', workingDir: '' };
      installDir = '';
      const steam = m[1].match(/steam:\/\/rungameid\/(\d+)/);
      if (steam) meta.steamAppId = Number(steam[1]);
    }
  } else if (ext === '.exe') {
    const pn = await productName(file);
    if (pn && !/unreal|unity|launcher|bootstrap/i.test(pn)) name = pn;
    else if (GENERIC_EXE.test(path.basename(file, ext).replace(/-win64-shipping$/i, ''))) {
      // use the first parent folder that is not a binaries folder
      const parts = path.dirname(file).split(path.sep).reverse();
      const folder = parts.find(p => !/^(bin|binaries|win64|win32|x64|x86|game)$/i.test(p));
      if (folder) name = prettify(folder);
    }
    name = name.replace(/-?win64-?shipping$/i, '').trim();
  }
  const g = store.addGame({ name, source: 'manual', launch, installDir, meta });
  enqueueMetadata([g.id]);
  return g;
}

// ---------------- controller light bar (WebHID) ----------------
const SONY = 0x054c;

// PC4 may talk to Sony controllers (and only those) to set the light bar colour.
function allowSonyControllers() {
  const ses = session.defaultSession;
  lockPermissions(ses);
  ses.setDevicePermissionHandler(d => d.deviceType === 'hid' && d.device.vendorId === SONY);
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const d = details.deviceList.find(x => x.vendorId === SONY);
    callback(d ? d.deviceId : '');
  });
}

// ---------------- captures ----------------
function capturesDir() { return store.settings.captureDir || path.join(app.getPath('pictures'), 'PC4 Captures'); }
function playingName() {
  const id = launcher.runningIds()[0];
  const g = id && store.getGame(id);
  return g ? g.name : 'PC4';
}
function initCaptures() {
  capture = new Capture({
    dir: capturesDir, game: playingName,
    preload: path.join(__dirname, 'src', 'renderer', 'recorder', 'preload.js'),
    page: path.join(__dirname, 'src', 'renderer', 'recorder', 'index.html'),
  });
  // the recorder asks for the screen: give it the whole screen and the PC's sound
  session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => {
    desktopCapturer.getSources({ types: ['screen'] }).then(list => cb({ video: list[0], audio: 'loopback' })).catch(() => cb({}));
  });
  const tell = msg => {
    send('capture', msg);
    // while a game is in front PC4's own toasts can't be seen: a quiet Windows notification instead
    const focused = win && !win.isDestroyed() && win.isFocused();
    if (!focused && store.settings.captureNotify !== false && Notification.isSupported()) new Notification({ title: msg.title, body: msg.body || '', silent: true }).show();
  };
  capture.on('saved', i => tell({ event: 'saved', ...i, title: i.kind === 'video' ? 'Video clip saved' : 'Screenshot saved', body: i.game }));
  capture.on('recording', r => { tell({ event: 'recording', on: r.on, title: r.on ? 'Recording started' : 'Recording stopped', body: r.on ? `${r.game} · press Share again (hold) to stop` : r.game }); pushState(); });
  capture.on('error', m => tell({ event: 'error', title: "Couldn't capture", body: m }));
  applyCaptureKeys();
}
// Keyboard shortcuts that work from anywhere, games included (Settings › Keyboard; renderer keys.js has the same
// defaults). settings.globalKeys holds only what was changed; '' turns one off.
const GLOBAL_KEYS = { quickmenu: 'Control+Alt+F3', home: 'Control+Alt+Home', screenshot: 'Control+Alt+S', record: 'Control+Alt+R' };
let globalKeysPaused = false;  // Settings is waiting for a new key combination: PC4 mustn't catch it itself
let globalKeyErrors = [];      // taken by another program
function applyCaptureKeys() {
  globalShortcut.unregisterAll();
  globalKeyErrors = [];
  if (TEST || globalKeysPaused) return;
  const s = store.settings;
  const run = {
    quickmenu: () => keyQuickMenu(),
    home: () => { hideOverlay(false); restoreWindow(); send('go-home'); },
    screenshot: () => capture.screenshot(),
    record: () => capture.toggleRecording(store.settings.captureMaxMinutes || 30),
  };
  for (const [id, def] of Object.entries(GLOBAL_KEYS)) {
    const acc = (s.globalKeys || {})[id] ?? def;
    if (!acc || ((id === 'screenshot' || id === 'record') && s.captureKeys === false)) continue;
    let ok = false;
    try { ok = globalShortcut.register(acc, run[id]); } catch {}
    if (!ok) globalKeyErrors.push(id);
  }
}
// the Quick Menu from the keyboard: over the game while one is in front, otherwise in PC4
function keyQuickMenu() {
  if (store.settings.quickMenu === false) return;
  const focused = win && !win.isDestroyed() && win.isFocused() && !win.isMinimized();
  if (overlayShown) { hideOverlay(true); return; }
  if (!focused && inGame()) { showOverlay({ keyboard: true }); return; }
  if (!focused) restoreWindow();
  send('quickmenu');
}

// ---------------- Media Player: browsing the PC's music and videos ----------------
const VIDEO_EXT = /\.(mp4|m4v|webm|mkv|mov)$/i;
const AUDIO_EXT = /\.(mp3|m4a|aac|flac|wav|ogg|opus)$/i;
function mediaRoots() {
  const roots = [
    { name: 'Videos', path: app.getPath('videos'), icon: 'video' },
    { name: 'Music', path: app.getPath('music'), icon: 'music' },
    { name: 'Downloads', path: app.getPath('downloads'), icon: 'download' },
    ...(store.settings.mediaFolders || []).map(p => ({ name: path.basename(p) || p, path: p, icon: 'folder', custom: true })),
  ];
  return roots.filter(r => { try { return fs.statSync(r.path).isDirectory(); } catch { return false; } });
}
async function mediaList(dir) {
  const out = [];
  let ents = [];
  try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name.startsWith('.') || /^(desktop\.ini|thumbs\.db)$/i.test(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push({ name: e.name, path: p, kind: 'folder' });
    else if (VIDEO_EXT.test(e.name)) out.push({ name: e.name, path: p, kind: 'video' });
    else if (AUDIO_EXT.test(e.name)) out.push({ name: e.name, path: p, kind: 'audio' });
  }
  const order = { folder: 0, video: 1, audio: 2 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

// ---------------- performance ----------------
// settings.performance: 'auto' | 'full' | 'light'. Automatic picks Light on older PCs (see perf.js).
function perfState() {
  if (!hw) hw = perf.hardware(app);
  const mode = store.settings.performance || 'auto';
  const disk = store.settings.diskType || null;
  return { ...hw, disk, mode, light: mode === 'light' || (mode === 'auto' && hw.weak) };
}

// ---------------- Xbox controller emulation ----------------
// emuMode: 'off' | 'always' (while PC4 runs) | 'games' (only while a game is running)
// The helper also runs in 'watch' mode (no emulation) when PC4 needs the PS / Share buttons during games:
// hold PS for the Quick Menu, PS tap for the home screen, Share for captures.
// Controller passthrough: while a game (started from an .exe) runs, the helper hides the real PlayStation pad and
// hands the game a virtual DUALSHOCK 4 with everything passed through. The game still sees a PlayStation pad, but
// PC4 owns the real one, like a PS4 does: holding PS shows the Quick Menu on top of the game without taking the
// focus (no flicker, fullscreen games stay put) and the game gets nothing until the menu closes.
let passthroughOn = false;
function wantPassthrough(g) {
  const s = store.settings;
  return s.padPassthrough !== false && s.quickMenu !== false && (!s.emuMode || s.emuMode === 'off')
    && !!(g && g.launch && g.launch.type === 'exe')             // Steam / Epic games: Steam Input already owns the pad
    && !!emulator.state.hidhide && (emulator.state.pads || []).length > 0;
}
// switch to passthrough before the game starts, so it never opens the real controller
async function startPassthrough(g) {
  if (!wantPassthrough(g)) return false;
  passthroughOn = true;
  syncEmulator();
  const ok = await emulator.ready('ds4', 4000);
  if (!ok) { passthroughOn = false; syncEmulator(); } // no ViGEmBus, no controller…: the Quick Menu takes the focus instead
  return ok;
}

function syncEmulator(reason) {
  const s = store.settings;
  const emulate = s.emuMode === 'always' || (s.emuMode === 'games' && launcher.runningIds().length > 0);
  const watch = s.quickMenu !== false || !!s.psHome || s.captureShare !== false;
  const mode = emulate ? 'emulate' : passthroughOn ? 'ds4' : watch ? 'watch' : null;
  if (!mode) { if (emulator.wantRunning) emulator.stop(); return; }
  if (!emulator.wantRunning || emulator.mode !== mode) emulator.start(s, lightColor(s), mode);
  else if (reason === 'settings') emulator.update(s, lightColor(s));
}

// PS / Guide / Share presses reported by the helper (they work while a game has the screen)
function onPadButton(button, ev) {
  const s = store.settings;
  const focused = win && !win.isDestroyed() && win.isFocused() && !win.isMinimized();
  if (button === 'share') { if (s.captureShare !== false) ev === 'hold' ? capture.toggleRecording(s.captureMaxMinutes || 30) : capture.screenshot(); return; }
  // "Press PS to Start PC4": PS in Desktop Mode (no game running) turns PC4 into the console
  if (s.psWake && mode === 'desktop' && ev === 'tap' && !inGame()) { toConsole(); return; }
  // PlayStation pads are read by the page itself while PC4 (or the overlay) is in front; Xbox's Guide button never is
  if (button === 'ps' && focused) return;
  // the menu is over the game: PS (tap or hold) puts it away, or goes home when PS taps are set to do that
  if (overlayShown) {
    if (ev === 'tap' && s.psHome) { hideOverlay(false); restoreWindow(); send('go-home'); }
    else overlaySend('overlay-toggle');
    return;
  }
  if (ev === 'hold' && s.quickMenu !== false) {
    // over a game: the Quick Menu comes up on top of it, the game stays on screen
    if (!focused && inGame() && !TEST) { showOverlay(); return; }
    if (!focused) restoreWindow();
    send('quickmenu');
  } else if (ev === 'tap' && (s.psHome || button === 'guide')) {
    if (!focused && inGame()) { restoreWindow(); send('go-home'); }
    else if (button === 'guide') send('pad-home');
  }
}

// ---------------- Press PS to Start PC4 ----------------
// pc4wake.exe (the controller helper without a window) runs from the Windows sign-in. While PC4 is closed it waits
// for the PS / Xbox Guide button and starts PC4 in Console Mode; while PC4 runs it lets go of the controller.
const RUN_KEY = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`;
const WAKE_NAME = 'PC4 PS Button';
function wakeCommand() {
  // installed: PC4.exe --fullscreen; while developing: electron.exe <app folder> --fullscreen
  return [process.execPath, ...(app.isPackaged ? [] : [app.getAppPath()]), '--fullscreen'];
}
async function applyPsWake() {
  if (TEST) return;
  const reg = args => new Promise(r => execFile('reg.exe', args, { windowsHide: true }, err => r(!err)));
  if (!store.settings.psWake) {
    await reg(['delete', RUN_KEY, '/v', WAKE_NAME, '/f']);
    execFile('taskkill.exe', ['/IM', 'pc4wake.exe', '/F'], { windowsHide: true }, () => {});
    return;
  }
  try { await emulator.ensureWake(); } catch (e) { log('PS button start:', e); return; }
  const args = ['standby', ...wakeCommand()];
  const q = a => (/\s/.test(a) ? `"${a}"` : a);
  await reg(['add', RUN_KEY, '/v', WAKE_NAME, '/t', 'REG_SZ', '/d', [emulator.wakeExe, ...args].map(q).join(' '), '/f']);
  // running now too (a second copy quits by itself), so it works as soon as PC4 is closed
  const p = require('child_process').spawn(emulator.wakeExe, args, { detached: true, stdio: 'ignore', windowsHide: true });
  p.on('error', e => log('PS button start:', e));
  p.unref();
}
function toConsole() {
  if (!win || win.isDestroyed()) return;
  if (mode !== 'fullscreen') loadMode('fullscreen');
  restoreWindow();
}

// ---------------- secure connection (Cloudflare WARP) ----------------
// Games marked "Secure Connection" (g.warp) start with WARP on: it's switched on first and PC4 waits until it's
// connected, so the game's first request already goes through Cloudflare (Roblox in Turkey, blocked servers…).
// When PC4 turned it on, it goes off again with the last game (setting warpAutoOff).
let warp = null;
let warpOffTimer = null;
const warpToast = m => send('warp', m);
async function warpForGame(g) {
  if (!g || !g.warp) return;
  if (!warp.find()) { warpToast({ event: 'missing', game: g.name }); return; }
  await warp.refresh();
  if (warp.connected) return;
  warpToast({ event: 'connecting', game: g.name });
  const r = await warp.connect({ byPC4: true, route: store.settings.warpRoute || 'games' });
  warpToast(r.ok ? { event: 'on', game: g.name } : { event: 'failed', game: g.name, error: r.error });
}
async function warpAfterGames() {
  if (inGame() || !warp || !warp.state.byPC4 || store.settings.warpAutoOff === false) return;
  // a little later: a game that restarts itself (an update, a launcher handing over) must not lose its connection
  clearTimeout(warpOffTimer);
  await new Promise(r => { warpOffTimer = setTimeout(r, 20000); });
  if (inGame() || !warp.state.byPC4) return;
  const r = await warp.disconnect();
  if (r.ok) warpToast({ event: 'off' });
}

// ---------------- IPC ----------------
function handle(ch, fn) {
  ipcMain.handle(ch, async (_e, ...args) => fn(...args));
}

function registerIpc() {
  handle('state:get', () => state());
  handle('settings:update', async patch => {
    const s = store.updateSettings(patch);
    if ('soundPackDir' in patch || 'music' in patch || 'introMusic' in patch) assets.invalidate();
    if ('muteAll' in patch) youtube.setMuted(s.muteAll);
    if ('captureKeys' in patch || 'globalKeys' in patch) { applyCaptureKeys(); pushState(); }
    // the route changed while connected: apply it now
    if ('warpRoute' in patch && warp && warp.connected) warp.connect({ route: s.warpRoute || 'games' });
    if ('psWake' in patch) applyPsWake();
    if (Object.keys(patch).some(k => k.startsWith('emu') || k.startsWith('lightBar') || ['quickMenu', 'psHome', 'captureShare'].includes(k))) syncEmulator('settings');
    if ('ytdlpPath' in patch) { themesong.resetYtDlpCache(); ytdlp = await themesong.findYtDlp(s.ytdlpPath); pushState(); }
    if (patch.showNews) refreshNews();
    if ('newsSources' in patch || patch.industryNews) refreshIndustry();
    return s;
  });

  handle('game:add', partial => store.addGame(partial));
  handle('game:addFromPath', file => addFromPath(file));
  handle('game:update', (id, patch) => store.updateGame(id, patch));
  handle('game:remove', id => store.removeGame(id));
  handle('game:launch', async id => {
    const g = store.getGame(id);
    if (!g) return { ok: false, error: 'Game not found' };
    if (!launcher.isRunning(id)) await warpForGame(g);
    if (!launcher.isRunning(id) && !TEST) await startPassthrough(g);
    const r = await launcher.launch(g, { admin: store.settings.adminGames });
    if (!r.ok && passthroughOn && !inGame()) { passthroughOn = false; syncEmulator(); }
    if (r.ok && !r.already) {
      store.updateGame(id, { lastPlayed: Date.now(), playCount: (g.playCount || 0) + 1, ...(r.moved || {}) });
      // the game's splash stays on screen for the chosen time, then PC4 steps aside (only if the game is still running)
      const secs = store.settings.splashSeconds ?? 60;
      if (store.settings.minimizeOnLaunch !== false && secs > 0 && !TEST) {
        setTimeout(() => { if (win && launcher.isRunning(id)) win.minimize(); }, secs * 1000);
      }
    }
    return r;
  });
  handle('game:close', id => { const g = store.getGame(id); return g ? launcher.close(g) : { ok: false }; });
  handle('game:fetchMetadata', (id, opts) => fetchMetadata(id, opts || {}));
  handle('game:refreshAll', () => enqueueMetadata(store.games.map(g => g.id)));
  handle('game:setImage', async (id, kind, src) => {
    const g = store.getGame(id);
    if (!g) return null;
    const dir = store.gameDir(id);
    const media = { ...g.media };
    if (src && src.url) {
      const f = await metadata.download(src.url, path.join(dir, `${kind}-${Date.now()}`), src.referer || null);
      if (!f) throw new Error('That site did not allow the download. Try another image.');
      replaceMedia(dir, media, kind, path.basename(f));
    } else if (src && src.file) {
      const file = `${kind}-${Date.now()}${path.extname(src.file).toLowerCase() || '.png'}`;
      fs.copyFileSync(src.file, path.join(dir, file));
      replaceMedia(dir, media, kind, file);
    } else {
      replaceMedia(dir, media, kind, null);
    }
    return store.updateGame(id, { media, artAdjust: { ...(g.artAdjust || {}), [kind]: null } });
  });
  handle('game:setMusic', (id, file) => {
    const g = store.getGame(id);
    if (!g) return null;
    const dir = store.gameDir(id);
    const media = { ...g.media };
    removeMedia(dir, media.music);
    delete media.music;
    if (file) {
      const name = `music-${Date.now()}${path.extname(file).toLowerCase()}`;
      fs.copyFileSync(file, path.join(dir, name));
      media.music = name;
      delete media.musicMissing;
    } else {
      media.musicMissing = true; // removed on purpose: don't auto-download again
    }
    return store.updateGame(id, { media });
  });
  handle('game:findThemeSong', (id, manual) => findThemeSong(id, { manual }));
  handle('game:findAllThemeSongs', () => { findAllThemeSongs(); return true; });
  handle('game:setThemeSongUrl', (id, url) => {
    if (!/^https?:\/\/\S+$/i.test(String(url || '').trim())) return { ok: false, error: 'Paste a full link, like https://www.youtube.com/watch?v=…' };
    return findThemeSong(id, { manual: true, url: String(url).trim() });
  });
  handle('song:search', async query => {
    if (!ytdlp) return { ok: false, error: 'Install the song finder first' };
    try { return { ok: true, results: await themesong.searchSongs(ytdlp, String(query || '').slice(0, 200)) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  handle('song:stream', async url => {
    if (!ytdlp) return null;
    try { return await themesong.streamUrl(ytdlp, url); } catch { return null; }
  });
  handle('app:clipboardText', () => clipboard.readText());
  handle('music:search', async query => {
    if (!ytdlp) return { ok: false, error: 'Install the song finder first (Settings › Audio)' };
    try { return { ok: true, results: await themesong.musicSearch(ytdlp, String(query || '').slice(0, 200)) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  handle('music:resolve', async url => {
    if (!ytdlp) return { ok: false, error: 'Install the song finder first' };
    try { return { ok: true, ...(await themesong.resolveSong(ytdlp, String(url))) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  handle('game:openMediaFolder', id => { if (store.getGame(id)) shell.openPath(store.gameDir(id)); });
  // Installs yt-dlp with Windows' own package manager (only when the user asks for it)
  handle('themesong:install', () => new Promise(resolve => {
    execFile('winget', ['install', '--id', 'yt-dlp.yt-dlp', '-e', '--silent', '--accept-source-agreements', '--accept-package-agreements'],
      { windowsHide: true, timeout: 10 * 60 * 1000 }, async (err, out) => {
        themesong.resetYtDlpCache();
        ytdlp = await themesong.findYtDlp(store.settings.ytdlpPath);
        pushState();
        resolve(ytdlp ? { ok: true } : { ok: false, error: err ? (/not recognized|ENOENT/i.test(err.message) ? 'winget is not available on this PC.' : 'The install did not finish.') : 'Installed, but PC4 could not find yt-dlp yet. Restart PC4.' });
      });
  }));
  handle('game:openFolder', id => {
    const g = store.getGame(id);
    const dir = g && (g.installDir || (g.launch.type === 'exe' ? path.dirname(g.launch.target) : ''));
    if (dir && fs.existsSync(dir)) shell.openPath(dir);
    return !!dir;
  });

  handle('folder:add', (name, ids) => store.addFolder(name, ids));
  handle('folder:update', (id, patch) => store.updateFolder(id, patch));
  handle('folder:remove', id => store.removeFolder(id));

  handle('news:refresh', () => refreshNews());
  handle('industry:get', () => industry.data());
  handle('industry:refresh', () => refreshIndustry());
  handle('article:read', url => readArticle(String(url)).catch(e => ({ error: e.message })));
  handle('post:add', post => {
    let image = null;
    if (post.imageFile) {
      const dir = path.join(store.mediaDir, '_posts');
      fs.mkdirSync(dir, { recursive: true });
      image = `post-${Date.now()}${path.extname(post.imageFile).toLowerCase()}`;
      fs.copyFileSync(post.imageFile, path.join(dir, image));
    }
    return store.addPost({ title: post.title, body: post.body || '', image });
  });
  handle('post:remove', id => store.removePost(id));

  handle('library:import', sources => importLibraries(sources));
  handle('search:steam', term => metadata.searchSteam(term));
  handle('search:screenshots', appId => metadata.steamScreenshots(appId));
  handle('search:sgdb', term => metadata.sgdbSearch(term, store.settings.sgdbKey));
  handle('images:sgdb', (gameId, kind, page) => metadata.sgdbImages(gameId, kind, store.settings.sgdbKey, page || 0));
  handle('images:steamAll', appId => metadata.steamArtwork(appId));
  handle('images:web', (name, kind, next) => searchImages(name, kind, next));

  handle('profile:setAvatar', file => {
    const dir = path.join(store.mediaDir, '_profile');
    fs.mkdirSync(dir, { recursive: true });
    const name = `avatar-${Date.now()}${path.extname(file)}`;
    fs.copyFileSync(file, path.join(dir, name));
    if (store.settings.avatar) removeMedia(dir, store.settings.avatar);
    return store.updateSettings({ avatar: name });
  });

  handle('dialog:open', async opts => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], ...opts });
    return r.canceled ? null : r.filePaths[0];
  });

  handle('app:setMode', m => { loadMode(m); return true; });
  handle('emu:check', () => emulator.checkDriver());
  handle('volume:get', () => emulator.getVolume());
  handle('capture:screenshot', () => capture.screenshot());
  handle('capture:record', () => { capture.toggleRecording(store.settings.captureMaxMinutes || 30); return true; });
  handle('captures:list', () => capture.list());
  handle('shop:get', force => shop(industry.trends, !!force));
  handle('media:roots', () => mediaRoots());
  handle('media:list', dir => mediaList(String(dir)));
  handle('media:thumb', file => capture.thumb(String(file)));
  handle('media:show', file => { const f = String(file); if (fs.existsSync(f)) shell.showItemInFolder(f); });
  handle('media:addFolder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Add a folder to the Media Player', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const list = [...new Set([...(store.settings.mediaFolders || []), r.filePaths[0]])];
    store.updateSettings({ mediaFolders: list });
    pushState();
    return r.filePaths[0];
  });
  handle('media:removeFolder', p => { store.updateSettings({ mediaFolders: (store.settings.mediaFolders || []).filter(x => x !== p) }); pushState(); return true; });
  handle('captures:thumb', file => capture.thumb(String(file)));
  handle('captures:delete', async file => { const f = String(file); if (!f.startsWith(capturesDir())) return false; await shell.trashItem(f); return true; });
  handle('captures:show', file => { const f = String(file); if (f.startsWith(capturesDir())) shell.showItemInFolder(f); else shell.openPath(capturesDir()); });
  handle('volume:set', v => emulator.getVolume(v));
  handle('audio:outputs', id => emulator.getOutputs(id ? String(id) : null));
  // back to the game after the Quick Menu: PC4 steps aside so the game window gets the focus again
  handle('app:backToGame', () => { if (win && launcher.runningIds().length) win.minimize(); return true; });
  handle('overlay:close', backToGame => { hideOverlay(!!backToGame); return true; });
  handle('keys:pause', on => { globalKeysPaused = !!on; applyCaptureKeys(); return true; });
  handle('warp:status', () => warp.refresh());
  // switched by hand: it's the user's now (the automatic off after a game leaves it alone)
  handle('warp:connect', () => { clearTimeout(warpOffTimer); warp.set({ byPC4: false }); return warp.connect({ route: store.settings.warpRoute || 'games' }); });
  handle('warp:disconnect', () => warp.disconnect());
  handle('warp:install', () => warp.install());
  // a Quick Menu row that needs PC4 itself (Media Player, Power, …): PC4 comes to the front and opens it
  handle('overlay:handoff', action => { hideOverlay(false); restoreWindow(); send('qm-action', action); return true; });
  handle('player:cmd', (cmd, args) => { send('player-cmd', cmd, args || []); return true; });
  handle('player:state', snap => {
    if (snap && snap.only) {
      if (musicPlaying !== !!snap.playing) { musicPlaying = !!snap.playing; if (inGame()) applyGameMode(); }
      return true;
    }
    overlaySend('player-state', snap);
    return true;
  });
  handle('emu:rumble', () => { emulator.testRumble(); return true; });
  handle('emu:restart', async () => { await emulator.stop(); syncEmulator(); return emulator.state; });
  handle('emu:install', async which => { const r = await emulator.install(which); pushState(); if (r.ok) syncEmulator(); return r; });
  handle('youtube:open', () => youtube.open({ muted: store.settings.muteAll }));
  handle('youtube:close', () => { youtube.close(); return true; });
  handle('youtube:clear', async () => { await youtube.clearData(); return true; });
  handle('app:window', action => {
    if (action === 'minimize') win.minimize();
    else if (action === 'toggleFullscreen') win.setFullScreen(!win.isFullScreen());
    else if (action === 'quit') app.quit();
  });
  handle('app:power', action => {
    const cmds = {
      shutdown: ['shutdown', ['/s', '/t', '0']],
      restart: ['shutdown', ['/r', '/t', '0']],
      sleep: ['rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']],
    };
    if (cmds[action]) execFile(cmds[action][0], cmds[action][1], { windowsHide: true });
  });
  handle('app:openExternal', url => /^(https?:\/\/|steam:\/\/store\/\d+$|com\.epicgames\.launcher:\/\/store\/p\/[\w-]+$)/.test(url) && shell.openExternal(url));
  handle('app:version', () => app.getVersion());
  handle('app:checkUpdate', () => (updater ? updater.check() : null));
  handle('app:installUpdate', () => { if (updater) updater.install(); });
  handle('sound:read', (name, style) => assets.readSound(name, style));
  // WebHID needs a user gesture to pick a device; this runs the request as one and auto-picks the Sony pad
  handle('hid:request', () => win.webContents.executeJavaScript(
    'navigator.hid ? navigator.hid.requestDevice({ filters: [{ vendorId: 0x054c }] }).then(d => d.length).catch(() => 0) : 0', true));
  handle('app:openAssetFolder', which => {
    setTimeout(() => { assets.invalidate(); pushState(); }, 60000); // new files dropped in are picked up
    assets.invalidate();
    const d = /^sounds[45]$/.test(which) ? path.join(store.settings.soundPackDir || (USER_ASSETS ? ASSET_DIRS.sounds : path.join(__dirname, 'sounds')), which === 'sounds5' ? 'PS5' : 'PS4')
      : which === 'sounds' ? (store.settings.soundPackDir || ASSET_DIRS.sounds) : which === 'fonts' ? ASSET_DIRS.fonts : ASSET_DIRS.music;
    fs.mkdirSync(d, { recursive: true });
    shell.openPath(d);
  });
}

app.whenReady().then(async () => {
  store = new Store(path.join(app.getPath('userData'), 'pc4-data'));
  store.hdd = store.settings.diskType === 'HDD';
  prepareAssetFolders();
  assets = new Assets(__dirname, () => store.settings, USER_ASSETS ? ASSET_DIRS : null);
  news = new News(path.join(store.dir, 'news.json'));
  store.on('change', pushState);
  news.on('change', pushState);
  industry = new Industry(path.join(store.dir, 'industry.json'));
  industry.on('change', pushState);
  warp = new Warp(path.join(app.getPath('userData'), 'warp-routes.json'));
  warp.on('change', pushState);
  emulator = new Emulator(path.join(app.getPath('userData'), 'bin'), path.join(__dirname, 'src', 'helper', 'Pc4Pad.cs'),
    app.isPackaged ? path.join(process.resourcesPath, 'helper') : null);
  emulator.on('change', pushState);
  // updates from GitHub Releases: checked a minute after start, downloaded in the background, installed on quit
  updater = new Updater({ app, log, busy: () => inGame() });
  updater.on('change', pushState);
  updater.on('ready', v => send('update', v));
  if (!TEST) updater.start();
  emulator.on('button', onPadButton);
  emulator.on('nav', b => { if (overlayShown) overlaySend('overlay-nav', b); });
  initCaptures();
  // the driver check starts a process: only now if emulation is on, otherwise when its page is opened
  if (store.settings.emuMode && store.settings.emuMode !== 'off') emulator.checkDriver();
  // looked up after the window is on screen: it can start a process, and nothing needs it at start-up
  setTimeout(async () => { ytdlp = await themesong.findYtDlp(store.settings.ytdlpPath); if (ytdlp) pushState(); }, TEST ? 0 : 1500);

  launcher.on('started', id => {
    // while a game runs, let Chromium throttle PC4 fully so the game gets the PC
    if (win && !win.isDestroyed()) win.webContents.setBackgroundThrottling(true);
    store.addActivity({ type: 'started', gameId: id });
    store.save();
    send('game-started', id);
    pushState();
    syncEmulator();
    applyGameMode();
    // the Quick Menu overlay is made once the game has had time to load, so it opens instantly later
    clearTimeout(overlayTimer);
    if (!TEST && store.settings.quickMenu !== false) overlayTimer = setTimeout(() => { if (inGame()) createOverlay(); }, 20000);
  });
  launcher.on('stopped', (id, seconds, failed) => {
    const g = store.getGame(id);
    if (g && !failed) {
      store.updateGame(id, { playtime: (g.playtime || 0) + seconds });
      store.addActivity({ type: 'played', gameId: id, seconds });
      store.save();
    }
    if (!inGame()) {
      passthroughOn = false; // the real controller goes back to everyone (syncEmulator below)
      if (win && !win.isDestroyed()) win.webContents.setBackgroundThrottling(false);
      hideOverlay(false);
      destroyOverlay();
    }
    restoreWindow();
    pushState(); // "running" changed (and whatever waited while PC4 was hidden)
    send('game-stopped', id, seconds, !!failed);
    warpAfterGames();
    if (failed) send('game-failed', id, g ? g.name : 'The game', failed);
    syncEmulator();
    applyGameMode();
  });

  allowSonyControllers();
  registerIpc();
  createWindow();

  // Dev benchmark: PC4_BENCH=<game id> starts that game from the home screen (the real launch path: fade, passthrough,
  // game mode) once PC4 is up, and quits when it has closed
  if (DEV && process.env.PC4_BENCH && !TEST) {
    const id = JSON.stringify(process.env.PC4_BENCH);
    win.once('ready-to-show', () => setTimeout(() => win.webContents.executeJavaScript(
      `Promise.all([import('./core.js'), import('./actions.js')]).then(([c, a]) => { a.launchGame(c.gameById(${id})); return 1; })`), 12000));
    launcher.on('stopped', () => { if (!inGame()) setTimeout(() => app.quit(), 3000); });
  }

  // background upkeep once the UI is up
  if (!TEST) {
    setTimeout(() => { if (industry.stale()) refreshIndustry(); }, 6000); // small: a few feeds, cached on disk
    setTimeout(() => syncEmulator(), 2500);
    if (store.settings.psWake) setTimeout(applyPsWake, 8000); // keeps the sign-in entry and pc4wake.exe up to date
    // once: is PC4's data on a hard disk? (a slow PowerShell query, so it runs late and is remembered)
    if (!store.settings.diskType) setTimeout(async () => { const t = await perf.diskType(store.dir); if (t) { store.updateSettings({ diskType: t }); store.hdd = t === 'HDD'; pushState(); } }, 45000);
    setTimeout(() => { upgradeLibrary(); if (news.stale()) refreshNews(); }, 25000);
    setInterval(() => { if (inGame()) return; if (news.stale()) refreshNews(); else if (industry.stale()) refreshIndustry(); }, 15 * 60 * 1000);
  }
});

// started again (the PS button, a shortcut): the running PC4 comes forward, in Console Mode when that was asked for
app.on('second-instance', (_e, argv) => {
  if (argv.includes('--fullscreen')) { if (!inGame()) toConsole(); }
  else if (argv.includes('--desktop') && mode !== 'desktop') { loadMode('desktop'); restoreWindow(); }
  else restoreWindow();
});
app.on('before-quit', () => { if (store) store.flush(); Launcher.stopPs(); if (capture && capture.recording) capture.stopRecording(); globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => app.quit());
// give the controller back (virtual Xbox pad unplugged, HidHide undone) before PC4 exits
let emuStopped = false;
app.on('will-quit', e => {
  if (emuStopped || !emulator || (!emulator.proc && !emulator.hidden.size)) return;
  e.preventDefault();
  emuStopped = true;
  emulator.stop().finally(() => app.quit());
});
