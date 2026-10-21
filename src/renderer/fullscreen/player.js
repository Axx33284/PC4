// PC4's music player: YouTube Music songs and your own music files, playing in the background — also while
// you play a game, like Spotify on the PS4. The Quick Menu and the Media Player both control it.
import { ctx, api } from './core.js';
import { Music } from './sound.js';
import { fileUrl } from '../common/util.js';
import { toast } from './ui.js';

const audio = new Audio();
audio.preload = 'auto';
const listeners = new Set();
const emit = () => { for (const fn of listeners) try { fn(Player); } catch {} };
const volume = () => {
  const s = ctx.settings;
  return s.muteAll ? 0 : Math.min(1, (s.masterVolume ?? 1) * (s.playerVolume ?? 0.8));
};

export const Player = {
  queue: [],       // [{ title, artist, url (YouTube) | file (local), thumb }]
  index: -1,
  current: null,   // the song playing, with what was learned while resolving it
  loading: false,
  error: null,

  get active() { return !!this.current; },
  get paused() { return audio.paused; },
  get time() { return audio.currentTime || 0; },
  get duration() { return (this.current && this.current.duration) || audio.duration || 0; },

  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  async play(items, start = 0) {
    this.queue = items.slice();
    await this.playAt(start);
  },

  async playAt(i) {
    const it = this.queue[i];
    if (!it) return;
    this.index = i;
    this.loading = true;
    this.error = null;
    this.current = { ...it, cover: it.cover || it.thumb || null };
    Music.hold(400, 'player'); // the menu music steps aside
    audio.pause();
    emit();
    let src = it.file ? fileUrl(it.file) : null;
    if (!src && it.url) {
      const r = await api.musicResolve(it.url);
      if (this.index !== i) return; // skipped meanwhile
      if (!r.ok) {
        this.loading = false; this.error = r.error; emit();
        toast({ title: "Can't play this song", body: r.error, ico: 'x', sound: false, error: true });
        if (i < this.queue.length - 1) setTimeout(() => this.index === i && this.playAt(i + 1), 1200);
        return;
      }
      src = r.stream;
      Object.assign(this.current, { title: r.title || it.title, artist: r.artist || it.artist, duration: r.duration, cover: r.cover || this.current.cover });
    }
    audio.src = src;
    audio.volume = volume();
    await audio.play().catch(() => {});
    this.loading = false;
    emit();
    if (document.hasFocus()) toast({ id: 'np', title: 'Now playing', body: `${this.current.title}${this.current.artist ? ` · ${this.current.artist}` : ''}`, ico: 'music', sound: false });
  },

  toggle() {
    if (!this.current) return;
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  },
  next() { if (this.index < this.queue.length - 1) this.playAt(this.index + 1); else this.stop(); },
  prev() { if (audio.currentTime > 4 || this.index <= 0) audio.currentTime = 0; else this.playAt(this.index - 1); },
  seek(d) { if (this.current) audio.currentTime = Math.max(0, Math.min((audio.duration || 0) - 0.5, audio.currentTime + d)); },

  stop() {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    this.current = null; this.queue = []; this.index = -1; this.loading = false;
    Music.release('player');
    emit();
  },

  refreshVolume() { audio.volume = volume(); },

  setVolume(v) {
    const val = Math.max(0, Math.min(1, Math.round(v * 20) / 20));
    ctx.settings.playerVolume = val;
    audio.volume = volume();
    api.updateSettings({ playerVolume: val });
    emit();
  },
};

audio.addEventListener('ended', () => Player.next());
audio.addEventListener('play', emit);
audio.addEventListener('pause', emit);
let lastTick = 0;
audio.addEventListener('timeupdate', () => { const t = Math.floor(audio.currentTime); if (t !== lastTick) { lastTick = t; emit(); } });
audio.addEventListener('error', () => { if (Player.current && !Player.loading) { Player.error = 'Playback failed'; emit(); Player.next(); } });

// songs from a folder on the PC (Media Player)
export function playFiles(files, start = 0) {
  return Player.play(files.map(f => ({ file: f.file, title: f.title || f.file.split(/[\\/]/).pop().replace(/\.[^.]+$/, ''), artist: f.artist || '', thumb: f.thumb || null })), start);
}

export const fmtTime = s => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
