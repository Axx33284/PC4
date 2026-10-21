// Controller Test, shared by Console Mode (padtest.js) and Desktop Mode: a health check for the controller in your
// hands, like hardwaretester.com and gamepad-tester.com. Live diagram, stick drift and circularity, trigger range, a
// checklist of every button, vibration, update rate and, for PlayStation pads over WebHID, battery, touchpad and motion.
// Everything is sized in em: the page that mounts it sets the font size (Console Mode in rem, Desktop Mode in px).
import { esc, icon, padFamily } from './util.js';

const PS = ['Cross', 'Circle', 'Square', 'Triangle', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', 'Up', 'Down', 'Left', 'Right', 'PS', 'Touchpad'];
const PS5 = { 8: 'Create' };
const XB = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'Up', 'Down', 'Left', 'Right', 'Guide'];
const FACE = { 0: 'cross', 1: 'circle', 2: 'square', 3: 'triangle' };
const FACE_TEXT = { ps: { 0: '✕', 1: '○', 2: '□', 3: '△' }, xbox: { 0: 'A', 1: 'B', 2: 'X', 3: 'Y' } };
const BUCKETS = 72; // circularity: best reach every 5°
const SONY = 0x054c, DUALSENSE = new Set([0x0ce6, 0x0df2]);

// the diagram: body from the DS4 outline, buttons as separate shapes that light up
const DIAGRAM = `<svg class="ptx-pad" viewBox="0 0 480 330">
  <rect class="ptx-trig" x="62" y="4" width="84" height="26" rx="8"/><rect class="ptx-trig-fill" data-tf="6" x="62" y="4" width="0" height="26" rx="8"/>
  <rect class="ptx-trig" x="334" y="4" width="84" height="26" rx="8"/><rect class="ptx-trig-fill" data-tf="7" x="334" y="4" width="0" height="26" rx="8"/>
  <rect class="ptx-b" data-b="4" x="58" y="38" width="92" height="18" rx="7"/><rect class="ptx-b" data-b="5" x="330" y="38" width="92" height="18" rx="7"/>
  <path class="ptx-body" d="M350 280c40 56 103 15 88-40c-23-82-35-128-42-152A32 32 0 0 0 367 64H113c-15 0-27 10-31 24C69 142 57 189 43 240c-15 55 48 96 88 40c22-19 46-24 109-24s87 5 110 24z"/>
  <rect class="ptx-b ptx-tp" data-b="17" x="170" y="66" width="140" height="70" rx="12"/>
  <g class="ptx-touch"></g>
  <rect class="ptx-b" data-b="8" x="140" y="72" width="14" height="30" rx="7"/><rect class="ptx-b" data-b="9" x="326" y="72" width="14" height="30" rx="7"/>
  <path class="ptx-b" data-b="12" d="M110 112h20v26l-10 10l-10-10z"/><path class="ptx-b" data-b="13" d="M110 184h20v-26l-10-10l-10 10z"/>
  <path class="ptx-b" data-b="14" d="M84 138v20h26l10-10l-10-10z"/><path class="ptx-b" data-b="15" d="M156 138v20h-26l-10-10l10-10z"/>
  <circle class="ptx-b ptx-face" data-b="3" cx="360" cy="116" r="15"/><circle class="ptx-b ptx-face" data-b="0" cx="360" cy="180" r="15"/>
  <circle class="ptx-b ptx-face" data-b="2" cx="328" cy="148" r="15"/><circle class="ptx-b ptx-face" data-b="1" cx="392" cy="148" r="15"/>
  <g class="ptx-glyphs"></g>
  <circle class="ptx-well" cx="176" cy="208" r="34"/><circle class="ptx-b ptx-stick" data-b="10" data-s="0" cx="176" cy="208" r="22"/>
  <circle class="ptx-well" cx="304" cy="208" r="34"/><circle class="ptx-b ptx-stick" data-b="11" data-s="1" cx="304" cy="208" r="22"/>
  <circle class="ptx-b" data-b="16" cx="240" cy="200" r="13"/>
</svg>`;

/**
 * Builds the tester inside `host` and starts reading the controller.
 * opts: settings (deadzones), api (requestController), glyph(kind) -> HTML for a face button (optional),
 *       hint (footer HTML on the right), holdToLeave (hold ○/B or PS 1 s -> onLeave), onLeave, notify({title, body}),
 *       battery() -> { battery, charging, bus } from PC4's controller helper when WebHID has nothing.
 * Returns { destroy }.
 */
export function mountPadTester(host, opts = {}) {
  const settings = opts.settings || {};
  host.innerHTML = `<div class="ptx">
    <div class="ptx-head">
      <div class="ptx-title">${icon('gameController')}<div><h1>Controller Test</h1><div class="ptx-name">Press any button on your controller</div></div></div>
      <div class="ptx-chips"></div>
    </div>
    <div class="ptx-grid">
      <section class="ptx-card ptx-diagram">
        <div class="ptx-ch"><h3>Live Input</h3><span class="ptx-rate"></span></div>
        ${DIAGRAM}
        <div class="ptx-trigs">${[6, 7].map(t => `<div class="ptx-tr"><span data-lbl="${t}"></span><div class="ptx-bar"><i data-bar="${t}"></i><u data-max="${t}"></u></div><b data-val="${t}">0%</b></div>`).join('')}</div>
      </section>
      <section class="ptx-card ptx-sticks">
        <div class="ptx-ch"><h3>Sticks</h3><span class="ptx-sub">Rotate each stick slowly around the edge, then let go</span></div>
        <div class="ptx-sticks-row">${[0, 1].map(i => `<div class="ptx-stick-box">
          <canvas width="320" height="320" data-c="${i}"></canvas>
          <div class="ptx-stick-name">${i ? 'Right' : 'Left'} <span data-xy="${i}">0.00, 0.00</span></div>
          <div class="ptx-meters"><div><span>Drift</span><b data-drift="${i}">—</b></div><div><span>Circularity</span><b data-circ="${i}">—</b></div></div></div>`).join('')}</div>
      </section>
      <section class="ptx-card ptx-buttons">
        <div class="ptx-ch"><h3>Buttons</h3><span class="ptx-progress"><i></i><b>0 / 18</b></span></div>
        <div class="ptx-list"></div>
      </section>
      <section class="ptx-card ptx-health">
        <div class="ptx-ch"><h3>Health Check</h3></div>
        <div class="ptx-report"></div>
      </section>
      <section class="ptx-card ptx-motion">
        <div class="ptx-ch"><h3>Motion</h3><span class="ptx-sub ptx-motion-sub">PlayStation controllers</span></div>
        <div class="ptx-axes"></div>
      </section>
    </div>
    <div class="ptx-foot">
      <button class="ptx-btn" data-ptx="vibrate">${icon('vibrate')}<span>Vibration Test</span><em class="ptx-key">${opts.glyph ? opts.glyph('options') : ''}</em></button>
      <button class="ptx-btn" data-ptx="reset">${icon('refresh')}<span>Reset</span></button>
      <span class="ptx-hint">${opts.hint || ''}</span>
    </div>
  </div>`;
  const root = host.querySelector('.ptx');
  const $ = s => root.querySelector(s);
  const $$ = s => [...root.querySelectorAll(s)];
  const btnEls = Array.from({ length: 18 }, (_, i) => root.querySelector(`[data-b="${i}"]`));

  // ---- measurements ----
  let seen, presses, trigMax, reach, trail, rest;
  const prevPressed = new Array(18).fill(false);
  const reset = () => {
    seen = new Set();
    presses = new Array(18).fill(0);
    trigMax = [0, 0];
    reach = [new Float32Array(BUCKETS), new Float32Array(BUCKETS)];
    trail = [[], []];
    rest = [{ since: 0, x: 0, y: 0, drift: null }, { since: 0, x: 0, y: 0, drift: null }];
  };
  reset();
  let rate = 0, frames = 0, lastTs = 0, rateT = performance.now();
  let holdLeave = 0, vibPrev = false;
  let family = null, padId = '';
  let hid = null, hidOpened = false, alive = true;
  const hidInfo = { battery: null, charging: false, touches: [], gyro: null, accel: null, bus: null };

  const names = () => (family === 'xbox' ? XB : PS.map((n, i) => (family === 'ps5' && PS5[i]) || n));
  const total = () => (family === 'xbox' ? 17 : 18);
  const faceGlyph = b => (opts.glyph ? `<div class="ptx-gl pads-${family || 'ps4'}">${opts.glyph(FACE[b])}</div>`
    : `<div class="ptx-gl ptx-gl-text f${b}">${FACE_TEXT[family === 'xbox' ? 'xbox' : 'ps'][b]}</div>`);

  const renderList = () => {
    const list = names();
    $('.ptx-list').innerHTML = list.map((n, i) => `<span class="ptx-chip ${seen.has(i) ? 'ok' : ''}">${seen.has(i) ? icon('check') : '<i></i>'}${esc(n)}${presses[i] ? `<small>${presses[i]}</small>` : ''}</span>`).join('');
    $$('[data-lbl]').forEach(e => { e.textContent = list[Number(e.dataset.lbl)]; });
    $('.ptx-glyphs').innerHTML = [0, 1, 2, 3].map(b => {
      const c = $(`[data-b="${b}"]`);
      return `<foreignObject x="${c.getAttribute('cx') - 12}" y="${c.getAttribute('cy') - 12}" width="24" height="24">${faceGlyph(b)}</foreignObject>`;
    }).join('');
    const n = Math.min(seen.size, total());
    $('.ptx-progress b').textContent = `${n} / ${total()}`;
    $('.ptx-progress i').style.setProperty('--p', `${(n / total()) * 100}%`);
    $('.ptx-progress').classList.toggle('done', n >= total());
  };

  // how far off a circle the stick reaches, averaged over the directions tried (like hardwaretester.com)
  const circularity = i => {
    const r = [...reach[i]].filter(v => v > 0.5);
    if (r.length < BUCKETS * 0.75) return null;
    return (r.reduce((a, v) => a + Math.abs(Math.min(v, 1.25) - 1), 0) / r.length) * 100;
  };
  const verdict = (v, good, ok) => (v == null ? '' : v < good ? 'good' : v < ok ? 'fair' : 'bad');

  const drawStick = (i, x, y) => {
    const c = $(`[data-c="${i}"]`);
    const g = c.getContext('2d');
    const W = c.width, R = W * 0.42, cx = W / 2, cy = W / 2;
    g.clearRect(0, 0, W, W);
    g.fillStyle = 'rgba(255,255,255,.035)'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 2;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.1)';
    g.beginPath(); g.arc(cx, cy, R / 2, 0, Math.PI * 2); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
    // deadzone PC4 uses for Xbox emulation
    const dz = i ? settings.emuDeadzoneR : settings.emuDeadzoneL;
    if (dz) { g.fillStyle = 'rgba(255,190,90,.12)'; g.beginPath(); g.arc(cx, cy, R * dz, 0, Math.PI * 2); g.fill(); }
    // the reach recorded so far
    g.strokeStyle = 'rgba(90,180,255,.95)'; g.lineWidth = 3; g.beginPath();
    let started = false;
    for (let k = 0; k <= BUCKETS; k++) {
      const v = reach[i][k % BUCKETS];
      if (!v) { started = false; continue; }
      const a = (k / BUCKETS) * Math.PI * 2;
      const px = cx + Math.cos(a) * v * R, py = cy + Math.sin(a) * v * R;
      if (!started) { g.moveTo(px, py); started = true; } else g.lineTo(px, py);
    }
    g.stroke();
    // trail fading out, then the stick itself
    trail[i].forEach(([tx, ty], k) => { g.fillStyle = `rgba(255,255,255,${(k / trail[i].length) * 0.4})`; g.fillRect(cx + tx * R - 1.5, cy + ty * R - 1.5, 3, 3); });
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + x * R, cy + y * R); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(cx + x * R, cy + y * R, 10, 0, Math.PI * 2); g.fill();
  };

  const battery = () => {
    if (hidInfo.battery != null) return { battery: hidInfo.battery, charging: hidInfo.charging, bus: hidInfo.bus };
    const b = opts.battery && opts.battery();
    return b && b.battery >= 0 ? b : null;
  };

  const report = () => {
    const rows = [];
    for (const i of [0, 1]) {
      const d = rest[i].drift, c = circularity(i);
      rows.push([`${i ? 'Right' : 'Left'} stick drift`, d == null ? '—' : `${(d * 100).toFixed(1)}%`, verdict(d, 0.05, 0.1), d == null ? 'Leave the sticks alone for a moment' : d < 0.05 ? 'Centres well' : d < 0.1 ? 'Slight drift: a small deadzone hides it' : `Drifting: set the deadzone to at least ${Math.ceil(d * 50) * 2}%`]);
      rows.push([`${i ? 'Right' : 'Left'} stick circularity`, c == null ? '—' : `${c.toFixed(1)}% error`, verdict(c, 8, 14), c == null ? 'Rotate the stick slowly around the edge' : c < 8 ? 'Round and even' : c < 14 ? 'A bit uneven' : 'Uneven reach: worn or dirty stick']);
    }
    for (const t of [0, 1]) rows.push([`${names()[6 + t]} range`, `${Math.round(trigMax[t] * 100)}%`, trigMax[t] > 0.97 ? 'good' : trigMax[t] > 0.02 ? 'fair' : '', trigMax[t] > 0.97 ? 'Reaches the end' : 'Press it all the way']);
    rows.push(['Buttons tested', `${Math.min(seen.size, total())} of ${total()}`, seen.size >= total() ? 'good' : '', seen.size >= total() ? 'Every button works' : 'Press every button once']);
    const b = battery();
    if (b) rows.push(['Battery', `${b.battery}%${b.charging ? ' · charging' : ''}`, b.battery > 30 ? 'good' : b.battery > 10 ? 'fair' : 'bad', b.bus || '']);
    if (rate) rows.push(['Update rate', `${rate}/s`, rate >= 120 ? 'good' : rate >= 50 ? 'fair' : 'bad', rate >= 120 ? 'Wired-quality polling' : 'Wireless or a slow USB port']);
    $('.ptx-report').innerHTML = rows.map(([k, v, cls, note]) => `<div class="ptx-row ${cls}"><i></i><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span><span class="n">${esc(note)}</span></div>`).join('');
  };

  const chips = () => {
    const out = [];
    const b = battery();
    if (padId) out.push(`<span class="ptx-pill">${icon(family === 'xbox' ? 'xbox' : family === 'ps5' ? 'ps5' : 'ps4')}${family === 'xbox' ? 'Xbox' : family === 'ps5' ? 'DualSense' : 'DUALSHOCK 4'}</span>`);
    if (b && b.bus) out.push(`<span class="ptx-pill">${b.bus}</span>`);
    if (b) out.push(`<span class="ptx-pill ptx-batt ${b.battery <= 15 ? 'low' : ''}">${icon(b.charging ? 'batteryCharge' : b.battery < 25 ? 'batteryLow' : 'battery')}<span class="ptx-cells"><i style="width:${b.battery}%"></i></span>${b.battery}%</span>`);
    if (!padId) out.push('<span class="ptx-pill off">No controller</span>');
    $('.ptx-chips').innerHTML = out.join('');
  };

  const motion = () => {
    if (!hidInfo.gyro) { $('.ptx-axes').innerHTML = `<div class="ptx-empty">${family === 'xbox' ? 'Xbox controllers don\'t report motion.' : 'Move the controller: gyro and accelerometer show up here.'}</div>`; return; }
    const bar = (l, v, max) => `<div class="ptx-axis"><span>${l}</span><div class="ptx-mid"><i style="${v >= 0 ? 'left:50%' : `right:50%`};width:${Math.min(50, (Math.abs(v) / max) * 50)}%"></i></div><b>${(v / 1000).toFixed(1)}</b></div>`;
    $('.ptx-axes').innerHTML = `<div class="ptx-ax-h">Gyro</div>${['Pitch', 'Yaw', 'Roll'].map((l, k) => bar(l, hidInfo.gyro[k], 8000)).join('')}
      <div class="ptx-ax-h">Accelerometer</div>${['X', 'Y', 'Z'].map((l, k) => bar(l, hidInfo.accel[k], 10000)).join('')}`;
    $('.ptx-motion-sub').textContent = hidInfo.touches.length ? `${hidInfo.touches.length} finger${hidInfo.touches.length > 1 ? 's' : ''} on the touchpad` : 'Touch the touchpad to see your fingers';
  };

  // ---- PlayStation extras over WebHID: battery, touchpad, motion ----
  const s16 = (d, i) => d.getInt16(i, true);
  const onHid = e => {
    const d = e.data, ds = DUALSENSE.has(e.device.productId);
    let o; // offset of the left stick X byte in e.data (the report id is not in it)
    if (!ds) o = e.reportId === 0x11 ? 2 : e.reportId === 0x01 && d.byteLength >= 63 ? 0 : -1;
    else o = e.reportId === 0x31 ? 1 : e.reportId === 0x01 && d.byteLength >= 63 ? 0 : -1;
    if (o < 0) return;
    try {
      if (!ds) {
        hidInfo.gyro = [s16(d, o + 12), s16(d, o + 14), s16(d, o + 16)];
        hidInfo.accel = [s16(d, o + 18), s16(d, o + 20), s16(d, o + 22)];
        const b = d.getUint8(o + 29), cable = !!(b & 0x10), lvl = b & 0x0f;
        hidInfo.battery = Math.min(100, lvl * (cable ? 9 : 10) + 5); hidInfo.charging = cable && lvl < 11;
        hidInfo.touches = [o + 34, o + 38].map(p => { const f = d.getUint8(p); return f & 0x80 ? null : { x: d.getUint8(p + 1) | ((d.getUint8(p + 2) & 0x0f) << 8), y: (d.getUint8(p + 2) >> 4) | (d.getUint8(p + 3) << 4), w: 1920, h: 942 }; }).filter(Boolean);
      } else {
        hidInfo.gyro = [s16(d, o + 15), s16(d, o + 17), s16(d, o + 19)];
        hidInfo.accel = [s16(d, o + 21), s16(d, o + 23), s16(d, o + 25)];
        const b = d.getUint8(o + 52);
        hidInfo.battery = Math.min(100, (b & 0x0f) * 10 + 5); hidInfo.charging = (b & 0xf0) === 0x10;
        hidInfo.touches = [o + 32, o + 36].map(p => { const f = d.getUint8(p); return f & 0x80 ? null : { x: d.getUint8(p + 1) | ((d.getUint8(p + 2) & 0x0f) << 8), y: (d.getUint8(p + 2) >> 4) | (d.getUint8(p + 3) << 4), w: 1920, h: 1080 }; }).filter(Boolean);
      }
      hidInfo.bus = e.reportId === 0x01 ? 'USB' : 'Bluetooth';
    } catch {}
  };
  (async () => {
    if (!navigator.hid) return;
    try {
      let list = (await navigator.hid.getDevices()).filter(d => d.vendorId === SONY);
      if (!list.length && opts.api) { await opts.api.requestController(); list = (await navigator.hid.getDevices()).filter(d => d.vendorId === SONY); }
      const d = list.find(x => x.collections.some(c => c.usagePage === 1 && (c.usage === 5 || c.usage === 4)));
      if (!d || !alive) return;
      if (!d.opened) { await d.open(); hidOpened = true; }
      if (!alive) { if (hidOpened) d.close().catch(() => {}); return; }
      d.addEventListener('inputreport', onHid);
      hid = d;
    } catch { /* PC4's Xbox emulation may hold the controller exclusively */ }
  })();

  const vibrate = p => {
    const act = p && p.vibrationActuator;
    if (!act || !act.playEffect) { if (opts.notify) opts.notify({ title: 'No vibration', body: p ? 'This controller does not report vibration motors to PC4' : 'Connect a controller first' }); return; }
    // strong motor, then the weak one, then both: a dead motor stands out
    act.playEffect('dual-rumble', { startDelay: 0, duration: 450, strongMagnitude: 1, weakMagnitude: 0 })
      .then(() => act.playEffect('dual-rumble', { startDelay: 150, duration: 450, strongMagnitude: 0, weakMagnitude: 1 }))
      .then(() => act.playEffect('dual-rumble', { startDelay: 150, duration: 450, strongMagnitude: 1, weakMagnitude: 1 }))
      .catch(() => {});
    if (opts.notify) opts.notify({ title: 'Vibration test', body: 'Strong motor, weak motor, then both' });
  };
  const currentPad = () => { const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : []; return pads.find(x => /054c/i.test(x.id)) || pads[0]; };
  root.querySelector('.ptx-foot').addEventListener('click', e => {
    const b = e.target.closest('[data-ptx]');
    if (!b) return;
    if (b.dataset.ptx === 'vibrate') vibrate(currentPad());
    else { reset(); renderList(); report(); }
  });

  // ---- the live loop ----
  let raf = 0, tick = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const p = currentPad();
    if (tick % 30 === 0) chips();
    if (!p) { if (padId) { padId = ''; $('.ptx-name').textContent = 'Connect a controller and press any button'; } tick++; return; }
    if (p.id !== padId) {
      padId = p.id;
      family = padFamily(p.id);
      $('.ptx-name').textContent = p.id.replace(/\(.*?\)/g, '').trim() || 'Controller';
      root.dataset.family = family;
      renderList();
      chips();
    }
    const now = performance.now();
    if (p.timestamp !== lastTs) { frames++; lastTs = p.timestamp; }
    if (now - rateT >= 1000) { rate = Math.round((frames * 1000) / (now - rateT)); frames = 0; rateT = now; }
    // buttons
    let listDirty = false;
    p.buttons.forEach((b, i) => {
      if (i > 17) return;
      const on = b.pressed || b.value > 0.5;
      if (on && !prevPressed[i]) { presses[i]++; seen.add(i); listDirty = true; }
      prevPressed[i] = on;
      const n = btnEls[i];
      if (n && n._on !== on) { n._on = on; n.classList.toggle('on', on); }
    });
    for (const t of [0, 1]) {
      const v = p.buttons[6 + t] ? p.buttons[6 + t].value : 0;
      trigMax[t] = Math.max(trigMax[t], v);
      $(`[data-tf="${6 + t}"]`).setAttribute('width', (84 * v).toFixed(1));
      $(`[data-bar="${6 + t}"]`).style.width = `${v * 100}%`;
      $(`[data-max="${6 + t}"]`).style.left = `${trigMax[t] * 100}%`;
      $(`[data-val="${6 + t}"]`).textContent = `${Math.round(v * 100)}%`;
    }
    if (listDirty) renderList();
    // sticks
    for (const i of [0, 1]) {
      const x = p.axes[i * 2] || 0, y = p.axes[i * 2 + 1] || 0;
      const mag = Math.hypot(x, y);
      if (mag > 0.5) { const k = Math.round(((Math.atan2(y, x) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * BUCKETS) % BUCKETS; reach[i][k] = Math.max(reach[i][k], mag); }
      const tr = trail[i]; tr.push([x, y]); if (tr.length > 60) tr.shift();
      // at rest = barely moving for 1.5 s: that offset is the drift
      const r = rest[i];
      if (Math.hypot(x - r.x, y - r.y) > 0.03 || mag > 0.35) { r.since = now; r.x = x; r.y = y; }
      else if (now - r.since > 1500) r.drift = r.drift == null ? mag : Math.min(r.drift * 0.9 + mag * 0.1, Math.max(r.drift, mag));
      const stick = $(`[data-s="${i}"]`);
      stick.setAttribute('cx', (i ? 304 : 176) + x * 14); stick.setAttribute('cy', 208 + y * 14);
      drawStick(i, x, y);
      if (tick % 6 === 0) {
        $(`[data-xy="${i}"]`).textContent = `${x.toFixed(2)}, ${(-y).toFixed(2)}`;
        const c = circularity(i), d = r.drift;
        const de = $(`[data-drift="${i}"]`); de.textContent = d == null ? 'Measuring…' : `${(d * 100).toFixed(1)}%`; de.className = verdict(d, 0.05, 0.1);
        const ce = $(`[data-circ="${i}"]`); ce.textContent = c == null ? 'Rotate it' : `${c.toFixed(1)}%`; ce.className = verdict(c, 8, 14);
      }
    }
    // touchpad fingers
    if (tick % 3 === 0) $('.ptx-touch').innerHTML = hidInfo.touches.map(t => `<circle cx="${170 + (t.x / t.w) * 140}" cy="${66 + (t.y / t.h) * 70}" r="7" class="ptx-finger"/>`).join('');
    if (tick % 6 === 0) motion();
    if (tick % 15 === 0) { report(); $('.ptx-rate').textContent = rate ? `${rate} updates/s` : ''; }
    tick++;
    // vibration test on OPTIONS / Menu; hold ○ / B (1 s) or the PS button to leave
    const vib = !!(p.buttons[9] && p.buttons[9].pressed);
    if (vib && !vibPrev) vibrate(p);
    vibPrev = vib;
    if (opts.holdToLeave) {
      const leaving = (p.buttons[1] && p.buttons[1].pressed) || (p.buttons[16] && p.buttons[16].pressed);
      if (leaving) { if (!holdLeave) holdLeave = now; else if (now - holdLeave > 1000 && opts.onLeave) { holdLeave = 0; opts.onLeave(); } }
      else holdLeave = 0;
      root.classList.toggle('leaving', !!holdLeave);
    }
  };

  renderList();
  report();
  chips();
  motion();
  raf = requestAnimationFrame(loop);

  return {
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      if (hid) try { hid.removeEventListener('inputreport', onHid); } catch {}
      // left open, Chromium would keep reading all its reports (250 a second) for the rest of the session, games included
      if (hid && hidOpened) hid.close().catch(() => {});
      hid = null;
    },
  };
}
