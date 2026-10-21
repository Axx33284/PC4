// Keyboard controls: which keys press which controller button, changeable in Settings › Keyboard.
// Keys are stored as KeyboardEvent.code (the physical key), so they work the same on any layout (Turkish Q, F, …).
// settings.keyBindings holds only what was changed: { action: [code, …] }.

export const KEY_ACTIONS = [
  { id: 'home', glyph: 'home', label: 'PS Button', desc: 'Home screen', keys: ['Home', 'F1'] },
  { id: 'quickmenu', glyph: 'home', label: 'Quick Menu', desc: 'Like holding the PS button', keys: ['F3'] },
  { id: 'options', glyph: 'options', label: 'OPTIONS', desc: 'Options menu', keys: ['Tab', 'F2', 'ContextMenu'] },
  { id: 'share', glyph: 'share', label: 'SHARE', desc: 'Screenshot', keys: ['F8'] },
  { id: 'accept', glyph: 'cross', label: 'Cross', desc: 'Select', keys: ['Enter', 'Space', 'NumpadEnter'] },
  { id: 'back', glyph: 'circle', label: 'Circle', desc: 'Back', keys: ['Escape', 'Backspace'] },
  { id: 'triangle', glyph: 'triangle', label: 'Triangle', desc: 'Search, reset…', keys: ['KeyY', 'KeyT'] },
  { id: 'square', glyph: 'square', label: 'Square', desc: 'Play / pause, preview…', keys: ['Delete', 'KeyX'] },
  { id: 'l1', glyph: 'l1', label: 'L1', desc: 'Previous, jump left', keys: ['PageUp', 'KeyQ'] },
  { id: 'r1', glyph: 'r1', label: 'R1', desc: 'Next, jump right', keys: ['PageDown', 'KeyE'] },
  { id: 'l2', glyph: 'l2', label: 'L2', desc: 'Rewind', keys: ['BracketLeft'] },
  { id: 'r2', glyph: 'r2', label: 'R2', desc: 'Fast-forward', keys: ['BracketRight'] },
  { id: 'up', glyph: 'up', label: 'Up', keys: ['ArrowUp', 'KeyW'] },
  { id: 'down', glyph: 'down', label: 'Down', keys: ['ArrowDown', 'KeyS'] },
  { id: 'left', glyph: 'left', label: 'Left', keys: ['ArrowLeft', 'KeyA'] },
  { id: 'right', glyph: 'right', label: 'Right', keys: ['ArrowRight', 'KeyD'] },
];
const BY_ID = Object.fromEntries(KEY_ACTIONS.map(a => [a.id, a]));
// button glyphs in hints -> the action whose key they show
const GLYPH_ACTION = { cross: 'accept', circle: 'back' };

// Keys that work from anywhere, also while a game has the screen (Electron accelerators, set in the main process)
export const GLOBAL_ACTIONS = [
  { id: 'quickmenu', label: 'Quick Menu Over a Game', desc: 'Opens the Quick Menu on top of the game', key: 'Control+Alt+F3' },
  { id: 'home', label: 'Back to PC4', desc: 'Like pressing the PS button during a game', key: 'Control+Alt+Home' },
  { id: 'screenshot', label: 'Take a Screenshot', key: 'Control+Alt+S' },
  { id: 'record', label: 'Start / Stop Recording', key: 'Control+Alt+R' },
];

export const keysFor = (id, s) => ((s && s.keyBindings) || {})[id] || (BY_ID[id] ? BY_ID[id].keys : []);
export const isDefault = (id, s) => !((s && s.keyBindings) || {})[id];
export const globalKeyFor = (id, s) => {
  const v = ((s && s.globalKeys) || {})[id];
  return v === undefined ? (GLOBAL_ACTIONS.find(a => a.id === id) || {}).key || '' : v;
};

// code -> action, for Input
export function keyMap(s) {
  const map = {};
  for (const a of KEY_ACTIONS) for (const k of keysFor(a.id, s)) if (!map[k]) map[k] = a.id;
  return map;
}

// every other action that already uses this key
export function usedBy(code, s, except) {
  return KEY_ACTIONS.filter(a => a.id !== except && keysFor(a.id, s).includes(code));
}

// a readable name for a key code ("KeyY" -> "Y", "BracketLeft" -> "[")
const NAMES = {
  Escape: 'Esc', Backspace: 'Backspace', Enter: 'Enter', NumpadEnter: 'Num Enter', Space: 'Space', Tab: 'Tab', Delete: 'Del',
  Insert: 'Ins', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn', ContextMenu: 'Menu', CapsLock: 'Caps',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', BracketLeft: '[', BracketRight: ']', Semicolon: ';',
  Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`',
  ShiftLeft: 'Shift', ShiftRight: 'Right Shift', ControlLeft: 'Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Alt', AltRight: 'AltGr',
  MetaLeft: 'Win', MetaRight: 'Win', IntlBackslash: '<', NumpadAdd: 'Num +', NumpadSubtract: 'Num −', NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /', NumpadDecimal: 'Num .',
};
export function keyName(code) {
  if (!code) return '';
  if (NAMES[code]) return NAMES[code];
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit(\d)$/.exec(code))) return m[1];
  if ((m = /^Numpad(\d)$/.exec(code))) return `Num ${m[1]}`;
  return code;
}
// the key shown next to a button in hints: the first key bound to it
export function keyLabel(glyph, s) {
  const k = keysFor(GLYPH_ACTION[glyph] || glyph, s)[0];
  return k ? keyName(k) : '';
}

// "Control+Alt+F3" -> "Ctrl + Alt + F3"
export function acceleratorName(acc) {
  return acc ? acc.split('+').map(p => ({ Control: 'Ctrl', CommandOrControl: 'Ctrl', Super: 'Win' }[p] || p)).join(' + ') : 'Off';
}

// a keydown -> an Electron accelerator, or null while only modifiers are down / for keys it can't use
export function toAccelerator(e) {
  const code = e.code;
  if (/^(Shift|Control|Alt|Meta)(Left|Right)$/.test(code)) return null;
  let key = null, m;
  if ((m = /^Key([A-Z])$/.exec(code))) key = m[1];
  else if ((m = /^Digit(\d)$/.exec(code))) key = m[1];
  else if ((m = /^Numpad(\d)$/.exec(code))) key = `num${m[1]}`;
  else if (/^F([1-9]|1\d|2[0-4])$/.test(code)) key = code;
  else key = {
    Space: 'Space', Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
    PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
    Backslash: '\\', Backquote: '`', Escape: 'Escape', PrintScreen: 'PrintScreen', Pause: 'Pause',
  }[code] || null;
  if (!key) return null;
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  return [...mods, key].join('+');
}
