// Controller light bar colour over WebHID: DualShock 4 (USB + Bluetooth) and DualSense (USB).

export const LIGHT_COLORS = {
  blue: { label: 'Blue', rgb: [0, 32, 255] },
  red: { label: 'Red', rgb: [255, 0, 0] },
  green: { label: 'Green', rgb: [0, 255, 40] },
  pink: { label: 'Pink', rgb: [255, 20, 147] },
  purple: { label: 'Purple', rgb: [140, 0, 255] },
  cyan: { label: 'Light Blue', rgb: [0, 200, 255] },
  orange: { label: 'Orange', rgb: [255, 90, 0] },
  yellow: { label: 'Yellow', rgb: [255, 200, 0] },
  white: { label: 'White', rgb: [255, 255, 255] },
};
const BRIGHTNESS = { bright: 1, medium: 0.45, dim: 0.15, off: 0 };

const SONY = 0x054c;
const DS4 = new Set([0x05c4, 0x09cc, 0x0ba0]);
const DUALSENSE = new Set([0x0ce6, 0x0df2]);

export function colorOf(settings) {
  const v = settings.lightBar || 'blue';
  if (/^#[0-9a-f]{6}$/i.test(v)) return [1, 3, 5].map(i => parseInt(v.slice(i, i + 2), 16));
  return (LIGHT_COLORS[v] || LIGHT_COLORS.blue).rgb;
}

export function colorCss(settings) {
  const [r, g, b] = colorOf(settings);
  return `rgb(${r},${g},${b})`;
}

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const isController = d => d.vendorId === SONY && (DS4.has(d.productId) || DUALSENSE.has(d.productId));
const hasOutput = (d, id) => d.collections.some(c => (c.outputReports || []).some(r => r.reportId === id));

// The device is closed again right after: an open WebHID connection makes Chromium read every input report
// (250 a second from a DUALSHOCK 4) and pass it to the page, all the time, games included. The colour stays set.
async function send(d, rgb) {
  const wasOpen = d.opened;
  if (!wasOpen) await d.open();
  try { await write(d, rgb); } finally { if (!wasOpen) await d.close().catch(() => {}); }
}

async function write(d, [r, g, b]) {
  if (DS4.has(d.productId)) {
    if (hasOutput(d, 0x11)) {
      // Bluetooth: report 0x11, 77 bytes ending in a CRC32 of 0xA2 0x11 + the payload
      const data = new Uint8Array(77);
      data[0] = 0xc0; data[1] = 0x20; data[2] = 0x07; data[3] = 0x04;
      data[7] = r; data[8] = g; data[9] = b;
      const crc = crc32([0xa2, 0x11, ...data.slice(0, 73)]);
      new DataView(data.buffer).setUint32(73, crc, true);
      await d.sendReport(0x11, data);
    } else {
      // USB: report 0x05 (flags: rumble + light bar), colour at bytes 5-7
      const data = new Uint8Array(31);
      data[0] = 0x07; data[1] = 0x04;
      data[5] = r; data[6] = g; data[7] = b;
      await d.sendReport(0x05, data);
    }
  } else if (DUALSENSE.has(d.productId) && hasOutput(d, 0x02)) {
    // DualSense over USB: report 0x02, "light bar" flag, colour at the end
    const data = new Uint8Array(47);
    data[1] = 0x04;        // valid_flag1: light bar colour
    data[38] = 0x02;       // valid_flag2: light bar setup
    data[41] = 0x02;       // light bar setup: fade in
    data[44] = r; data[45] = g; data[46] = b;
    await d.sendReport(0x02, data);
  }
}

// Sets the colour on every connected Sony controller. Returns how many were updated.
// Calls run one after another: two at once (start-up + a controller connecting) would open and close the same device
// under each other and the colour would silently not be set.
let queue = Promise.resolve();
export function applyLightBar(settings, api, opts) {
  const p = queue.then(() => applyNow(settings, api, opts));
  queue = p.catch(() => {});
  return p;
}
async function applyNow(settings, api, { ask = false } = {}) {
  if (!navigator.hid) return 0;
  let list = (await navigator.hid.getDevices()).filter(isController);
  if (!list.length && ask) {
    await api.requestController();
    list = (await navigator.hid.getDevices()).filter(isController);
  }
  const k = BRIGHTNESS[settings.lightBarBrightness || 'bright'] ?? 1;
  const rgb = colorOf(settings).map(v => Math.round(v * k));
  let n = 0;
  for (const d of list) {
    try { await send(d, rgb); n++; } catch (e) { console.warn('light bar:', e.message); }
  }
  return n;
}

// Name of the first connected Sony controller, for the settings screen
export async function controllerName() {
  if (!navigator.hid) return null;
  const d = (await navigator.hid.getDevices()).find(isController);
  if (!d) return null;
  const kind = DS4.has(d.productId) ? 'DUALSHOCK 4' : 'DualSense';
  return `${kind} · ${hasOutput(d, 0x11) || hasOutput(d, 0x31) ? 'Bluetooth' : 'USB'}`;
}
