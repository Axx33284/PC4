// UI sounds and music.
// Sounds come from the sound pack (sounds/, assets/sounds or the folder picked in Settings) when a file
// exists, otherwise a soft synthesised version is played.
import { ctx, api } from './core.js';
import { fileUrl } from '../common/util.js';

let ac = null;
let master = null;
let dry = null;
const playing = new Set(); // keeps every playing source referenced until it has fully finished

function audio() {
  if (!ac) {
    // 'balanced' gives the audio thread a bigger buffer, so sounds don't drop out while the UI is busy
    ac = new AudioContext({ latencyHint: 'balanced' });
    // limiter: several loud samples at once would otherwise clip
    const limiter = ac.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.2;
    limiter.connect(ac.destination);
    master = ac.createGain();
    master.connect(limiter);
    // a small room reverb makes the synthesised sounds airy like the console's
    dry = ac.createGain();
    dry.connect(master);
    const conv = ac.createConvolver();
    const len = Math.floor(ac.sampleRate * 1.1);
    const ir = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    conv.buffer = ir;
    const wet = ac.createGain();
    wet.gain.value = 0.28;
    conv.connect(wet).connect(master);
    dry.connect(conv);
  }
  if (ac.state === 'suspended') ac.resume();
  const s = ctx.settings;
  master.gain.value = s.muteAll ? 0 : (s.masterVolume ?? 1) * (s.uiVolume ?? 0.6);
  return ac;
}

function track(node, endsAt) {
  playing.add(node);
  node.onended = () => playing.delete(node);
  node._endsAt = endsAt;
}

function tone(freq, { at = 0, dur = 0.12, vol = 0.2, type = 'sine', to = null, attack = 0.004 } = {}) {
  const a = audio();
  const t = a.currentTime + 0.01 + at;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dry);
  o.start(t);
  o.stop(t + dur + 0.1);
  track(o, t + dur + 0.6);
}

function noise({ at = 0, dur = 0.3, vol = 0.12, from = 400, to = 3000, q = 1.2 } = {}) {
  const a = audio();
  const t = a.currentTime + 0.01 + at;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(dry);
  src.start(t);
  track(src, t + dur + 0.6);
}

// synthesised fallbacks, keyed by sound-pack name (soft attack and a natural tail, never an abrupt stop)
const SYNTH = {
  navigate() { tone(2350, { dur: 0.09, vol: 0.06 }); tone(1175, { dur: 0.12, vol: 0.045 }); },
  select() { tone(1568, { dur: 0.3, vol: 0.1 }); tone(2349, { at: 0.012, dur: 0.35, vol: 0.06 }); tone(3136, { at: 0.02, dur: 0.2, vol: 0.025 }); },
  back() { tone(1175, { dur: 0.16, vol: 0.09 }); tone(784, { at: 0.045, dur: 0.28, vol: 0.08 }); },
  options() { noise({ dur: 0.26, vol: 0.05, from: 900, to: 4200 }); tone(1760, { at: 0.02, dur: 0.22, vol: 0.05 }); },
  error() { tone(330, { dur: 0.22, vol: 0.09, type: 'triangle', to: 260, attack: 0.008 }); },
  notification() { tone(1318, { dur: 0.45, vol: 0.07 }); tone(1975, { at: 0.1, dur: 0.6, vol: 0.06 }); tone(2637, { at: 0.2, dur: 0.7, vol: 0.03 }); },
  launch() {
    noise({ dur: 0.8, vol: 0.1, from: 250, to: 6000, q: 0.7 });
    [523, 784, 1046, 1568, 2093].forEach((f, i) => tone(f, { at: 0.18 + i * 0.045, dur: 1.6, vol: 0.05, attack: 0.04 }));
  },
  boot() {
    [261.6, 392, 523.3, 659.3, 784, 1046.5].forEach((f, i) => tone(f, { at: 0.06 * i, dur: 4, vol: 0.06, attack: 0.6 }));
    [2093, 2637, 3136, 4186].forEach((f, i) => tone(f, { at: 0.7 + i * 0.12, dur: 1.8, vol: 0.018, attack: 0.02 }));
    noise({ dur: 2.4, vol: 0.04, from: 300, to: 7000, q: 0.6 });
  },
  login() { [988, 1318, 1976].forEach((f, i) => tone(f, { at: i * 0.07, dur: 0.8, vol: 0.07 })); },
  shutdown() { [1046.5, 784, 659.3, 523.3].forEach((f, i) => tone(f, { at: i * 0.14, dur: 1.2, vol: 0.06, attack: 0.03 })); },
};

// UI code uses short names; map them to sound-pack names
const ALIAS = { move: 'navigate', accept: 'select', toast: 'notification', key: 'keyboard' };
// when a pack sound is missing, borrow a close one before falling back to the synth
// (starting a game uses the select sound, like the console)
const BORROW = { keyboard: 'navigate', trophy: 'notification', launch: 'select' };

const buffers = {};
let packKey = '';
// sound files are decoded without opening the audio device (a decoded sound plays in any AudioContext):
// the Quick Menu overlay loads its sounds when it's made, then waits hidden through the whole game
let decoder = null;
const decodeCtx = () => ac || decoder || (decoder = new OfflineAudioContext(2, 1, 48000));

const ps5 = () => ctx.settings.uiStyle === 'ps5';

export async function loadSoundPack() {
  const style = ps5() ? 'ps5' : 'ps4';
  const pack = (style === 'ps5' ? ctx.state.sounds5 : ctx.state.sounds) || {};
  const key = style + JSON.stringify(pack);
  if (key === packKey) return;
  packKey = key;
  for (const k of Object.keys(buffers)) delete buffers[k];
  const a = decodeCtx();
  await Promise.all(Object.keys(pack).map(async name => {
    try {
      const data = await api.readSound(name, style);
      if (!data) return;
      const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      buffers[name] = await a.decodeAudioData(ab);
    } catch (e) {
      console.warn('sound pack: could not load', name, e.message);
    }
  }));
}

function resolve(name) {
  const key = ALIAS[name] || name;
  if (buffers[key]) return { buffer: buffers[key] };
  if (BORROW[key] && buffers[BORROW[key]]) return { buffer: buffers[BORROW[key]] };
  return { synth: SYNTH[key] || SYNTH[BORROW[key]] };
}

export function hasSound(name) { return !!resolve(name).buffer; }

// length in seconds of a sound-pack file (0 when the built-in sound is used)
export function soundDuration(name) {
  const r = resolve(name);
  return r.buffer ? r.buffer.duration : 0;
}

export function sfx(name) {
  // reaching the end of a row or list is silent on the PS4; 'error' is only for real errors
  if (name === 'bump' || !ctx.settings.uiSounds || ctx.settings.muteAll) return;
  // silent while a game has the screen
  if ((document.body.classList.contains('game-running') || document.body.classList.contains('app-open')) && !document.hasFocus()) return;
  try {
    const r = resolve(name);
    if (r.buffer) {
      const a = audio();
      const src = a.createBufferSource();
      src.buffer = r.buffer;
      src.connect(master);
      const t = a.currentTime + 0.005;
      src.start(t);
      track(src, t + r.buffer.duration);
    } else if (r.synth) r.synth();
  } catch {}
}

// Resolves once every UI sound has finished (capped), so a page switch or quit never cuts one off.
export function soundsDone(maxMs = 2500) {
  if (!ac || !playing.size) return Promise.resolve();
  const end = Math.max(...[...playing].map(n => n._endsAt || 0));
  const ms = Math.min(maxMs, Math.max(0, (end - ac.currentTime) * 1000));
  return new Promise(r => setTimeout(r, ms));
}

// ---------------- music: 'intro', 'home', and a game's own theme song ----------------
const music = new Audio();
music.loop = true;
music.volume = 0;
music.preload = 'auto';
let fadeTimer = null;
let wantPlaying = false;
const holds = new Set(); // who silenced the menu music ('app' = YouTube, 'player' = the music player)
let baseTrack = 'home';
let gameFile = null;
const positions = new Map(); // remembers where the home music was when a game song took over

const gameSongOn = () => gameFile && ctx.settings.gameMusic !== false;

function fileFor() {
  const s = ctx.settings;
  if (gameSongOn()) return gameFile;
  // PS5 style: only PS5 music (the PS5 home screen is quiet without it)
  if (ps5()) return baseTrack === 'intro' ? ctx.state.defaultIntro5 || ctx.state.defaultMusic5 : ctx.state.defaultMusic5;
  const home = s.music || ctx.state.defaultMusic;
  if (baseTrack === 'intro') return s.introMusic || ctx.state.defaultIntro || home;
  return home;
}

function fadeTo(target, ms, done) {
  clearInterval(fadeTimer);
  const start = music.volume;
  const t0 = performance.now();
  fadeTimer = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    // ease-in-out so fades sound smooth rather than linear
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    music.volume = Math.max(0, Math.min(1, start + (target - start) * e));
    if (k >= 1) { clearInterval(fadeTimer); if (done) done(); }
  }, 30);
}

// master volume x the channel's own volume (menu music or the game's theme song)
function targetVolume() {
  const s = ctx.settings;
  if (s.muteAll) return 0;
  return (s.masterVolume ?? 1) * (gameSongOn() ? (s.gameMusicVolume ?? 0.4) : (s.musicVolume ?? 0.35));
}

export const Music = {
  src() {
    const s = ctx.settings;
    const f = fileFor();
    if (!f || s.muteAll) return null;
    if (!gameSongOn() && !s.musicEnabled) return null; // menu music switched off; game songs have their own switch
    return fileUrl(f);
  },
  sync(fadeMs = 600) {
    const src = this.src();
    if (!src) { this.stop(); return; }
    if (music.dataset.src !== src) {
      const swap = () => {
        if (music.dataset.src) positions.set(music.dataset.src, music.currentTime);
        music.dataset.src = src;
        music.src = src;
        const pos = positions.get(src);
        if (pos) music.addEventListener('loadedmetadata', () => { try { music.currentTime = pos; } catch {} }, { once: true });
        if (wantPlaying) this.play();
      };
      if (!music.paused && music.volume > 0.01) fadeTo(0, fadeMs, swap);
      else swap();
    } else if (wantPlaying && music.paused) this.play();
  },
  setTrack(t) {
    if (t === baseTrack) return;
    baseTrack = t;
    this.sync();
  },
  // a game's theme song (null = back to the home music)
  setGame(file) {
    if (file === gameFile) return;
    gameFile = file;
    if (file) positions.delete(fileUrl(file)); // game songs always start from the top
    this.sync(500);
  },
  play() {
    wantPlaying = true;
    if (holds.size) return;
    const src = this.src();
    if (!src) return;
    if (music.dataset.src !== src) { music.dataset.src = src; music.src = src; }
    // (the fade starts later: if something took the stage meanwhile, stay silent)
    music.play().then(() => { if (holds.size) { fadeTo(0, 200, () => music.pause()); return; } fadeTo(targetVolume(), 1400); }).catch(() => {});
  },
  pause(ms = 700) { fadeTo(0, ms, () => music.pause()); },
  stop() {
    clearInterval(fadeTimer);
    music.pause();
    music.removeAttribute('src');
    delete music.dataset.src;
    music.load();
  },
  // re-apply volumes after a settings change
  refreshVolume() { if (!music.paused && !holds.size) { clearInterval(fadeTimer); music.volume = Math.min(1, targetVolume()); } },
  resume() { if (wantPlaying) this.play(); },
  // silence the music while an app is open; state updates can't bring it back until release()
  hold(ms = 500, who = 'app') { holds.add(who); fadeTo(0, ms, () => { if (holds.size) music.pause(); }); },
  release(who = 'app') { holds.delete(who); if (!holds.size) this.resume(); },
  get held() { return holds.size > 0; },
  status() { return { src: decodeURIComponent(music.dataset.src || ''), paused: music.paused, volume: Math.round(music.volume * 100) / 100, time: Math.round(music.currentTime) }; },
};

// make sure the audio device is open before the first sound (a cold start can swallow it)
export function warmUp() { try { audio(); } catch {} }

// a running AudioContext keeps processing silence all the time: pause it while nothing can sound
// (a game has the screen, the overlay is hidden); the next sound wakes it (audio() resumes)
// (a sound still playing, or PC4 still in front while the game loads: try again a little later)
export function sleepAudio(tries = 10) {
  if (!ac || ac.state !== 'running') return;
  if (playing.size || document.hasFocus()) { if (tries > 0) setTimeout(() => sleepAudio(tries - 1), 1000); return; }
  ac.suspend().catch(() => {});
}
