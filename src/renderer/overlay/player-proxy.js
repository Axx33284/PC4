// The music player as seen from the Quick Menu overlay: the songs play in PC4's main window
// (src/renderer/fullscreen/player.js); this mirrors its state and sends it the commands.
import { api } from '../fullscreen/core.js';

let snap = { current: null, paused: true, time: 0, duration: 0, loading: false, at: 0 };
const listeners = new Set();
const emit = () => { for (const fn of listeners) try { fn(Player); } catch {} };
api.on('player-state', s => { if (s) { snap = s; emit(); } });
const cmd = (c, ...args) => api.playerCmd(c, args);

export const Player = {
  get queue() { return []; },
  get current() { return snap.current; },
  get active() { return !!snap.current; },
  get paused() { return snap.paused; },
  get loading() { return snap.loading; },
  get duration() { return snap.duration || 0; },
  // the time moves on between updates while playing
  get time() { return snap.paused || !snap.at ? snap.time : Math.min(snap.time + (Date.now() - snap.at) / 1000, snap.duration || Infinity); },

  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  play(items, start = 0) { return cmd('play', items, start); },
  playAt(i) { return cmd('playAt', i); },
  toggle() { cmd('toggle'); },
  next() { cmd('next'); },
  prev() { cmd('prev'); },
  seek(d) { cmd('seek', d); },
  stop() { snap = { ...snap, current: null }; emit(); cmd('stop'); },
  setVolume(v) { cmd('setVolume', v); },
  refreshVolume() {},
  refresh() { cmd('snapshot'); },
};

export function playFiles(files, start = 0) { return cmd('playFiles', files, start); }

export const fmtTime = s => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
