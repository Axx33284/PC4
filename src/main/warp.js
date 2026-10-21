// Secure connection through Cloudflare WARP (free, from Cloudflare: https://one.one.one.one), driven by its own
// command line tool. It sends the PC's traffic through Cloudflare, so games and sites blocked by the local network
// or the ISP (like Roblox in Turkey) work again. PC4 can switch it on before chosen games start and off after.
// Nothing runs in the background: warp-cli is only called when something is switched or the status is asked for.
//
// Speed (measured in Turkey, 2026-09-30): sending everything through WARP made every new connection slower (DNS over
// TLS through the tunnel, ~60-70 ms to open a site instead of ~30). Roblox is blocked by the name in the connection
// (SNI), not by DNS, and nearly all of it lives in its own 128.116.0.0/17. So by default only the blocked games go
// through the tunnel ('games' route): WARP's split tunnel can only list what stays *outside*, so PC4 lists the whole
// internet except those addresses, and uses 'tunnel_only' mode (DNS from the internet provider, which answers Roblox
// correctly). Everything else stays on the normal connection at full speed. What PC4 changed in WARP is written to
// a file and put back when it disconnects (or at the next start, after a crash).
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const { execFile } = require('child_process');
const { EventEmitter } = require('events');

// the blocked games' servers: their own address blocks, plus names on shared CDNs (looked up at every connect,
// with the same DNS the game uses; the whole /16 goes through the tunnel since CDN addresses move around)
const BLOCKED = {
  roblox: {
    ranges: ['128.116.0.0/17'],
    hosts: ['www.roblox.com', 'apis.roblox.com', 'auth.roblox.com', 'clientsettingscdn.roblox.com', 'clientsettings.roblox.com',
      'create.roblox.com', 'rewarded-video.roblox.com', 'gamejoin.roblox.com', 'realtime-signalr.roblox.com'],
  },
};
// WARP's settings name for a mode -> the warp-cli argument that sets it back
const MODES = { WarpWithDnsOverTls: 'warp+dot', WarpWithDnsOverHttps: 'warp+doh', Warp: 'warp', TunnelOnly: 'tunnel_only',
  DnsOverHttps: 'doh', DnsOverTls: 'dot', WarpProxy: 'proxy', Proxy: 'proxy' };

// IPv4 ranges covering everything except the given CIDRs
const toInt = ip => ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);
const toIp = n => [24, 16, 8, 0].map(s => Math.floor(n / 2 ** s) % 256).join('.');
function complement(cidrs) {
  const blocks = cidrs.map(c => { const [ip, bits] = c.split('/'); const size = 2 ** (32 - Number(bits)); const start = Math.floor(toInt(ip) / size) * size; return [start, start + size]; })
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  let at = 0;
  const fill = (s, e) => {
    while (s < e) {
      let size = 2 ** 32;
      while (size > 1 && (s % size !== 0 || s + size > e)) size /= 2;
      out.push(`${toIp(s)}/${32 - Math.log2(size)}`);
      s += size;
    }
  };
  for (const [s, e] of blocks) { if (s > at) fill(at, s); at = Math.max(at, e); }
  fill(at, 2 ** 32);
  return out;
}
const inRange = (ip, cidr) => { const [base, bits] = cidr.split('/'); const size = 2 ** (32 - Number(bits)); return Math.floor(toInt(ip) / size) === Math.floor(toInt(base) / size); };

const DIRS = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map(d => path.join(d, 'Cloudflare', 'Cloudflare WARP'));

const run = (file, args, timeout = 15000) => new Promise(resolve => {
  const child = execFile(file, args, { windowsHide: true, timeout }, (err, out, errOut) => resolve({ ok: !err, out: String(out || ''), err: String(errOut || (err && err.message) || '') }));
  if (child.stdin) child.stdin.end();
});

class Warp extends EventEmitter {
  // routesFile: what PC4 changed in WARP's settings, to put back
  constructor(routesFile) {
    super();
    this.routesFile = routesFile;
    this.state = { installed: false, status: 'unknown', reason: '', busy: false, byPC4: false, route: null };
    this.find();
    this.queue = Promise.resolve();
    // a crash or a kill left WARP set to "games only": put it back (unless it's still connected that way)
    if (this.cli && fs.existsSync(routesFile)) this.serial(async () => { if ((await this.refresh()).status !== 'connected') await this.unroute(); });
  }

  // one WARP change at a time
  serial(fn) { const p = this.queue.then(fn, fn); this.queue = p.catch(() => {}); return p; }

  saved() { try { return JSON.parse(fs.readFileSync(this.routesFile, 'utf8')); } catch { return null; } }
  save(v) { try { if (v) fs.writeFileSync(this.routesFile, JSON.stringify(v)); else if (fs.existsSync(this.routesFile)) fs.unlinkSync(this.routesFile); } catch {} }

  async currentMode() {
    const r = await this.cmd('settings');
    const m = /Mode:\s*(\w+)/.exec(r.out);
    return m && MODES[m[1]] ? MODES[m[1]] : 'warp+dot';
  }

  // the addresses that must go through the tunnel right now
  async tunnelled() {
    const set = new Set();
    for (const game of Object.values(BLOCKED)) {
      game.ranges.forEach(c => set.add(c));
      await Promise.all(game.hosts.map(async h => {
        try {
          for (const a of await dns.lookup(h, { all: true, family: 4 })) {
            if (!game.ranges.some(c => inRange(a.address, c))) set.add(`${a.address.split('.').slice(0, 2).join('.')}.0.0/16`);
          }
        } catch {}
      }));
    }
    return [...set];
  }

  // only the blocked games through the tunnel (WARP's exclude list = everything else); only the difference is sent
  async routeGames() {
    const was = this.saved();
    const want = complement(await this.tunnelled());
    const have = new Set(was ? was.ranges : []);
    const mode = was ? was.mode : await this.currentMode();
    // ranges WARP already had (its defaults, the user's own) are never PC4's to remove
    const listed = new Set(((await this.cmd('tunnel', 'ip', 'list')).out.match(/\d+\.\d+\.\d+\.\d+\/\d+/g) || []).filter(c => !have.has(c)));
    this.save({ mode, ranges: [...new Set([...have, ...want.filter(c => !listed.has(c))])] }); // written first: a crash in between is still undone
    for (const c of have) if (!want.includes(c)) await this.cmd('tunnel', 'ip', 'remove-range', c);
    const mine = [];
    for (const c of want) {
      if (have.has(c)) mine.push(c);
      else if (!listed.has(c) && (await this.cmd('tunnel', 'ip', 'add-range', c)).ok) mine.push(c);
    }
    if (!was) await this.cmd('mode', 'tunnel_only');
    this.save({ mode, ranges: mine });
    this.set({ route: 'games' });
  }

  // WARP back the way it was: everything through the tunnel, its own DNS mode
  async unroute() {
    const was = this.saved();
    if (was) {
      for (const c of was.ranges) await this.cmd('tunnel', 'ip', 'remove-range', c);
      if (was.mode) await this.cmd('mode', was.mode);
      this.save(null);
    }
    this.set({ route: 'all' });
  }

  find() {
    this.cli = DIRS.map(d => path.join(d, 'warp-cli.exe')).find(f => fs.existsSync(f)) || null;
    this.set({ installed: !!this.cli });
    return this.cli;
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('change', this.state);
  }

  get connected() { return this.state.status === 'connected'; }

  // (--accept-tos only keeps the CLI from stopping to ask: the terms were accepted when WARP was set up, and PC4
  // asks the user once before it registers a new install itself)
  cmd(...args) { return run(this.cli, ['--accept-tos', ...args]); }

  // 'connected' | 'connecting' | 'disconnected' | 'unregistered' | 'missing' | 'error'
  async refresh() {
    if (!this.find()) { this.set({ status: 'missing', reason: '' }); return this.state; }
    const r = await this.cmd('-j', 'status');
    let status = 'error', reason = '';
    try {
      const j = JSON.parse(r.out);
      const s = String(j.status || '').toLowerCase();
      reason = String(j.reason || '');
      if (/registration/i.test(s + reason)) status = 'unregistered';
      else if (s.startsWith('connected')) status = 'connected';
      else if (s.startsWith('connecting')) status = 'connecting';
      else if (s.startsWith('disconnected')) status = 'disconnected';
      else status = s || 'error';
    } catch {
      const t = (r.out + r.err).toLowerCase();
      status = /registration/.test(t) ? 'unregistered' : 'error';
      reason = (r.out + r.err).trim().split('\n')[0].slice(0, 160);
    }
    this.set({ status, reason });
    return this.state;
  }

  // connects and waits until traffic really goes through Cloudflare (or it gives up)
  // route: 'games' (only the blocked games, fastest) | 'all' (everything through WARP)
  connect(opts = {}) { return this.serial(() => this.connectNow(opts)); }
  async connectNow({ byPC4 = false, route = 'games', timeoutMs = 15000 } = {}) {
    if (!this.find()) return { ok: false, error: 'Cloudflare WARP is not installed' };
    this.set({ busy: true });
    try {
      if (route === 'games') await this.routeGames(); else await this.unroute();
      let st = await this.refresh();
      if (st.status === 'connected') return { ok: true, already: true };
      if (st.status === 'unregistered') {
        const reg = await this.cmd('registration', 'new');
        if (!reg.ok) return { ok: false, error: `WARP could not register this PC: ${(reg.err || reg.out).trim().slice(0, 160)}` };
      }
      const r = await this.cmd('connect');
      if (!r.ok) return { ok: false, error: (r.err || r.out).trim().slice(0, 200) || 'WARP did not connect' };
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        await new Promise(res => setTimeout(res, 150));
        st = await this.refresh();
        if (st.status === 'connected') { if (byPC4) this.set({ byPC4: true }); return { ok: true }; }
      }
      return { ok: false, error: `WARP is still ${st.status}${st.reason ? ` (${st.reason})` : ''}` };
    } finally {
      this.set({ busy: false });
    }
  }

  disconnect() { return this.serial(() => this.disconnectNow()); }
  async disconnectNow() {
    if (!this.find()) return { ok: false };
    this.set({ busy: true });
    try {
      const r = await this.cmd('disconnect');
      await this.refresh();
      this.set({ byPC4: false });
      await this.unroute(); // WARP's own app works as before
      return { ok: r.ok };
    } finally {
      this.set({ busy: false });
    }
  }

  // "Install" button: Windows asks the user to allow it (UAC)
  async install() {
    const r = await run('winget', ['install', '--id', 'Cloudflare.Warp', '-e', '--silent', '--accept-source-agreements', '--accept-package-agreements'], 10 * 60 * 1000);
    await new Promise(res => setTimeout(res, 2000));
    await this.refresh();
    return this.state.installed ? { ok: true } : { ok: false, error: /not recognized|ENOENT/i.test(r.err) ? 'winget is not available on this PC' : 'The install did not finish' };
  }
}

module.exports = Warp;
