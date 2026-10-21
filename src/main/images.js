// Small copies of big artwork for tiles and grids, so the UI never decodes 4K images just to draw a tile.
const fs = require('fs');
const path = require('path');
const { nativeImage } = require('electron');

const THUMB_WIDTH = { cover: 360, hero: 760, tile: 512, background: 760 };

const IMAGE_KINDS = ['cover', 'hero', 'background', 'logo', 'icon', 'tile'];
const THUMBS_VERSION = 3;

// Creates (or replaces) media[kind + 'Thumb'] and records the image's real size in media.sizes[kind],
// so covers can be shown in their own shape. Returns the updated media object.
function makeThumb(dir, media, kind) {
  const width = THUMB_WIDTH[kind];
  const key = kind + 'Thumb';
  media.sizes = { ...(media.sizes || {}) };
  delete media.sizes[kind];
  if (media[key]) { try { fs.unlinkSync(path.join(dir, media[key])); } catch {} delete media[key]; }
  if (!media[kind]) return media;
  const img = nativeImage.createFromPath(path.join(dir, media[kind]));
  if (img.isEmpty()) return media; // e.g. webp: the UI measures it when it loads
  const size = img.getSize();
  media.sizes[kind] = [size.width, size.height];
  if (!width || size.width <= width * 1.15) return media; // already small
  const small = img.resize({ width, quality: 'good' });
  const png = /\.png$/i.test(media[kind]);
  const file = `${key}-${Date.now()}.${png ? 'png' : 'jpg'}`;
  fs.writeFileSync(path.join(dir, file), png ? small.toPNG() : small.toJPEG(86));
  media[key] = file;
  return media;
}

// The game's main colour: the most vivid, common hue in its wallpaper (or banner).
// Used to tint the console UI while that game's details are open.
function accentColor(dir, media) {
  const file = media.background || media.hero || media.cover;
  if (!file) return null;
  let img = nativeImage.createFromPath(path.join(dir, file));
  if (img.isEmpty()) return null;
  img = img.resize({ width: 64, quality: 'good' });
  const { width, height } = img.getSize();
  const px = img.toBitmap(); // BGRA
  const bins = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  let all = [0, 0, 0, 0];
  for (let i = 0; i < width * height * 4; i += 4) {
    const b = px[i] / 255, g = px[i + 1] / 255, r = px[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    all[0] += r; all[1] += g; all[2] += b; all[3]++;
    if (d < 0.08 || l < 0.1 || l > 0.92) continue;
    const sat = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    const w = sat * sat * (1 - Math.abs(l - 0.5));
    const bin = bins[Math.floor(h / 15) % 24];
    bin.w += w; bin.r += r * w; bin.g += g * w; bin.b += b * w;
  }
  const best = bins.reduce((a, c) => (c.w > a.w ? c : a));
  const rgb = best.w > 0.5 ? [best.r / best.w, best.g / best.w, best.b / best.w] : [all[0] / all[3], all[1] / all[3], all[2] / all[3]];
  return rgb.map(v => Math.round(v * 255));
}

// Brings every thumbnail and size of a game up to date (for games added before these existed).
function makeAllThumbs(dir, media) {
  for (const k of IMAGE_KINDS) makeThumb(dir, media, k);
  try { media.accent = accentColor(dir, media); } catch { media.accent = null; }
  media.thumbsV = THUMBS_VERSION;
  return media;
}

module.exports = { makeThumb, makeAllThumbs, accentColor, THUMB_WIDTH, THUMBS_VERSION };
