// Finds the user's sound pack, music and fonts next to the app. Results are cached briefly
// because the state is pushed to the renderer often.
const fs = require('fs');
const path = require('path');

const AUDIO_EXT = /\.(wav|mp3|ogg|m4a|flac|opus|aac|webm)$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|avif|bmp)$/i;
const FONT_EXT = /\.(ttf|otf|woff2?)$/i;

const SOUND_NAMES = {
  navigate: ['navigate', 'move', 'cursor', 'scroll', 'scroll-forward', 'scroll-foward', 'navigation'],
  select: ['select', 'accept', 'confirm', 'ok', 'gui', 'gui-sfx', 'activation'],
  back: ['back', 'cancel'],
  options: ['options', 'menu', 'options-menu', 'home', 'home-menu', 'popup1', 'popup-1'],
  error: ['error', 'report-menu-appear', 'report', 'alert', 'warning'],
  notification: ['notification', 'toast', 'popup2', 'popup-2'],
  trophy: ['trophy', 'trophy-get'],
  launch: ['launch', 'start', 'game-start', 'app-start'],
  boot: ['boot', 'startup', 'sony-ps5-intro', 'sony-ps4-intro'],
  login: ['login', 'user', 'menu-intro', 'welcome'],
  shutdown: ['shutdown', 'power-off', 'turn-off', 'logout', 'log-out'],
  keyboard: ['keyboard', 'key', 'keypress', 'type'],
};

// "PS4-Select-Button.mp3" -> "select" (also "PS5-…")
function soundKey(file) {
  return file.replace(AUDIO_EXT, '').toLowerCase().replace(/^ps[45][-_ ]+/, '').replace(/[-_ ]+(button|sound|sfx)$/, '').replace(/[_ ]+/g, '-');
}
const ALL_SFX = new Set(Object.values(SOUND_NAMES).flat());

function list(dir, re) {
  try { return fs.readdirSync(dir).filter(f => re.test(f)); } catch { return []; }
}
// Each console style has its own sounds and music: a "PS4" / "PS5" folder inside a sound / music folder, or files
// named "ps4-…" / "ps5-…" next to them. Loose files without a ps5 prefix count as PS4 (how PC4 started out).
const isPs5File = f => /^ps5[-_ ]/i.test(f);
function subDir(dir, name) {
  if (!dir) return null;
  try { const d = fs.readdirSync(dir, { withFileTypes: true }).find(e => e.isDirectory() && e.name.toLowerCase() === name); return d ? path.join(dir, d.name) : null; } catch { return null; }
}
// [folder, files] pairs to look through for one style (its own folder first)
function sources(dirs, style, re = AUDIO_EXT) {
  const out = [];
  for (const dir of dirs.filter(Boolean)) {
    const sub = subDir(dir, style);
    if (sub) out.push([sub, list(sub, re)]);
    const files = list(dir, re);
    out.push([dir, style === 'ps5' ? files.filter(isPs5File) : files.filter(x => !isPs5File(x))]);
  }
  return out;
}

// Playnite's fullscreen themes keep their sounds in <theme>/audio: navigation.wav (move), activation.wav (select) and
// background.mp3 (menu music), and PS5-ish its home background in Images/PS5Background_All.jpg. When the player has
// Playnite's PS4Like / PS5-ish themes installed, PC4 uses those files for whatever its own folders don't have.
const PLAYNITE_THEMES = process.env.APPDATA ? path.join(process.env.APPDATA, 'Playnite', 'Themes', 'Fullscreen') : null;
function playniteTheme(style) {
  if (!PLAYNITE_THEMES) return null;
  try {
    const re = style === 'ps5' ? /^ps5/i : /^ps4/i;
    const d = fs.readdirSync(PLAYNITE_THEMES, { withFileTypes: true }).find(e => e.isDirectory() && re.test(e.name));
    return d ? path.join(PLAYNITE_THEMES, d.name) : null;
  } catch { return null; }
}
function playniteSources(style) {
  const t = playniteTheme(style);
  const audio = t && subDir(t, 'audio');
  return audio ? [[audio, list(audio, AUDIO_EXT)]] : [];
}

class Assets {
  // userDirs: { sounds, music, fonts } — the installed app's folders in PC4's data folder (the app itself is a
  // read-only archive then); without it, the folders next to the app (while developing)
  constructor(appDir, settings, userDirs = null) {
    this.settings = settings; // () => current settings
    // installed: the player's own folders first, then the sound pack that ships with it (resources/sounds, next to app.asar)
    this.dirs = userDirs ? { ...userDirs, rootSounds: path.join(path.dirname(appDir), 'sounds'), rootMusic: path.join(path.dirname(appDir), 'music'), rootFonts: null } : {
      sounds: path.join(appDir, 'assets', 'sounds'),
      music: path.join(appDir, 'assets', 'music'),
      fonts: path.join(appDir, 'assets', 'fonts'),
      rootSounds: path.join(appDir, 'sounds'),
      rootMusic: path.join(appDir, 'music'),
      rootFonts: path.join(appDir, 'fonts'),
    };
    this.cache = null;
    this.cacheAt = 0;
  }

  invalidate() { this.cache = null; }

  get() {
    // folders are rescanned at most every 30 s (and right away when their settings change)
    if (this.cache && Date.now() - this.cacheAt < 30000) return this.cache;
    const m5 = this.music('ps5');
    this.cache = { sounds: this.soundPack(), sounds5: this.soundPack('ps5'), ...this.music(), defaultMusic5: m5.defaultMusic, defaultIntro5: m5.defaultIntro, musicTracks: this.tracks(), fonts: this.fonts(), wallpaper5: this.wallpaper('ps5') };
    this.cacheAt = Date.now();
    return this.cache;
  }

  // one style's own sounds only (a PS5 sound that's missing uses PC4's built-in one, never the PS4 file)
  soundPack(style = 'ps4') {
    const out = {};
    const s = this.settings();
    const dirs = [s.soundPackDir, this.dirs.sounds, this.dirs.rootSounds];
    for (const [dir, files] of [...sources(dirs, style), ...playniteSources(style)]) {
      const taken = new Set();
      // exact names first, then names with extra bits ("notification_2OwLlNY" -> notification)
      for (const exact of [true, false]) {
        for (const [name, aliases] of Object.entries(SOUND_NAMES)) {
          if (out[name]) continue;
          const f = files.find(x => !taken.has(x) && aliases.some(a => exact ? soundKey(x) === a : soundKey(x).startsWith(a + '-')));
          if (f) { out[name] = path.join(dir, f); taken.add(f); }
        }
      }
    }
    // a trophy sound doubles as the notification sound when there is no separate one
    if (!out.notification && out.trophy) out.notification = out.trophy;
    return out;
  }

  // intro.* / theme.* in assets/music, or anything that looks like home-menu music in sounds/ or music/
  // style 'ps5': only the PS5 folders (the PS5 home screen is quiet when there's no PS5 music)
  music(style = 'ps4') {
    let theme = null;
    let intro = null;
    for (const [dir, files] of [...sources([this.dirs.music, this.dirs.rootMusic, this.dirs.sounds, this.dirs.rootSounds], style), ...playniteSources(style)]) {
      for (const f of files) {
        const key = soundKey(f);
        if (ALL_SFX.has(key) || [...ALL_SFX].some(a => key.startsWith(a + '-') && a.length > 3 && !/music|theme/.test(key))) continue;
        const full = path.join(dir, f);
        if (!intro && (key === 'intro' || /intro[-_ ]?music|user[-_ ]?select|login[-_ ]?music/i.test(f))) intro = full;
        else if (!theme && (key === 'theme' || key === 'background' || /home[-_ ]?menu|system[-_ ]?music|menu[-_ ]?music|theme|bgm/i.test(f))) theme = full;
      }
    }
    return { defaultMusic: theme, defaultIntro: intro };
  }

  tracks() {
    const out = [];
    for (const [dir, files] of ['ps4', 'ps5'].flatMap(st => sources([this.dirs.music, this.dirs.rootMusic, this.dirs.sounds, this.dirs.rootSounds], st))) {
      for (const f of files) {
        const key = soundKey(f);
        if (ALL_SFX.has(key) || [...ALL_SFX].some(a => key.startsWith(a + '-') && a.length > 3 && !/music|theme/.test(key))) continue;
        out.push(path.join(dir, f));
      }
    }
    return out;
  }

  // the home screen's background when no game is selected: background.* / wallpaper.* in the style's sound or music
  // folder, else PS5-ish's own (Playnite theme), else none (PC4 draws its own)
  wallpaper(style) {
    for (const [dir, files] of sources([this.dirs.sounds, this.dirs.rootSounds, this.dirs.music, this.dirs.rootMusic], style, IMAGE_EXT)) {
      const f = files.find(x => /^(ps[45][-_ ])?(background|wallpaper)/i.test(x));
      if (f) return path.join(dir, f);
    }
    const t = playniteTheme(style);
    const img = t && subDir(t, 'images');
    const f = img && list(img, IMAGE_EXT).find(x => /background_all/i.test(x));
    return f ? path.join(img, f) : null;
  }

  // Any font dropped in assets/fonts becomes the UI font (meant for SST).
  fonts() {
    const out = [];
    for (const dir of [this.dirs.fonts, this.dirs.rootFonts]) {
      for (const f of list(dir, FONT_EXT)) {
        const n = f.toLowerCase();
        const weight = /ultra[-_ ]?light|thin|hairline/.test(n) ? 200
          : /light/.test(n) ? 300
          : /medium/.test(n) ? 500
          : /semi[-_ ]?bold|demi/.test(n) ? 600
          : /heavy|black|extra[-_ ]?bold/.test(n) ? 800
          : /bold/.test(n) ? 700 : 400;
        out.push({ file: path.join(dir, f), weight, style: /italic|oblique/.test(n) ? 'italic' : 'normal' });
      }
    }
    return out;
  }

  readSound(name, style = 'ps4') {
    const p = this.soundPack(style)[name];
    return p ? fs.readFileSync(p) : null;
  }
}

module.exports = { Assets, SOUND_NAMES };
