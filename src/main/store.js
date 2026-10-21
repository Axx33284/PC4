// Library + settings persistence (plain JSON in the user data folder).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const DEFAULT_SETTINGS = {
  profileName: 'Player 1',
  avatar: null,               // file name inside media/_profile
  startupMode: 'desktop',     // 'desktop' | 'fullscreen'
  bootAnimation: true,
  uiSounds: true,
  uiVolume: 0.6,
  musicEnabled: true,
  music: null,                // absolute path to an audio file
  musicVolume: 0.35,
  theme: 'blue',
  waves: true,
  particles: true,
  gameWallpaper: 'details',   // 'details' (only in the game hub) | 'hover' | 'off'
  customBackground: null,     // absolute path to an image or video
  introMusic: null,           // absolute path, plays on the startup/user screen
  soundPackDir: null,         // folder with navigate.wav, select.wav, … (overrides assets/sounds)
  hubLayout: 'vertical',      // game details: 'vertical' | 'horizontal'
  masterVolume: 1,           // scales every sound
  muteAll: false,
  gameMusicVolume: 0.4,       // game theme songs in details
  gameColors: true,           // tint the UI with the game's colours in its details
  lightBar: 'blue',           // controller light bar colour preset or '#rrggbb'
  lightBarBrightness: 'bright', // 'bright' | 'medium' | 'dim' | 'off'
  showYouTube: true,          // the YouTube app on the home screen
  emuMode: 'off',             // Xbox emulation for PlayStation pads: 'off' | 'always' (on)
  emuHide: 'hidhide',         // keep games from also seeing the real pad: 'hidhide' | 'exclusive' | 'off'
  emuDeadzoneL: 0.1,
  emuDeadzoneR: 0.1,
  emuTriggerDeadzone: 0.04,
  emuAntiDeadzone: 0,
  emuCurve: 'linear',         // 'linear' | 'precise' | 'fast'
  emuInvertLY: false,
  emuInvertRY: false,
  emuTouchpad: 'back',        // touchpad click: 'back' | 'guide' | 'start' | 'none'
  emuRumble: 1,
  emuBatteryLight: false,
  performance: 'auto',        // 'auto' | 'full' | 'light'
  diskType: null,             // 'SSD' | 'HDD', found once
  quickMenu: true,            // hold PS (or Xbox Guide) for the Quick Menu, also during games
  psHome: false,              // tap PS during a game to come back to PC4 (with emulation: instead of Guide)
  captureShare: true,         // Share: tap = screenshot, hold = start / stop recording
  captureKeys: true,          // the screenshot / record shortcuts (below) on or off
  keyBindings: {},            // Settings › Keyboard: controller button -> keys (KeyboardEvent.code), only changed ones
  globalKeys: {},             // shortcuts that work during games: quickmenu / home / screenshot / record -> accelerator
  warpAutoOff: true,          // Secure Connection: WARP goes off with the last game when PC4 turned it on
  warpRoute: 'games',         // Secure Connection carries 'games' (only blocked games' servers, fastest) or 'all' traffic
  warpTerms: false,           // the user said yes to Cloudflare WARP's terms (asked once, before PC4 first uses it)
  psWake: false,              // press PS (or Xbox Guide) while PC4 is closed: it starts in Console Mode (pc4wake.exe at sign-in)
  captureNotify: true,        // a quiet Windows notification when a capture is saved during a game
  captureMaxMinutes: 30,
  captureDir: null,           // default: Pictures\\PC4 Captures
  mediaFolders: [],           // extra folders in the Media Player
  mediaResume: {},            // video path -> seconds, to carry on where you stopped
  playerVolume: 0.8,          // the music player (Quick Menu / Media Player)
  themeMode: 'fixed',         // 'fixed' | 'time' (time of day) | 'game' (last played game's colours and wallpaper)
  padIcons: 'auto',           // button icons: 'auto' (the controller plugged in) | 'ps4' | 'ps5' | 'xbox'
  splashSeconds: 60,          // how long the game's splash stays before PC4 steps aside (0 = until the game closes)
  launchStyle: 'ps4',         // 'ps4' (fade to the game's splash) | 'zoom' (tile grows to fill the screen)
  gameMusic: true,            // play a game's theme song in its details
  autoThemeSongs: true,       // find missing theme songs with yt-dlp when it is installed
  ytdlpPath: '',
  showNews: true,             // game news on What's New
  industryNews: true,         // gaming industry news + Steam trends on What's New
  newsSources: {},            // { ign: false } turns a news site off
  uiStyle: 'ps4',             // Console Mode look: 'ps4' | 'ps5' (sounds from the PS5 sound folder)
  tileStyle: 'auto',          // 'auto' (key art + logo) | 'cover'
  clock24: false,
  minimizeOnLaunch: true,
  padPassthrough: true,       // during games: the real PlayStation pad is hidden, the game gets a virtual DUALSHOCK 4
  adminGames: 'once',        // games that need admin rights: 'once' (ask once, then a scheduled task) | 'ask' (every time)
  sgdbKey: '',
  // Desktop Mode (Playnite-style): view, grouping, sort, panels, filters and saved filter presets
  desktop: { sort: 'name', sortDir: 'asc', coverSize: 200, filter: 'all', view: 'grid', group: 'none', filterPanel: false, explorer: false,
    explorerField: 'source', filters: {}, presets: [], gridDetails: false, collapsed: [], listColumns: null },
};

function migrate(s) {
  if (s.emuMode === 'games') s.emuMode = 'always'; // emulation is simply on or off now
  if (s.gameBackgrounds === false && !s.gameWallpaper) s.gameWallpaper = 'off';
  delete s.gameBackgrounds;
  return s;
}

class Store extends EventEmitter {
  constructor(dir) {
    super();
    this.dir = dir;
    this.mediaDir = path.join(dir, 'media');
    this.file = path.join(dir, 'library.json');
    fs.mkdirSync(this.mediaDir, { recursive: true });
    this.data = { games: [], folders: [], activity: [], posts: [], settings: { ...DEFAULT_SETTINGS } };
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = {
        games: raw.games || [],
        folders: raw.folders || [],
        activity: raw.activity || [],
        posts: raw.posts || [],
        settings: { ...DEFAULT_SETTINGS, ...migrate(raw.settings || {}), desktop: { ...DEFAULT_SETTINGS.desktop, ...((raw.settings || {}).desktop || {}) } },
      };
    } catch (e) {
      if (e.code !== 'ENOENT') {
        // keep a copy of an unreadable file instead of silently overwriting it
        try { fs.copyFileSync(this.file, this.file + '.broken-' + Date.now()); } catch {}
      }
    }
  }

  save() {
    clearTimeout(this._t);
    // several changes in a row become one write (longer on a hard disk)
    this._t = setTimeout(() => this.flush(), this.hdd ? 2000 : 400);
    this.emit('change');
  }

  flush() {
    clearTimeout(this._t);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data)); // compact: a third smaller to write and to read at start-up
    fs.renameSync(tmp, this.file);
  }

  get settings() { return this.data.settings; }
  get games() { return this.data.games; }

  snapshot() {
    return { ...this.data, mediaDir: this.mediaDir };
  }

  newId() { return crypto.randomBytes(6).toString('hex'); }

  gameDir(id) {
    const d = path.join(this.mediaDir, id);
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  getGame(id) { return this.data.games.find(g => g.id === id); }
  findBySource(source, sourceId) {
    return this.data.games.find(g => g.source === source && String(g.sourceId) === String(sourceId));
  }

  addGame(partial) {
    const game = {
      id: this.newId(),
      name: 'Untitled',
      source: 'manual',
      sourceId: null,
      installDir: '',
      installed: true,
      launch: { type: 'exe', target: '', args: '', workingDir: '' },
      favorite: false,
      hidden: false,
      playtime: 0,
      playCount: 0,
      lastPlayed: null,
      added: Date.now(),
      media: {},
      meta: {},
      ...partial,
    };
    this.data.games.push(game);
    this.addActivity({ type: 'added', gameId: game.id });
    this.save();
    return game;
  }

  updateGame(id, patch) {
    const g = this.getGame(id);
    if (!g) return null;
    for (const [k, v] of Object.entries(patch)) {
      // media is always written as a whole (entries get removed); other objects merge
      if (k !== 'media' && v && typeof v === 'object' && !Array.isArray(v) && g[k] && typeof g[k] === 'object') g[k] = { ...g[k], ...v };
      else g[k] = v;
    }
    this.save();
    return g;
  }

  removeGame(id) {
    this.data.games = this.data.games.filter(g => g.id !== id);
    for (const f of this.data.folders) f.gameIds = f.gameIds.filter(x => x !== id);
    this.data.activity = this.data.activity.filter(a => a.gameId !== id);
    try { fs.rmSync(path.join(this.mediaDir, id), { recursive: true, force: true }); } catch {}
    this.save();
  }

  addActivity(entry) {
    this.data.activity.unshift({ ts: Date.now(), ...entry });
    this.data.activity.length = Math.min(this.data.activity.length, 200);
  }

  // your own What's New posts
  addPost({ title, body = '', image = null }) {
    const p = { id: this.newId(), title, body, image, ts: Date.now() };
    this.data.posts.unshift(p);
    this.save();
    return p;
  }
  removePost(id) {
    const p = this.data.posts.find(x => x.id === id);
    if (p && p.image) try { fs.unlinkSync(path.join(this.mediaDir, '_posts', p.image)); } catch {}
    this.data.posts = this.data.posts.filter(x => x.id !== id);
    this.save();
  }

  // folders
  addFolder(name, gameIds = []) {
    const f = { id: this.newId(), name, gameIds, created: Date.now() };
    this.data.folders.push(f);
    this.save();
    return f;
  }
  updateFolder(id, patch) {
    const f = this.data.folders.find(x => x.id === id);
    if (f) Object.assign(f, patch);
    this.save();
    return f;
  }
  removeFolder(id) {
    this.data.folders = this.data.folders.filter(f => f.id !== id);
    this.save();
  }

  updateSettings(patch) {
    const s = this.data.settings;
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'desktop') s.desktop = { ...s.desktop, ...v };
      else s[k] = v;
    }
    this.save();
    return s;
  }
}

module.exports = Store;
