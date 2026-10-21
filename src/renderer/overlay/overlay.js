// The Quick Menu over a running game, like the PS4's: holding PS shows it on top of the game instead of
// switching back to PC4. This page lives in a transparent, always-on-top window that main.js shows and hides.
import { ctx, api, setState, subscribe, dispatch } from '../fullscreen/core.js';
import { Input } from '../fullscreen/input.js';
import { loadSoundPack, sleepAudio } from '../fullscreen/sound.js';
import { openQuickMenu, quickMenuOpen, closeQuickMenu } from '../fullscreen/quickmenu.js';
import { Player } from '../fullscreen/player.js'; // the remote control (see the import map)
import { loadCustomFonts, padStyle } from '../common/util.js';
import { toast } from '../fullscreen/ui.js';

ctx.overlay = true;
setState(await api.getState());
loadCustomFonts(ctx.state);
loadSoundPack(); // decoded only: the audio device opens on the first sound (this window waits hidden through the game)

function applyPadStyle() {
  const st = padStyle(ctx.settings);
  if (document.body.classList.contains(`pads-${st}`)) return;
  document.body.classList.remove('pads-ps4', 'pads-ps5', 'pads-xbox');
  document.body.classList.add(`pads-${st}`);
}
applyPadStyle();
// the console style (PS4 Quick Menu / PS5 Control Center) follows PC4's setting
const applyUiStyle = () => document.body.classList.toggle('ui-ps5', ctx.settings.uiStyle === 'ps5');
applyUiStyle();
subscribe(() => {
  applyPadStyle();
  applyUiStyle();
  if (ctx.input) { ctx.input.ignoreVirtual = !!(ctx.state.emulator && ctx.state.emulator.running); ctx.input.setBindings(ctx.settings); }
  loadSoundPack();
});

const input = new Input(a => {
  if (a === 'share') return; // captures come from the controller helper
  dispatch(a === 'home' || a === 'quickmenu' ? 'back' : a); // PS (or its key) again puts the menu away
}, null, mode => {
  document.body.classList.toggle('input-key', mode === 'key');
  document.body.classList.toggle('input-pad', mode === 'pad');
});
ctx.input = input;
input.setBindings(ctx.settings);
input.setMode('pad');
input.padOff = true; // the controller comes from the helper (below), whether or not this window has the focus

// ---- the controller, as reported by the helper while the menu is open ----
// bits: d-pad (or left stick) 1 up 2 down 4 left 8 right, 0x10 OPTIONS, 0x100 L1, 0x200 R1,
// 0x1000 cross, 0x2000 circle, 0x4000 square, 0x8000 triangle, 0x10000 L2, 0x20000 R2
const NAV = [[0x1, 'up'], [0x2, 'down'], [0x4, 'left'], [0x8, 'right'], [0x1000, 'accept'], [0x2000, 'back'], [0x4000, 'square'],
  [0x8000, 'triangle'], [0x100, 'l1'], [0x200, 'r1'], [0x10, 'options'], [0x10000, 'l2'], [0x20000, 'r2']];
const REPEATS = new Set(['up', 'down', 'left', 'right', 'l1', 'r1']);
let navMask = null; // null: the next report only says what's already held (the buttons you had down in the game)
const repeat = new Map();
function stopRepeat(a) { clearTimeout(repeat.get(a)); repeat.delete(a); }
function press(a) {
  input.emit(a, { source: 'pad' });
  if (!REPEATS.has(a)) return;
  let n = 0;
  const again = () => { n++; input.emit(a, { source: 'pad', repeat: true }); repeat.set(a, setTimeout(again, n > 8 ? 60 : 110)); };
  repeat.set(a, setTimeout(again, 380));
}
api.on('overlay-nav', b => {
  if (navMask === null) { navMask = b; return; }
  for (const [bit, a] of NAV) {
    const on = (b & bit) !== 0, was = (navMask & bit) !== 0;
    if (on && !was) press(a);
    else if (!on && was) stopRepeat(a);
  }
  navMask = b;
});
function resetNav() { navMask = null; for (const a of [...repeat.keys()]) stopRepeat(a); }

// the game kept the focus (it runs as administrator): say once that it still sees the controller
let hinted = false;
api.on('overlay-hint', text => { if (!hinted) { hinted = true; toast({ title: 'Quick Menu', body: text, ico: 'gamepad', duration: 7000, sound: false }); } });

api.on('state', s => setState(s));
api.on('overlay-open', () => {
  resetNav();
  Player.refresh();
  if (!quickMenuOpen()) openQuickMenu({ fromGame: true });
});
api.on('overlay-toggle', () => { if (quickMenuOpen()) closeQuickMenu(true); else openQuickMenu({ fromGame: true }); });
// the overlay was hidden (back to the game, Alt+Tab, handed over to PC4): put everything away quietly,
// including a keyboard or song list still open on top of the menu
api.on('overlay-close', () => {
  resetNav();
  closeQuickMenu(false, true);
  ctx.layers.length = 0;
  setTimeout(() => {
    if (quickMenuOpen()) return;
    sleepAudio();
    document.getElementById('overlays').replaceChildren();
    document.querySelectorAll('.qm-layer').forEach(n => n.remove());
  }, 350);
});
