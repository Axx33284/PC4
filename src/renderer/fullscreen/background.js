// The animated PS4-style wave theme, colour themes, and per-game backdrops.
import { ctx, backdrop } from './core.js';
import { fileUrl, adjustBackground } from '../common/util.js';
import { GLWaves } from './waves-gl.js';

export const THEMES = {
  blue:     { name: 'Classic Blue', top: '#07248c', mid: '#0b3bb2', low: '#1557d8', wave: '150,195,255', bar: '#1a4dc2', tile: '#0f39a6', panel: 'rgba(36,92,214,.52)', glow: 'rgba(150,196,255,.55)' },
  midnight: { name: 'Midnight',     top: '#03050b', mid: '#0a1122', low: '#16233f', wave: '120,150,215', bar: '#1d2b4b', tile: '#101a30', panel: 'rgba(40,60,110,.5)', glow: 'rgba(130,160,230,.45)' },
  crimson:  { name: 'Crimson',      top: '#2e040c', mid: '#6d0a1c', low: '#a8162c', wave: '255,140,160', bar: '#8c1427', tile: '#5a0916', panel: 'rgba(170,30,55,.45)', glow: 'rgba(255,140,160,.5)' },
  emerald:  { name: 'Emerald',      top: '#01241a', mid: '#054f36', low: '#0a8358', wave: '130,255,200', bar: '#0b6b48', tile: '#063f2b', panel: 'rgba(20,140,95,.45)', glow: 'rgba(130,255,200,.45)' },
  violet:   { name: 'Violet',       top: '#12073a', mid: '#311682', low: '#5f2fcc', wave: '200,165,255', bar: '#41219e', tile: '#261063', panel: 'rgba(100,60,210,.48)', glow: 'rgba(200,165,255,.5)' },
  sunset:   { name: 'Sunset',       top: '#2c0d05', mid: '#8e340c', low: '#dc7419', wave: '255,210,150', bar: '#a1470f', tile: '#6a2608', panel: 'rgba(210,100,30,.45)', glow: 'rgba(255,210,150,.5)' },
  silver:   { name: 'Silver',       top: '#2a2e36', mid: '#555d6b', low: '#8f98a6', wave: '255,255,255', bar: '#5a6372', tile: '#3c434e', panel: 'rgba(140,150,165,.42)', glow: 'rgba(255,255,255,.4)' },
  black:    { name: 'Black',        top: '#000000', mid: '#050505', low: '#121212', wave: '190,190,190', bar: '#262626', tile: '#161616', panel: 'rgba(60,60,60,.5)', glow: 'rgba(220,220,220,.35)' },
};

// ---- colour helpers: themes are kept as numbers so they can blend smoothly ----
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgbaNums = str => str.match(/[\d.]+/g).map(Number);

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h, s, l) {
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map(v => Math.round(v * 255));
}

function numericTheme(th) {
  return { top: hexRgb(th.top), mid: hexRgb(th.mid), low: hexRgb(th.low), wave: th.wave.split(',').map(Number), bar: hexRgb(th.bar), tile: hexRgb(th.tile), panel: rgbaNums(th.panel), glow: rgbaNums(th.glow) };
}

// A full theme built from one colour (a game's main colour)
export function themeFromColor([r, g, b]) {
  const [h, s0] = rgbToHsl(r, g, b);
  const s = Math.min(0.9, Math.max(0.45, s0));
  const c = (l, ss = s) => hslToRgb(h, ss, l);
  return { top: c(0.09), mid: c(0.19), low: c(0.31), wave: c(0.74, Math.min(1, s + 0.1)), bar: c(0.32), tile: c(0.2), panel: [...c(0.3), 0.55], glow: [...c(0.72), 0.55] };
}

// Theme changes (settings.themeMode): 'time' follows the time of day, 'game' takes the last played game's
// colours and wallpaper. 'fixed' (default) keeps the chosen theme.
function timeTheme(own) {
  const h = new Date().getHours();
  if (h >= 21 || h < 5) return THEMES.midnight;
  if (h < 8) return THEMES.sunset;
  if (h >= 17) return THEMES.violet;
  return THEMES[own] || THEMES.blue;
}
export function lastPlayedGame() {
  return (ctx.state.games || []).filter(g => g.lastPlayed && !g.hidden).sort((a, b) => b.lastPlayed - a.lastPlayed)[0] || null;
}

const css = v => (v.length === 4 ? `rgba(${v[0]},${v[1]},${v[2]},${v[3]})` : `rgb(${v[0]},${v[1]},${v[2]})`);

export class Background {
  constructor(root) {
    this.root = root;
    this.canvas = document.createElement('canvas');
    this.custom = document.createElement('div');
    this.custom.className = 'bg-custom';
    this.gameA = document.createElement('div');
    this.gameB = document.createElement('div');
    this.gameA.className = this.gameB.className = 'bg-game';
    this.dyn = document.createElement('div'); // the last played game's wallpaper, slowly drifting (dynamic theme)
    this.dyn.className = 'bg-dyn';
    root.append(this.canvas, this.dyn, this.custom, this.gameA, this.gameB);
    // the GPU draws the waves at full resolution; the 2D canvas is the fallback without WebGL
    try { this.glw = new GLWaves(this.canvas); } catch (e) { console.warn('waves: 2D fallback', e.message); this.g = this.canvas.getContext('2d'); }
    this.t = Math.random() * 100;
    this.last = performance.now();
    this.particles = [];
    this.front = this.gameA;
    this.currentGame = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    requestAnimationFrame(now => this.frame(now));
  }

  applyTheme() {
    const s = ctx.settings;
    const mode = s.themeMode || 'fixed';
    const game = mode === 'game' ? lastPlayedGame() : null;
    this.base = game && game.media.accent ? themeFromColor(game.media.accent) : numericTheme(mode === 'time' ? timeTheme(s.theme) : THEMES[s.theme] || THEMES.blue);
    this.applyColors(this.accentTheme || this.base);
    const wall = game && !s.customBackground ? backdrop(game) : null;
    if (wall !== this.dynWall) {
      this.dynWall = wall;
      if (wall) { const img = new Image(); img.onload = () => { if (this.dynWall === wall) { this.dyn.style.backgroundImage = `url("${wall}")`; this.dyn.classList.add('show'); } }; img.src = wall; }
      else this.dyn.classList.remove('show');
    }
    // a custom wallpaper can be an image or a looping video (e.g. a recorded dynamic theme)
    const bgFile = s.customBackground;
    if (bgFile !== this.customFile) {
      this.customFile = bgFile;
      this.custom.innerHTML = '';
      this.custom.style.backgroundImage = '';
      if (bgFile && /\.(mp4|webm|mkv|mov|m4v)$/i.test(bgFile)) {
        const v = document.createElement('video');
        Object.assign(v, { src: fileUrl(bgFile), autoplay: true, loop: true, muted: true, playsInline: true });
        v.style.cssText = 'width:100%;height:100%;object-fit:cover';
        this.custom.appendChild(v);
      } else if (bgFile) {
        this.custom.style.backgroundImage = `url("${fileUrl(bgFile)}")`;
      }
    }
    this.custom.classList.toggle('show', !!bgFile);
  }

  // UI colours blend (registered CSS properties); the canvas blends in frame()
  applyColors(th) {
    this.target = th;
    const r = document.documentElement.style;
    r.setProperty('--bar', css(th.bar));
    r.setProperty('--tile-bg', css(th.tile));
    r.setProperty('--panel', css(th.panel));
    r.setProperty('--glow', css(th.glow));
    if (!this.cur) this.cur = JSON.parse(JSON.stringify(th));
  }

  // tint everything with a game's colour while its details are open (null = back to the theme)
  setAccent(rgb) {
    const key = rgb && ctx.settings.gameColors !== false ? rgb.join(',') : '';
    if (key === this.accentKey) return;
    this.accentKey = key;
    this.accentTheme = key ? themeFromColor(rgb) : null;
    this.applyColors(this.accentTheme || this.base);
  }

  blend(dt) {
    const k = 1 - Math.exp(-dt * 3.2);
    for (const key of ['top', 'mid', 'low', 'wave']) {
      const a = this.cur[key];
      const b = this.target[key];
      for (let i = 0; i < 3; i++) a[i] += (b[i] - a[i]) * k;
    }
    const r = v => v.map(Math.round).join(',');
    this.theme = { top: `rgb(${r(this.cur.top)})`, mid: `rgb(${r(this.cur.mid)})`, low: `rgb(${r(this.cur.low)})`, wave: r(this.cur.wave) };
  }

  get light() { return document.body.classList.contains('perf-light'); }

  resize() {
    // GPU: the screen's native resolution (half in Light mode); 2D fallback: soft shapes at reduced size
    const scale = this.glw ? (this.light ? 0.5 : devicePixelRatio || 1) : this.light ? 0.34 : 0.5;
    this.drawnOnce = false; // a resized canvas is blank until the next frame
    this.w = Math.round(innerWidth * scale);
    this.h = Math.round(innerHeight * scale);
    if (this.glw) this.glw.resize(this.w, this.h);
    else { this.canvas.width = this.w; this.canvas.height = this.h; }
    const n = Math.round(70 * (this.w * this.h) / (1152 * 648));
    this.particles = Array.from({ length: n }, () => this.newParticle(true));
  }

  newParticle(anywhere) {
    return {
      x: Math.random() * this.w,
      y: anywhere ? Math.random() * this.h : this.h + 10,
      r: 0.6 + Math.random() * 2.4,
      vy: 4 + Math.random() * 12,
      vx: 2 + Math.random() * 6,
      tw: Math.random() * Math.PI * 2,
      a: 0.25 + Math.random() * 0.6,
    };
  }

  // one pre-drawn glow dot, stamped for every particle (far cheaper than a gradient per particle per frame)
  sprite() {
    const key = this.theme.wave;
    if (this._sprite && this._spriteKey === key) return this._sprite;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    const grd = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, `rgba(${key},.5)`);
    grd.addColorStop(1, `rgba(${key},0)`);
    x.fillStyle = grd;
    x.fillRect(0, 0, 64, 64);
    this._sprite = c;
    this._spriteKey = key;
    return c;
  }

  // show a game's art behind the UI (null = back to the theme)
  // adj: the user's framing of the wallpaper (see Adjust)
  setGame(url, adj = null) {
    if (ctx.settings.gameWallpaper === 'off') url = null;
    const key = JSON.stringify(adj);
    if (url === this.currentGame && key === this.currentAdj) return;
    if (url === this.currentGame) { adjustBackground(this.front, adj); this.currentAdj = key; return; }
    this.currentGame = url;
    this.currentAdj = key;
    const back = this.front === this.gameA ? this.gameB : this.gameA;
    if (url) {
      const img = new Image();
      img.onload = () => {
        if (this.currentGame !== url) return;
        back.style.backgroundImage = `url("${url}")`;
        adjustBackground(back, adj);
        back.classList.add('show');
        this.front.classList.remove('show');
        this.front = back;
      };
      img.src = url;
    } else {
      this.gameA.classList.remove('show');
      this.gameB.classList.remove('show');
    }
  }

  frame(now) {
    requestAnimationFrame(n => this.frame(n));
    const dt = Math.min(0.05, (now - this.last) / 1000);
    const light = this.light;
    // GPU: smooth 60 fps (20 in Light mode); 2D fallback: 30 fps
    if (now - this.last < (light ? 50 : this.glw ? 15 : 30)) return;
    this.last = now;
    if (document.hidden || !this.target) return;
    if (light !== this.wasLight) { this.wasLight = light; this.resize(); }
    // Light mode: PC4 sits still while you're in another window
    if (light && !document.hasFocus() && this.drawnOnce) return;
    if ((document.body.classList.contains('game-running') || document.body.classList.contains('app-open')) && !document.hasFocus()) return; // paused for the game / app
    if (document.body.classList.contains('ui-ps5')) return; // the PS5 style has no waves (its background is CSS)
    this.blend(dt);
    // nothing to draw when the waves are fully covered (game wallpaper, custom wallpaper, or a game launching)
    const covered = (this.front.classList.contains('show') && this.currentGame) || this.custom.classList.contains('show') || this.dyn.classList.contains('show')
      || document.getElementById('app').classList.contains('launching');
    if (covered && this.drawnOnce) return;
    this.t += dt;
    this.draw(dt);
    this.drawnOnce = true;
  }

  draw(dt) {
    const s = ctx.settings;
    if (this.glw) { this.glw.draw(this.t, this.cur, { waves: s.waves, particles: s.particles && !this.light }); return; }
    const { g, w, h, t, theme } = this;
    const bg = g.createLinearGradient(0, 0, w * 0.35, h);
    bg.addColorStop(0, theme.top);
    bg.addColorStop(0.55, theme.mid);
    bg.addColorStop(1, theme.low);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);

    // soft light pool in the lower right, like the PS4 default theme
    const pool = g.createRadialGradient(w * 0.82, h * 1.05, 0, w * 0.82, h * 1.05, w * 0.7);
    pool.addColorStop(0, `rgba(${theme.wave},.22)`);
    pool.addColorStop(1, `rgba(${theme.wave},0)`);
    g.fillStyle = pool;
    g.fillRect(0, 0, w, h);

    if (s.waves) {
      g.globalCompositeOperation = 'lighter';
      const ribbons = [
        { y0: 1.12, rise: 0.62, bend: 0.28, amp: 0.035, f: 1.4, sp: 0.16, ph: 0.0, th: 0.07, a: 0.10 },
        { y0: 1.02, rise: 0.48, bend: 0.36, amp: 0.045, f: 1.1, sp: -0.12, ph: 2.1, th: 0.05, a: 0.08 },
        { y0: 1.25, rise: 0.66, bend: 0.20, amp: 0.03, f: 1.8, sp: 0.09, ph: 4.0, th: 0.10, a: 0.07 },
        { y0: 0.95, rise: 0.30, bend: 0.42, amp: 0.05, f: 0.9, sp: 0.07, ph: 5.2, th: 0.035, a: 0.06 },
      ];
      for (const r of ribbons) this.ribbon(r);
    }

    if (s.particles && !this.light) {
      g.globalCompositeOperation = 'lighter';
      for (const p of this.particles) {
        p.y -= p.vy * dt;
        p.x += p.vx * dt;
        p.tw += dt * 1.6;
        if (p.y < -10 || p.x > w + 10) Object.assign(p, this.newParticle(false), { x: Math.random() * w * 0.9 });
        g.globalAlpha = p.a * (0.55 + 0.45 * Math.sin(p.tw));
        const size = p.r * 6;
        g.drawImage(this.sprite(), p.x - size / 2, p.y - size / 2, size, size);
      }
      g.globalAlpha = 1;
    }
    g.globalCompositeOperation = 'source-over';
  }

  ribbon(r) {
    const { g, w, h, t, theme } = this;
    const steps = 48;
    const top = [];
    const bot = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const x = (u * 1.3 - 0.15) * w;
      const base = r.y0 - r.rise * u - r.bend * u * u + r.bend * 0.55 * u * u * u;
      const wav = r.amp * Math.sin(u * Math.PI * r.f * 2 + t * r.sp * 4 + r.ph);
      const thick = r.th * (0.55 + 0.45 * Math.sin(u * 5 + t * 0.35 + r.ph));
      top.push([x, (base + wav) * h]);
      bot.push([x, (base + wav + thick) * h]);
    }
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, `rgba(${theme.wave},0)`);
    grd.addColorStop(0.35, `rgba(${theme.wave},${r.a})`);
    grd.addColorStop(0.8, `rgba(${theme.wave},${r.a * 0.7})`);
    grd.addColorStop(1, `rgba(${theme.wave},0)`);
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(top[0][0], top[0][1]);
    for (const [x, y] of top) g.lineTo(x, y);
    for (let i = bot.length - 1; i >= 0; i--) g.lineTo(bot[i][0], bot[i][1]);
    g.closePath();
    g.fill();
    // bright edge line
    g.strokeStyle = `rgba(${theme.wave},${r.a * 1.6})`;
    g.lineWidth = 1;
    g.beginPath();
    top.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
  }
}
