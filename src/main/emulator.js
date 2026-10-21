// Xbox controller emulation for PlayStation controllers (like DS4Windows), run by a small helper:
// src/helper/Pc4Pad.cs is compiled once with the C# compiler that ships with Windows, then started as
// pc4pad.exe. It needs the ViGEmBus driver (the one DS4Windows uses); HidHide, when installed, hides the
// real controller from games so they only see the Xbox one.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');

const CSC = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const CSC32 = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe');
const HIDHIDE = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Nefarius Software Solutions', 'HidHide', 'x64', 'HidHideCLI.exe');
const CURVES = { linear: 1, precise: 1.6, fast: 0.7 };
// same presets as the renderer's light bar (src/renderer/common/lightbar.js)
const LIGHT = { blue: [0, 32, 255], red: [255, 0, 0], green: [0, 255, 40], pink: [255, 20, 147], purple: [140, 0, 255], cyan: [0, 200, 255], orange: [255, 90, 0], yellow: [255, 200, 0], white: [255, 255, 255] };
const BRIGHT = { bright: 1, medium: 0.45, dim: 0.15, off: 0 };
function lightColor(s) {
  const v = s.lightBar || 'blue';
  const rgb = /^#[0-9a-f]{6}$/i.test(v) ? [1, 3, 5].map(i => parseInt(v.slice(i, i + 2), 16)) : LIGHT[v] || LIGHT.blue;
  const k = BRIGHT[s.lightBarBrightness || 'bright'] ?? 1;
  return rgb.map(c => Math.round(c * k));
}

// (stdin is closed right away: HidHideCLI otherwise waits for more commands on it)
const run = (file, args, opts = {}) => new Promise(resolve => {
  const child = execFile(file, args, { windowsHide: true, timeout: 20000, ...opts }, (err, out, errOut) => resolve({ ok: !err, out: String(out || ''), err: String(errOut || (err && err.message) || '') }));
  if (child.stdin) child.stdin.end();
});

class Emulator extends EventEmitter {
  // prebuiltDir: the helper compiled into the installer (resources/helper), used when its version matches
  constructor(binDir, source, prebuiltDir = null) {
    super();
    this.binDir = binDir;
    this.source = source;
    this.prebuiltDir = prebuiltDir;
    this.exe = path.join(binDir, 'pc4pad.exe');
    this.wakeExe = path.join(binDir, 'pc4wake.exe'); // the same helper without a console window, for "Press PS to Start PC4"
    this.proc = null;
    this.state = { running: false, starting: false, pads: [], error: null, driver: null, hidhide: fs.existsSync(HIDHIDE) };
    this.hidden = new Set();   // device instances we hid with HidHide (undone on stop)
    this.others = new Set();   // ones already hidden by another program (DS4Windows…): never unhidden by PC4
    this.wantRunning = false;
    this.restarts = 0;
    // HidHide keeps a device hidden even across reboots, so what PC4 hid is also written down here: if PC4 is
    // killed or crashes during a game, the next start gives the controller back
    this.recoverFile = path.join(binDir, 'hidden.json');
    this.hiding = this.recover();
  }

  setState(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('change', this.state);
  }

  // is the ViGEmBus driver installed? (checked once, then after installs)
  async checkDriver() {
    const r = await run('sc.exe', ['query', 'ViGEmBus']);
    const driver = r.ok && /STATE\s*:\s*\d+\s+RUNNING/i.test(r.out) ? 'running' : r.ok ? 'stopped' : 'missing';
    this.setState({ driver, hidhide: fs.existsSync(HIDHIDE) });
    return driver;
  }

  // compiles the helper when it's missing or its source changed
  ensureHelper() { return this.build(this.exe, 'exe'); }
  // pc4wake.exe (a window-less build, started with Windows): a running copy is closed first so it can be replaced
  ensureWake() { return this.build(this.wakeExe, 'winexe', () => run('taskkill.exe', ['/IM', 'pc4wake.exe', '/F'])); }

  async build(exe, target, beforeReplace = null) {
    const name = path.basename(exe, '.exe');
    const src = fs.readFileSync(this.source, 'utf8');
    const hash = crypto.createHash('sha1').update(src).digest('hex').slice(0, 12);
    const stamp = path.join(this.binDir, `${name}.version`);
    try { if (fs.existsSync(exe) && fs.readFileSync(stamp, 'utf8') === hash) return true; } catch {}
    fs.mkdirSync(this.binDir, { recursive: true });
    if (beforeReplace && fs.existsSync(exe)) { await beforeReplace(); await new Promise(r => setTimeout(r, 300)); }
    // the installer's copy: no compiling on this PC
    if (this.prebuiltDir) {
      try {
        if (fs.readFileSync(path.join(this.prebuiltDir, 'pc4pad.version'), 'utf8').trim() === hash) {
          fs.copyFileSync(path.join(this.prebuiltDir, `${name}.exe`), exe);
          fs.writeFileSync(stamp, hash);
          return true;
        }
      } catch {}
    }
    const csFile = path.join(this.binDir, 'Pc4Pad.cs'); // outside the app archive, where csc can read it
    fs.writeFileSync(csFile, src);
    const csc = fs.existsSync(CSC) ? CSC : CSC32;
    if (!fs.existsSync(csc)) throw new Error('The .NET Framework 4 compiler was not found on this PC');
    const r = await run(csc, ['-nologo', '-optimize+', `-target:${target}`, `-out:${exe}`, csFile], { timeout: 60000 });
    if (!r.ok || !fs.existsSync(exe)) throw new Error(`Could not build the controller helper: ${(r.out + r.err).trim().slice(0, 300)}`);
    fs.writeFileSync(stamp, hash);
    return true;
  }

  configLine(s, color) {
    const n = v => Number(v || 0).toFixed(3);
    const take = `psmenu=${s.quickMenu !== false ? 1 : 0} pshome=${s.psHome ? 1 : 0} sharecap=${s.captureShare !== false ? 1 : 0}`;
    return `config ldz=${n(s.emuDeadzoneL)} rdz=${n(s.emuDeadzoneR)} tdz=${n(s.emuTriggerDeadzone)} adz=${n(s.emuAntiDeadzone)}`
      + ` curve=${CURVES[s.emuCurve] || 1} rumble=${n(s.emuRumble ?? 1)} invly=${s.emuInvertLY ? 1 : 0} invry=${s.emuInvertRY ? 1 : 0}`
      + ` exclusive=${s.emuHide === 'off' ? 0 : 1} battery=${s.emuBatteryLight ? 1 : 0} tp=${s.emuTouchpad || 'back'} color=${color.join(',')} ${take}`;
  }

  // mode 'emulate': PlayStation pads become Xbox pads; 'ds4': they're passed through a virtual DUALSHOCK 4 (during
  // games, so PC4 can take the controller for the Quick Menu); 'watch': only the PS / Share buttons and the volume
  async start(settings, color, mode = 'emulate') {
    if (this.proc && this.mode !== mode) await this.stop();
    this.wantRunning = true;
    this.mode = mode;
    this.settings = settings; this.color = color;
    if (this.proc || this.state.starting) return this.state;
    this.hideFailed = false;
    this.setState({ starting: true, error: null, mode });
    try {
      if (mode !== 'watch' && (await this.checkDriver()) === 'missing') throw new Error('The ViGEmBus driver is not installed');
      await this.ensureHelper();
    } catch (e) {
      this.wantRunning = false;
      this.setState({ starting: false, running: false, error: e.message });
      return this.state;
    }
    if (!this.wantRunning) { this.setState({ starting: false }); return this.state; }
    // detached: Node puts its children in a job that Windows kills with PC4. The helper has to outlive a killed
    // PC4 for a moment to give the controller back (it quits by itself when PC4's process is gone).
    const p = spawn(this.exe, [String(process.pid), mode], { windowsHide: true, detached: true, stdio: ['pipe', 'pipe', 'ignore'] });
    p.__mode = mode; p.__started = Date.now();
    this.proc = p;
    this.setState({ pads: [] });
    let buf = '';
    p.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) this.onLine(line); }
    });
    p.on('exit', code => {
      if (this.proc !== p) return;
      this.proc = null;
      this.setState({ running: false, passthrough: false, watching: false, pads: [] });
      this.unhideAll();
      // a crash restarts the helper (a few times); stopping on purpose doesn't
      if (this.wantRunning && this.restarts < 3 && code !== 2) { this.restarts++; setTimeout(() => this.wantRunning && this.start(this.settings, this.color, this.mode), 1500); }
    });
    p.stdin.on('error', () => {});
    this.send(this.configLine(settings, color));
    this.setState({ starting: false, running: mode === 'emulate', passthrough: mode === 'ds4', watching: true });
    return this.state;
  }

  send(line) { if (this.proc && this.proc.stdin.writable) this.proc.stdin.write(line + '\n'); }

  onLine(line) {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (m.type === 'status') {
      this.restarts = 0;
      this.setState({ pads: m.pads || [], error: m.bus === false ? 'The ViGEmBus driver is not available' : this.state.error });
      if (this.hides()) this.hide(m.pads || []);
    } else if (m.type === 'button') this.emit('button', m.button, m.event);
    else if (m.type === 'nav') this.emit('nav', m.b);
    else if (m.type === 'volume') { this.volume = m; this.emit('volume', m); }
    else if (m.type === 'outputs') this.emit('outputs', m.list || []);
    else if (m.type === 'error') this.setState({ error: m.message });
    else if (m.type === 'log') console.log('[pc4pad]', m.message);
  }

  update(settings, color) {
    this.settings = settings; this.color = color;
    this.send(this.configLine(settings, color));
    if (!this.hides()) this.unhideAll();
    else this.hide(this.state.pads);
  }

  testRumble() { this.send('rumble 200 160 700'); }
  // while the Quick Menu is over a game, the virtual Xbox pad holds still (the game doesn't see menu presses)
  freeze(on) { this.send(`config freeze=${on ? 1 : 0}`); }
  // while the Quick Menu is over a game the helper reports the controller's buttons ('nav' events)
  menu(on) { this.send(`config menu=${on ? 1 : 0}`); }
  get emulating() { return (this.mode === 'emulate' || this.mode === 'ds4') && !!this.proc && !!(this.state.pads || []).length; }
  // the real controller is hidden from games: always with passthrough (the game would see it twice), for Xbox
  // emulation when chosen
  hides() { return this.mode === 'ds4' || (this.mode === 'emulate' && !!this.settings && this.settings.emuHide === 'hidhide'); }

  // resolves once every real pad is hidden and its virtual pad is plugged in (false: no controller, hiding
  // failed, or it took too long). Switching modes restarts the helper: it waits for the new one.
  ready(mode, ms = 4000) {
    const t0 = Date.now();
    const covered = p => !p.instance || this.hidden.has(p.instance) || this.others.has(p.instance);
    return new Promise(resolve => {
      const check = async () => {
        if (Date.now() - t0 > ms || this.hideFailed) return resolve(false);
        if (!this.proc || this.state.starting || this.proc.__mode !== mode) return setTimeout(check, 50);
        const pads = this.state.pads || [];
        if (!pads.length && Date.now() - this.proc.__started > 1200) return resolve(false); // no PlayStation controller
        if (pads.length && pads.every(p => covered(p) && p.slot > 0)) {
          await this.hiding;
          if (!this.hideFailed && (this.state.pads || []).every(covered)) return resolve(true);
        }
        setTimeout(check, 50);
      };
      check();
    });
  }

  // sound outputs (speakers, headsets, HDMI…): [{ id, name, default }]; with an id, that one becomes the default
  getOutputs(setId) {
    if (!this.proc) return Promise.resolve(null);
    return new Promise(resolve => {
      const t = setTimeout(() => { this.off('outputs', on); resolve(null); }, 2500);
      const on = list => { clearTimeout(t); this.off('outputs', on); resolve(list); };
      this.on('outputs', on);
      this.send(setId ? `output ${setId}` : 'outputs');
    });
  }

  // system volume through the helper (Windows Core Audio): resolves with { level 0..1, muted }
  getVolume(set) {
    if (!this.proc) return Promise.resolve(null);
    return new Promise(resolve => {
      const t = setTimeout(() => { this.off('volume', on); resolve(this.volume || null); }, 1500);
      const on = v => { clearTimeout(t); this.off('volume', on); resolve(v); };
      this.on('volume', on);
      this.send(set == null ? 'volume' : typeof set === 'boolean' ? `mute ${set ? 1 : 0}` : `volume ${Math.max(0, Math.min(1, set)).toFixed(3)}`);
    });
  }

  // HidHide calls run one after another: a status line can arrive while the previous hide is still running
  queue(fn) {
    const p = (this.hiding || Promise.resolve()).then(fn, fn);
    this.hiding = p.catch(() => {});
    return p;
  }

  // HidHide: games stop seeing the real controller; PC4 and its helper still do
  hide(pads) { return this.queue(() => this.hideNow(pads)); }
  async hideNow(pads) {
    if (!this.state.hidhide) return false;
    const want = pads.map(p => p.instance).filter(i => i && !this.hidden.has(i) && !this.others.has(i));
    if (!want.length) return true;
    // already hidden by another program: it stays theirs (PC4 won't unhide it when the game ends)
    const list = await run(HIDHIDE, ['--dev-list']);
    const already = new Set((list.out.match(/HID\\[^"\s]+/gi) || []).map(i => i.toUpperCase()));
    for (const i of want) if (already.has(i.toUpperCase())) this.others.add(i);
    const fresh = want.filter(i => !this.others.has(i));
    if (!fresh.length) return true;
    // remember whether hiding was on before PC4 touched it, to put it back exactly
    if (this.cloakBefore == null) { const st = await run(HIDHIDE, ['--cloak-state']); this.cloakBefore = /--cloak-on/.test(st.out); }
    this.saveHidden([...this.hidden, ...fresh]); // written down first: a crash in between still gets undone
    const args = ['--app-reg', this.exe, '--app-reg', process.execPath];
    for (const i of fresh) args.push('--dev-hide', i);
    args.push('--cloak-on');
    const r = await run(HIDHIDE, args);
    // HidHideCLI exits with 0 even when it did nothing: read the list back
    const after = r.ok ? await run(HIDHIDE, ['--dev-list']) : r;
    const listed = new Set((after.out.match(/HID\\[^"\s]+/gi) || []).map(i => i.toUpperCase()));
    // (kept in the list either way: whatever did get hidden is given back later; unhiding a visible one is harmless)
    fresh.forEach(i => this.hidden.add(i));
    if (!r.ok || !fresh.every(i => listed.has(i.toUpperCase()))) {
      // not hidden: passthrough must not go on (the game would see the controller twice)
      this.hideFailed = true;
      this.setState({ error: `HidHide: ${r.err.trim().slice(0, 160) || 'could not hide the controller'}` });
      return false;
    }
    return true;
  }

  unhideAll() { return this.queue(() => this.unhideNow()); }
  async unhideNow() {
    this.others.clear();
    this.hideFailed = false;
    if (!this.hidden.size || !this.state.hidhide) { this.hidden.clear(); this.saveHidden([]); return; }
    const args = [];
    for (const i of this.hidden) args.push('--dev-unhide', i);
    if (this.cloakBefore === false) args.push('--cloak-off');
    this.cloakBefore = null;
    this.hidden.clear();
    await run(HIDHIDE, args);
    this.saveHidden([]);
  }

  // writes down what PC4 has hidden, and tells the helper how to undo it if PC4 goes away without doing it
  saveHidden(list) {
    const args = list.flatMap(i => ['--dev-unhide', i]);
    if (args.length && this.cloakBefore === false) args.push('--cloak-off');
    try {
      if (list.length) fs.writeFileSync(this.recoverFile, JSON.stringify({ instances: list, cloakBefore: this.cloakBefore }));
      else if (fs.existsSync(this.recoverFile)) fs.unlinkSync(this.recoverFile);
    } catch {}
    this.send(args.length ? `onexit ${[HIDHIDE, this.recoverFile, ...args].join('\t')}` : 'onexit');
  }

  // what a killed or crashed PC4 left hidden
  async recover() {
    let left;
    try { left = JSON.parse(fs.readFileSync(this.recoverFile, 'utf8')); } catch { return; }
    const list = (left && Array.isArray(left.instances) ? left.instances : []).filter(i => typeof i === 'string');
    if (list.length && fs.existsSync(HIDHIDE)) {
      const args = list.flatMap(i => ['--dev-unhide', i]);
      if (left.cloakBefore === false) args.push('--cloak-off');
      await run(HIDHIDE, args);
      console.log('[pc4pad] gave back controllers a previous run left hidden:', list.join(', '));
    }
    try { fs.unlinkSync(this.recoverFile); } catch {}
  }

  async stop() {
    this.wantRunning = false;
    const p = this.proc;
    if (!p) { await this.unhideAll(); return; }
    this.send('quit');
    await new Promise(resolve => {
      const t = setTimeout(() => { try { p.kill(); } catch {} resolve(); }, 2500);
      p.once('exit', () => { clearTimeout(t); resolve(); });
    });
    this.proc = null;
    await this.unhideAll();
    this.setState({ running: false, passthrough: false, watching: false, pads: [] });
  }

  // "Install driver" buttons: Windows asks the user to allow it (UAC)
  async install(which) {
    const id = which === 'hidhide' ? 'Nefarius.HidHide' : 'ViGEm.ViGEmBus';
    const r = await run('winget', ['install', '--id', id, '-e', '--silent', '--accept-source-agreements', '--accept-package-agreements'], { timeout: 10 * 60 * 1000 });
    await this.checkDriver();
    const ok = which === 'hidhide' ? fs.existsSync(HIDHIDE) : this.state.driver !== 'missing';
    return ok ? { ok: true, restart: which !== 'hidhide' && this.state.driver !== 'running' }
      : { ok: false, error: /not recognized|ENOENT/i.test(r.err) ? 'winget is not available on this PC' : 'The install did not finish' };
  }
}

module.exports = { Emulator, lightColor };
