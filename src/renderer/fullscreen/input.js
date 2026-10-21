// Keyboard, mouse-wheel and gamepad input, all turned into the same small set of actions.
// Actions: up down left right accept back options triangle square l1 r1 l2 r2 home quickmenu share
// The keyboard's keys come from keys.js (changeable in Settings › Keyboard): setBindings(settings).
import { keyMap } from './keys.js';

// keys that still work inside a text field (everything else types)
const FIELD_KEYS = new Set(['Enter', 'NumpadEnter', 'Escape', 'ArrowUp', 'ArrowDown', 'Tab']);

// standard gamepad layout (XInput / DualShock / DualSense in browsers)
// 8 = SHARE / View (captures), 16 = PS: a tap goes home, holding it opens the Quick Menu
const PADMAP = { 0: 'accept', 1: 'back', 2: 'square', 3: 'triangle', 4: 'l1', 5: 'r1', 6: 'l2', 7: 'r2', 9: 'options', 8: 'share', 10: 'l3', 11: 'r3', 12: 'up', 13: 'down', 14: 'left', 15: 'right', 16: 'home' };
const HOLD_MS = 600;
const REPEATABLE = new Set(['up', 'down', 'left', 'right', 'l1', 'r1']);

export class Input {
  constructor(onAction, onPadChange, onModeChange) {
    this.onAction = onAction;
    this.onPadChange = onPadChange;
    this.onModeChange = onModeChange;
    this.mode = null; // 'pad' | 'key': which button icons to show
    this.held = new Map(); // action -> {next, count}
    this.prev = {};
    this.enabled = true;
    this.padCount = 0;
    this.keys = keyMap(null);

    window.addEventListener('keydown', e => this.key(e));
    window.addEventListener('keyup', e => this.keyUp(e));
    window.addEventListener('blur', () => { if (this.keysDown) this.keysDown.clear(); });
    window.addEventListener('gamepadconnected', e => this.padEvent(true, e.gamepad));
    window.addEventListener('gamepaddisconnected', e => this.padEvent(false, e.gamepad));
    let wheelLock = 0;
    window.addEventListener('wheel', e => {
      const now = performance.now();
      if (now < wheelLock) return;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(d) < 4) return;
      wheelLock = now + 90;
      this.emit(d > 0 ? 'wheel-down' : 'wheel-up', { source: 'mouse' });
    }, { passive: true });
    requestAnimationFrame(() => this.poll());
  }

  setMode(m) {
    if (m === this.mode) return;
    this.mode = m;
    if (this.onModeChange) this.onModeChange(m);
  }

  // the keyboard's keys (settings.keyBindings over the defaults)
  setBindings(settings) { this.keys = keyMap(settings); }

  isHeld(action) { return (this.heldNow && this.heldNow.has(action)) || (this.keysDown && this.keysDown.has(action)); }

  emit(action, info) {
    if (info && (info.source === 'pad' || info.source === 'key')) this.setMode(info.source);
    if (this.enabled) this.onAction(action, info);
  }

  key(e) {
    if (this.capture) { this.capture(e); return; } // Settings › Keyboard is waiting for a new key
    const inField = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
    this.setMode('key');
    if (e.key === 'F11') { e.preventDefault(); window.pc4.window('toggleFullscreen'); return; }
    // with Ctrl / Alt / Win held it's a shortcut (the global ones: Ctrl+Alt+S…), not a controller button
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const action = this.keys[e.code];
    if (inField && !FIELD_KEYS.has(e.code)) return;
    if (!action) return;
    e.preventDefault();
    // a held key works like a held button (L2 + △ on the on-screen keyboard)
    (this.keysDown || (this.keysDown = new Set())).add(action);
    this.emit(action, { source: 'key', repeat: e.repeat, key: e.key });
  }

  keyUp(e) {
    if (!this.keysDown) return;
    const action = this.keys[e.code];
    if (action) this.keysDown.delete(action);
  }

  padEvent(connected, pad) {
    const pads = [...navigator.getGamepads()].filter(Boolean);
    this.padCount = pads.length;
    if (this.onPadChange) this.onPadChange(connected, pad, this.padCount);
  }

  poll() {
    requestAnimationFrame(() => this.poll());
    if (this.padOff) return; // the Quick Menu overlay gets the controller from the helper instead
    const now = performance.now();
    // the controller belongs to whatever window is in front: while a game has focus PC4 ignores it completely,
    // and for a moment after PC4 comes back, so a button still held from the game doesn't trigger anything
    if (!document.hasFocus()) { this.held.clear(); this.heldNow = new Set(); this.quietUntil = now + 600; return; }
    if (now < (this.quietUntil || 0)) { this.held.clear(); return; }
    let pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    // PC4's own Xbox emulation adds a virtual Xbox pad that mirrors the PlayStation one: read only the real pad
    if (this.ignoreVirtual && pads.some(p => /054c/i.test(p.id))) pads = pads.filter(p => !/xinput|045e/i.test(p.id));
    // controller passthrough during a game adds a virtual DUALSHOCK 4 (054c:05c4) that mirrors the real one
    if (this.ignoreVirtualDs4) { const real = pads.filter(p => !/product: 05c4/i.test(p.id)); if (real.length) pads = real; }
    if (!pads.length) return;
    const down = new Set();
    for (const p of pads) {
      p.buttons.forEach((b, i) => { if (b.pressed && PADMAP[i]) down.add(PADMAP[i]); });
      const [x = 0, y = 0] = p.axes;
      if (x < -0.55) down.add('left');
      if (x > 0.55) down.add('right');
      if (y < -0.55) down.add('up');
      if (y > 0.55) down.add('down');
    }
    for (const a of down) {
      const h = this.held.get(a);
      // PS: wait to see if it's a tap (home) or a hold (Quick Menu)
      if (a === 'home') {
        if (!h) this.held.set(a, { since: now, fired: false });
        else if (!h.fired && now - h.since >= HOLD_MS) { h.fired = true; this.emit('quickmenu', { source: 'pad' }); }
        continue;
      }
      if (!h) {
        this.held.set(a, { next: now + 380, count: 0 });
        this.emit(a, { source: 'pad' });
      } else if (REPEATABLE.has(a) && now >= h.next) {
        h.count++;
        h.next = now + (h.count > 8 ? 60 : 110);
        this.emit(a, { source: 'pad', repeat: true });
      }
    }
    for (const a of [...this.held.keys()]) {
      if (down.has(a)) continue;
      const h = this.held.get(a);
      if (a === 'home' && !h.fired) this.emit('home', { source: 'pad' });
      this.held.delete(a);
    }
    this.heldNow = down;
  }
}
