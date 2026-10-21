// Updates from GitHub Releases (github.com/Axx33284/PC4, see "publish" in package.json) through electron-updater.
// PC4 looks for a newer release a minute after it starts and every 6 hours, downloads it in the background (never
// while a game is running) and installs it the next time PC4 closes, or right away when the player says so.
// Only the installed app updates itself; while developing there's nothing to update.
const { EventEmitter } = require('events');

class Updater extends EventEmitter {
  constructor({ app, log, busy }) {
    super();
    this.app = app;
    this.log = log;
    this.busy = busy;            // () => true while a game runs: wait with the download
    this.state = { status: 'idle', version: null, progress: 0, error: null, checkedAt: 0 };
    this.au = null;
    if (!app.isPackaged) { this.state.status = 'dev'; return; }
    try {
      ({ autoUpdater: this.au } = require('electron-updater'));
    } catch (e) { this.log('updater:', e); this.state.status = 'dev'; return; }
    const au = this.au;
    au.autoDownload = false;      // downloaded by start(), so it can wait for games to end
    au.autoInstallOnAppQuit = true;
    au.logger = { info: () => {}, warn: m => this.log('updater:', m), error: m => this.log('updater:', m), debug: () => {} };
    au.on('checking-for-update', () => this.set({ status: 'checking', error: null }));
    au.on('update-not-available', () => this.set({ status: 'latest', checkedAt: Date.now() }));
    au.on('update-available', info => { this.set({ status: 'available', version: info.version, checkedAt: Date.now() }); this.download(); });
    au.on('download-progress', p => this.set({ status: 'downloading', progress: (p.percent || 0) / 100 }));
    au.on('update-downloaded', info => { this.set({ status: 'ready', version: info.version, progress: 1 }); this.emit('ready', info.version); });
    au.on('error', e => this.set({ status: 'error', error: String((e && e.message) || e).split('\n')[0] }));
  }

  set(patch) { Object.assign(this.state, patch); this.emit('change', this.state); }

  start() {
    if (!this.au) return;
    setTimeout(() => this.check(), 60 * 1000);
    setInterval(() => this.check(), 6 * 60 * 60 * 1000);
  }

  async check() {
    if (!this.au || ['checking', 'downloading', 'ready'].includes(this.state.status)) return this.state;
    try { await this.au.checkForUpdates(); } catch (e) { this.set({ status: 'error', error: String(e.message || e).split('\n')[0] }); }
    return this.state;
  }

  download() {
    if (!this.au) return;
    if (this.busy()) { clearTimeout(this.waitT); this.waitT = setTimeout(() => this.download(), 5 * 60 * 1000); return; }
    this.au.downloadUpdate().catch(e => this.set({ status: 'error', error: String(e.message || e).split('\n')[0] }));
  }

  // restart into the new version now (the installer runs silently and opens PC4 again)
  install() {
    if (this.au && this.state.status === 'ready') this.au.quitAndInstall(true, true);
  }
}

module.exports = { Updater };
