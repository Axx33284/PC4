// Runs inside the YouTube TV page: reads the controller and tells PC4 which button was pressed.
// PC4 turns that into the remote-control keys the TV app understands (see youtube.js).
const { ipcRenderer } = require('electron');

// standard gamepad layout: 0 ✕/A, 1 ○/B, 2 □/X, 3 △/Y, 4 L1, 5 R1, 6 L2, 7 R2, 8 SHARE/View, 12-15 d-pad, 16 PS/Guide
const BUTTONS = {
  0: 'accept', 1: 'back', 2: 'playpause', 3: 'search', 4: 'prev', 5: 'next', 6: 'rewind', 7: 'forward',
  8: 'home', 16: 'home', 12: 'up', 13: 'down', 14: 'left', 15: 'right',
};
const REPEAT = new Set(['up', 'down', 'left', 'right', 'rewind', 'forward']);
const held = new Map();
let quietUntil = performance.now() + 700; // ignore the button that opened YouTube

function poll() {
  requestAnimationFrame(poll);
  const now = performance.now();
  if (!document.hasFocus() || now < quietUntil) { held.clear(); return; }
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  if (!pads.length) return;
  const down = new Set();
  for (const p of pads) {
    p.buttons.forEach((b, i) => { if (b.pressed && BUTTONS[i]) down.add(BUTTONS[i]); });
    const [x = 0, y = 0] = p.axes;
    if (x < -0.55) down.add('left');
    if (x > 0.55) down.add('right');
    if (y < -0.55) down.add('up');
    if (y > 0.55) down.add('down');
  }
  for (const a of down) {
    const h = held.get(a);
    if (!h) {
      held.set(a, { next: now + 400, count: 0 });
      ipcRenderer.send('youtube:pad', a);
    } else if (REPEAT.has(a) && now >= h.next) {
      h.count++;
      h.next = now + (a === 'rewind' || a === 'forward' ? 450 : h.count > 8 ? 70 : 130);
      ipcRenderer.send('youtube:pad', a);
    }
  }
  for (const a of [...held.keys()]) if (!down.has(a)) held.delete(a);
}
requestAnimationFrame(poll);
