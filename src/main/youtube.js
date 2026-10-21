// YouTube the way a TV or console has it: YouTube's own big-screen app (youtube.com/tv) running inside
// PC4's window, driven by the controller. The page thinks it runs on a PS4, so YouTube serves the
// controller-friendly TV interface with its phone-code sign-in. Nothing is downloaded or installed.
const { WebContentsView, session, ipcMain, net } = require('electron');
const path = require('path');

const URL = 'https://www.youtube.com/tv';
const TV_UA = 'Mozilla/5.0 (PS4; Leanback Shell) Gecko/20100101 Firefox/65.0 LeanbackShell/01.00.01.75 Sony PS4/ (PS4, , no, CH)';
const PARTITION = 'persist:youtube'; // keeps the sign-in between visits

// controller actions (sent by youtube-preload.js) -> the keys the TV app understands
// ('s' is the TV app's search shortcut; the media keys skip to the previous / next video)
const KEYS = {
  up: 'Up', down: 'Down', left: 'Left', right: 'Right', accept: 'Return', back: 'Escape',
  playpause: 'MediaPlayPause', search: 's', prev: 'MediaPreviousTrack', next: 'MediaNextTrack',
};
// The TV app (thinking it runs on a PS4) puts solid black boxes behind the video title and details over a
// playing video. Those boxes go: the text keeps a soft shadow instead, so it stays readable on any picture.
const CLEAN_TEXT = String.raw`(() => {
  if (window.__pc4Text) return 1; window.__pc4Text = 1;
  // each element is looked at again at most every 10 s: getComputedStyle / getBoundingClientRect on thousands of
  // elements every sweep made the page work hard during videos
  const seen = new WeakMap();
  const check = e => {
    if (!e || e.nodeType !== 1 || e.__pc4) return;
    const now = Date.now();
    if (now - (seen.get(e) || 0) < 10000) return;
    seen.set(e, now);
    const cs = getComputedStyle(e);
    const m = cs.backgroundColor.match(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/);
    if (!m || +m[1] > 24 || +m[2] > 24 || +m[3] > 24 || (m[4] !== undefined && +m[4] < 0.5)) return;
    const r = e.getBoundingClientRect();
    if (r.height < 10 || r.height > 110 || r.width > 1700) return;
    if (!(e.textContent || '').trim() || e.querySelector('img, video, canvas, svg')) return;
    e.__pc4 = 1;
    e.style.setProperty('background-color', 'transparent', 'important');
    e.style.setProperty('box-shadow', 'none', 'important');
    e.style.setProperty('text-shadow', '0 .1em .35em rgba(0,0,0,.9), 0 0 .12em rgba(0,0,0,.8)', 'important');
  };
  const sweep = () => document.querySelectorAll('span, yt-formatted-string, [class*="title" i], [class*="text" i], [class*="metadata" i], [class*="badge" i]').forEach(check);
  new MutationObserver(list => { for (const x of list) for (const n of x.addedNodes) if (n.nodeType === 1) { check(n); if (n.querySelectorAll) n.querySelectorAll('*').forEach(check); } })
    .observe(document.documentElement, { childList: true, subtree: true });
  setInterval(() => { if (!document.hidden) sweep(); }, 3000);
  return 1;
})()`;

// L2 / R2: jump 10 seconds through the video with the player's own controls
const SEEK = { rewind: -10, forward: 10 };

// ---- sharper pictures ----
// The TV app asks for 320×180 thumbnails and stretches them over tiles about 500 px wide, which looks
// blurry on a PC screen. Each thumbnail is swapped for YouTube's own 1280×720 version (WebP, so it stays
// light) when the video has one; old SD videos keep the original.
const THUMB = /^https:\/\/i\.ytimg\.com\/vi\/([\w-]{11})\/(hqdefault|mqdefault|sddefault|default|hq720|hq([1-3])|mq([1-3]))\.jpg/;
const hdKnown = new Map(); // "id/name" -> true | false | Promise
function hdThumb(url) {
  const m = url.match(THUMB);
  if (!m) return Promise.resolve(null);
  const frame = m[3] || m[4];
  const name = frame ? `hq720_${frame}` : 'hq720';
  const hd = `https://i.ytimg.com/vi_webp/${m[1]}/${name}.webp`;
  const key = `${m[1]}/${name}`;
  if (!hdKnown.has(key)) {
    // a slow answer never holds a picture up: after 4 s the original thumbnail is used
    const check = net.fetch(hd, { method: 'HEAD', signal: AbortSignal.timeout(4000) }).then(r => r.ok).catch(() => false);
    hdKnown.set(key, check.then(ok => { hdKnown.set(key, ok); return ok; }));
    if (hdKnown.size > 4000) hdKnown.delete(hdKnown.keys().next().value);
  }
  return Promise.resolve(hdKnown.get(key)).then(ok => (ok ? hd : null));
}
// channel pictures come in whatever size is asked for ("=s88-…"): ask for twice as many pixels
const AVATAR = /=s(\d{2,3})-/;

let sessionReady = false;
function tvSession() {
  const ses = session.fromPartition(PARTITION);
  if (sessionReady) return ses;
  sessionReady = true;
  ses.setUserAgent(TV_UA);
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'fullscreen' || perm === 'media')); // no notifications, location…
  ses.webRequest.onBeforeRequest({ urls: ['https://i.ytimg.com/vi/*', 'https://yt3.ggpht.com/*', 'https://yt3.googleusercontent.com/*'] }, (details, cb) => {
    const url = details.url;
    if (url.startsWith('https://i.ytimg.com/')) { hdThumb(url).then(hd => cb(hd ? { redirectURL: hd } : {})); return; }
    const m = url.match(AVATAR);
    const n = m ? Number(m[1]) : 0;
    cb(n && n < 160 ? { redirectURL: url.replace(AVATAR, `=s${Math.min(n * 2, 320)}-`) } : {});
  });
  return ses;
}

class YouTube {
  constructor(getWin, onChange) {
    this.getWin = getWin;
    this.onChange = onChange; // (open, reason) => void — true once the app is on screen; reason 'offline' when it couldn't load
    this.view = null;
    this.shown = false;
    this.fit = () => {
      const win = this.getWin();
      if (!this.view || !win) return;
      const [width, height] = win.getContentSize();
      this.view.setBounds({ x: 0, y: 0, width, height });
    };
    ipcMain.on('youtube:pad', (e, action) => {
      if (!this.view || e.sender !== this.view.webContents) return;
      if (action === 'home') this.close();
      else if (SEEK[action]) this.seek(SEEK[action]);
      else this.key(action);
    });
  }

  get isOpen() { return !!this.view; }

  // PC4 shows its own splash while the app loads; the app goes on screen once its first page is ready
  open({ muted = false } = {}) {
    const win = this.getWin();
    if (!win) return false;
    if (this.view) { if (this.shown) this.view.webContents.focus(); return true; }
    this.view = new WebContentsView({
      webPreferences: {
        session: tvSession(),
        preload: path.join(__dirname, 'youtube-preload.js'),
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.shown = false;
    this.view.setBackgroundColor('#000000');
    const wc = this.view.webContents;
    wc.setAudioMuted(!!muted); // "Mute All Sound" in PC4 also mutes YouTube
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    // stay on YouTube's TV app: links elsewhere are ignored
    wc.on('will-navigate', (e, url) => { if (!/^https:\/\/([\w-]+\.)*(youtube\.com|google\.com|youtu\.be)\//i.test(url)) e.preventDefault(); });
    // F1 / Home on the keyboard go back to PC4, like the PS button
    wc.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && (input.key === 'F1' || input.key === 'Home' || input.key === 'BrowserHome')) { e.preventDefault(); this.close(); }
    });
    wc.on('render-process-gone', () => this.close());
    // "Exit YouTube" in the app calls window.close(): send it back to PC4 instead
    wc.on('dom-ready', () => {
      wc.executeJavaScript("window.close = () => { document.title = '__pc4_exit__'; }; 1").catch(() => {});
      wc.executeJavaScript(CLEAN_TEXT).catch(() => {});
    });
    wc.on('page-title-updated', (_e, title) => { if (title === '__pc4_exit__') setImmediate(() => this.close()); });
    wc.on('preload-error', (_e, _p, err) => console.warn('YouTube controller script failed:', err.message));
    // the TV app draws its first screen a moment after the page itself has loaded
    const show = () => setTimeout(() => this.show(), 700);
    wc.once('did-finish-load', show);
    wc.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => { if (isMainFrame && !this.shown && code !== -3) this.close('offline'); }); // -3 = aborted by a redirect
    this.showTimer = setTimeout(() => this.show(), 15000); // slow connection: show whatever is there
    wc.loadURL(URL);
    return true;
  }

  show() {
    const win = this.getWin();
    if (!this.view || this.shown || !win || win.isDestroyed()) return;
    this.shown = true;
    clearTimeout(this.showTimer);
    win.contentView.addChildView(this.view);
    this.fit();
    win.on('resize', this.fit);
    this.view.webContents.focus();
    this.onChange(true);
  }

  key(action) {
    const k = KEYS[action];
    if (!k || !this.view) return;
    const wc = this.view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: k });
    if (k.length === 1) wc.sendInputEvent({ type: 'char', keyCode: k });
    wc.sendInputEvent({ type: 'keyUp', keyCode: k });
  }

  seek(seconds) {
    if (!this.view) return;
    this.view.webContents.executeJavaScript(`(() => {
      const p = document.querySelector('.html5-video-player');
      if (p && p.seekTo && p.getCurrentTime) p.seekTo(Math.max(0, p.getCurrentTime() + (${seconds})), true);
    })()`).catch(() => {});
  }

  setMuted(muted) { if (this.view) this.view.webContents.setAudioMuted(!!muted); }

  // leaving closes the app completely, so nothing plays or uses the PC in the background
  close(reason) {
    const view = this.view;
    if (!view) return;
    this.view = null;
    clearTimeout(this.showTimer);
    const win = this.getWin();
    if (win && !win.isDestroyed()) {
      win.removeListener('resize', this.fit);
      if (this.shown) win.contentView.removeChildView(view);
      win.webContents.focus();
    }
    this.shown = false;
    try { view.webContents.close(); } catch {}
    this.onChange(false, reason);
  }

  // signs out and forgets everything YouTube stored
  async clearData() {
    this.close();
    const ses = tvSession();
    await ses.clearStorageData();
    await ses.clearCache();
  }
}

module.exports = { YouTube };
