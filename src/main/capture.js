// Captures, like the PS4's Share button: screenshots and video recordings of the screen (the game in front),
// saved as Pictures\PC4 Captures\<game>\<game> 2026-09-29 22-41-07.png / .mp4.
// Recording runs in a small hidden window (MediaRecorder, hardware H.264 when the PC has it) with the PC's sound.
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { desktopCapturer, screen, BrowserWindow, ipcMain, nativeImage } = require('electron');

const safe = s => String(s || 'PC4').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'PC4';
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`; };
const MEDIA = /\.(png|jpe?g|webp|mp4|webm|mkv)$/i;

class Capture extends EventEmitter {
  // dir(): the captures folder; game(): name of the game being played (or null)
  constructor({ dir, game, preload, page }) {
    super();
    this.dir = dir; this.game = game; this.preload = preload; this.page = page;
    this.rec = null;
    this.thumbs = new Map();
    ipcMain.on('rec:chunk', (e, buf) => { if (this.rec && e.sender === this.rec.win.webContents) this.rec.out.write(Buffer.from(buf)); });
    ipcMain.on('rec:done', e => { if (this.rec && e.sender === this.rec.win.webContents) this.finish(); });
    ipcMain.on('rec:error', (e, msg) => { if (this.rec && e.sender === this.rec.win.webContents) { this.emit('error', msg); this.finish(true); } });
  }

  folder() {
    const d = path.join(this.dir(), safe(this.game()));
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  // the screen the game is on, at its real pixel size
  async screenSource() {
    const d = screen.getPrimaryDisplay();
    const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
    const list = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    return list.find(s => s.display_id === String(d.id)) || list[0];
  }

  async screenshot() {
    try {
      const src = await this.screenSource();
      if (!src || src.thumbnail.isEmpty()) throw new Error('The screen could not be captured');
      const game = this.game();
      const file = path.join(this.folder(), `${safe(game)} ${stamp()}.png`);
      await fs.promises.writeFile(file, src.thumbnail.toPNG());
      this.emit('saved', { kind: 'screenshot', file, game });
      return file;
    } catch (e) { this.emit('error', e.message); return null; }
  }

  get recording() { return !!this.rec; }

  toggleRecording(maxMinutes = 30) { return this.rec ? this.stopRecording() : this.startRecording(maxMinutes); }

  async startRecording(maxMinutes = 30) {
    if (this.rec) return;
    const game = this.game();
    const base = path.join(this.folder(), `${safe(game)} ${stamp()}`);
    const win = new BrowserWindow({ show: false, width: 320, height: 200, webPreferences: { preload: this.preload, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    const d = screen.getPrimaryDisplay();
    this.rec = { win, base, game, file: null, out: null, started: Date.now() };
    // the page tells us which format it could record in; the file gets that extension
    ipcMain.once('rec:format', (e, ext) => {
      if (!this.rec || e.sender !== win.webContents) return;
      this.rec.file = `${base}.${ext}`;
      this.rec.out = fs.createWriteStream(this.rec.file);
      this.emit('recording', { on: true, game });
    });
    this.rec.timer = setTimeout(() => this.stopRecording(), maxMinutes * 60000);
    await win.loadFile(this.page, { query: { w: String(Math.round(d.size.width * d.scaleFactor)), h: String(Math.round(d.size.height * d.scaleFactor)) } });
  }

  stopRecording() {
    if (!this.rec) return;
    clearTimeout(this.rec.timer);
    try { this.rec.win.webContents.send('rec:stop'); } catch { this.finish(true); }
    setTimeout(() => this.rec && this.finish(), 5000); // the page didn't answer: close anyway
  }

  finish(failed = false) {
    const r = this.rec;
    if (!r) return;
    this.rec = null;
    clearTimeout(r.timer);
    const done = () => {
      try { r.win.destroy(); } catch {}
      this.emit('recording', { on: false, game: r.game });
      if (!failed && r.file) this.emit('saved', { kind: 'video', file: r.file, game: r.game, seconds: Math.round((Date.now() - r.started) / 1000) });
    };
    if (r.out) r.out.end(done); else done();
  }

  // ---- Capture Gallery ----
  async list() {
    const root = this.dir();
    const out = [];
    let games = [];
    try { games = await fs.promises.readdir(root, { withFileTypes: true }); } catch { return out; }
    for (const g of games.filter(d => d.isDirectory())) {
      const dir = path.join(root, g.name);
      let files = [];
      try { files = await fs.promises.readdir(dir); } catch { continue; }
      for (const f of files.filter(x => MEDIA.test(x))) {
        try {
          const st = await fs.promises.stat(path.join(dir, f));
          out.push({ file: path.join(dir, f), game: g.name, kind: /\.(mp4|webm|mkv)$/i.test(f) ? 'video' : 'screenshot', time: st.mtimeMs, size: st.size });
        } catch {}
      }
    }
    return out.sort((a, b) => b.time - a.time);
  }

  // a small picture for the gallery (Windows' own thumbnails, so videos get one too)
  async thumb(file) {
    if (this.thumbs.has(file)) return this.thumbs.get(file);
    let url = null;
    try { url = (await nativeImage.createThumbnailFromPath(file, { width: 480, height: 270 })).toDataURL(); } catch {}
    this.thumbs.set(file, url);
    if (this.thumbs.size > 400) this.thumbs.delete(this.thumbs.keys().next().value);
    return url;
  }
}

module.exports = { Capture, safeName: safe };
