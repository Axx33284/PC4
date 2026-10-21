// Artwork + game info from the Steam store (no key needed) and SteamGridDB (optional key).
const fs = require('fs');
const path = require('path');

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PC4/1.0' };
const STEAM_CDN = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps';

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ---------- Steam ----------
async function searchSteam(term) {
  if (!term.trim()) return [];
  const j = await getJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=US`);
  return (j.items || []).filter(i => i.type === 'app').map(i => ({
    appId: i.id,
    name: i.name,
    thumb: i.tiny_image,
    cover: `${STEAM_CDN}/${i.id}/library_600x900.jpg`,
    hero: `${STEAM_CDN}/${i.id}/library_hero.jpg`,
    logo: `${STEAM_CDN}/${i.id}/logo.png`,
    background: `${STEAM_CDN}/${i.id}/library_hero_2x.jpg`,
  }));
}

async function bestSteamMatch(name) {
  const results = await searchSteam(name);
  if (!results.length) return null;
  const n = normalize(name);
  return results.find(r => normalize(r.name) === n)
    || results.find(r => normalize(r.name).startsWith(n) || n.startsWith(normalize(r.name)))
    || null;
}

async function steamDetails(appId) {
  let info = {};
  try {
    const j = await getJson(`https://store.steampowered.com/api/appdetails?appids=${appId}&l=english`);
    const d = j[appId] && j[appId].success ? j[appId].data : null;
    if (d) {
      info = {
        name: d.name,
        description: stripHtml(d.short_description || ''),
        developers: d.developers || [],
        publishers: d.publishers || [],
        genres: (d.genres || []).map(g => g.description),
        releaseDate: d.release_date ? d.release_date.date : '',
        header: d.header_image,
        screenshot: d.screenshots && d.screenshots[0] ? d.screenshots[0].path_full : null,
        screenshots: (d.screenshots || []).map(x => x.path_full),
        website: d.website || '',
      };
    }
  } catch {}
  let assets = null;
  try {
    const input = { ids: [{ appid: Number(appId) }], context: { language: 'english', country_code: 'US' }, data_request: { include_assets: true } };
    const j = await getJson(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1?input_json=${encodeURIComponent(JSON.stringify(input))}`);
    const item = j.response && j.response.store_items && j.response.store_items[0];
    assets = item && item.assets;
    info.controllers = controllersOf(item);
  } catch {}
  const fmt = file => assets && assets.asset_url_format
    ? `https://shared.akamai.steamstatic.com/store_item_assets/${assets.asset_url_format.replace('${FILENAME}', file)}`
    : `${STEAM_CDN}/${appId}/${file}`;
  const urls = {
    cover: [fmt((assets && assets.library_capsule_2x) || 'library_600x900_2x.jpg'), fmt((assets && assets.library_capsule) || 'library_600x900.jpg')],
    hero: [fmt((assets && assets.library_hero) || 'library_hero.jpg'), info.screenshot, info.header].filter(Boolean),
    // full-screen wallpaper: the 2x key art (3840 wide) is sharp at 1080p/4K; a 1080p screenshot is the fallback
    background: [fmt((assets && assets.library_hero_2x) || 'library_hero_2x.jpg'), info.screenshot].filter(Boolean),
    logo: [`${STEAM_CDN}/${appId}/logo.png`, `${STEAM_CDN}/${appId}/logo_2x.png`],
    icon: assets && assets.community_icon
      ? [`https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${appId}/${assets.community_icon}.jpg`]
      : [],
  };
  return { info, urls };
}

function stripHtml(s) {
  return s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();
}

// ---------- SteamGridDB ----------
async function sgdb(pathname, key) {
  const j = await getJson(`https://www.steamgriddb.com/api/v2/${pathname}`, { Authorization: `Bearer ${key}` });
  if (!j.success) throw new Error('SteamGridDB request failed');
  return j.data;
}

async function sgdbSearch(term, key) {
  const data = await sgdb(`search/autocomplete/${encodeURIComponent(term)}`, key);
  return data.map(d => ({ id: d.id, name: d.name, year: d.release_date ? new Date(d.release_date * 1000).getFullYear() : '' }));
}

const SGDB_KIND = {
  cover: 'grids/game/{id}?dimensions=600x900,342x482,660x930',
  tile: 'grids/game/{id}?dimensions=512x512,1024x1024',
  hero: 'heroes/game/{id}',
  background: 'heroes/game/{id}?dimensions=3840x1240,1920x620',
  logo: 'logos/game/{id}',
  icon: 'icons/game/{id}',
};

async function sgdbImages(gameId, kind, key, page = 0) {
  const q = SGDB_KIND[kind].replace('{id}', gameId);
  const data = await sgdb(`${q}${q.includes('?') ? '&' : '?'}page=${page}`, key);
  return data.map(d => ({ url: d.url, thumb: d.thumb, width: d.width, height: d.height }));
}

// ---------- downloading ----------
async function download(url, destNoExt, referer = null) {
  const res = await fetch(url, { headers: referer ? { ...UA, Referer: referer } : UA, signal: AbortSignal.timeout(30000) });
  if (!res.ok) return null;
  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('image/')) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 200) return null;
  const ext = type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : type.includes('icon') ? '.ico' : '.jpg';
  const file = destNoExt + ext;
  fs.writeFileSync(file, buf);
  return file;
}

async function downloadFirst(urls, destNoExt) {
  for (const u of urls) {
    try {
      const f = await download(u, destNoExt);
      if (f) return f;
    } catch {}
  }
  return null;
}

// Every official image Steam has for a game, tagged with the kinds it suits.
async function steamArtwork(appId) {
  const input = { ids: [{ appid: Number(appId) }], context: { language: 'english', country_code: 'US' }, data_request: { include_assets: true, include_screenshots: true } };
  let assets = null;
  let shots = [];
  try {
    const j = await getJson(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1?input_json=${encodeURIComponent(JSON.stringify(input))}`);
    const item = j.response && j.response.store_items && j.response.store_items[0];
    assets = item && item.assets;
  } catch {}
  try { shots = await steamScreenshots(appId); } catch {}
  const base = 'https://shared.akamai.steamstatic.com/store_item_assets/';
  const fmt = file => (assets && assets.asset_url_format ? base + assets.asset_url_format.replace('${FILENAME}', file) : `${STEAM_CDN}/${appId}/${file}`);
  const a = assets || {};
  const out = [
    { url: fmt(a.library_hero_2x || 'library_hero_2x.jpg'), thumb: fmt(a.library_hero || 'library_hero.jpg'), title: 'Key art (4K)', kinds: ['background', 'hero'] },
    { url: fmt(a.library_hero || 'library_hero.jpg'), title: 'Key art', kinds: ['hero', 'background'] },
    a.raw_page_background && { url: fmt(a.raw_page_background), title: 'Store background', kinds: ['background', 'hero'] },
    a.page_background && { url: fmt(a.page_background), title: 'Store background (blurred)', kinds: ['background'] },
    { url: fmt(a.library_capsule_2x || 'library_600x900_2x.jpg'), thumb: fmt(a.library_capsule || 'library_600x900.jpg'), title: 'Cover (large)', kinds: ['cover'] },
    { url: fmt(a.library_capsule || 'library_600x900.jpg'), title: 'Cover', kinds: ['cover'] },
    { url: fmt(a.header_2x || a.header || 'header.jpg'), thumb: fmt(a.header || 'header.jpg'), title: 'Header', kinds: ['hero', 'tile', 'background'] },
    a.main_capsule && { url: fmt(a.main_capsule_2x || a.main_capsule), thumb: fmt(a.main_capsule), title: 'Store capsule', kinds: ['hero', 'tile', 'background'] },
    a.hero_capsule && { url: fmt(a.hero_capsule_2x || a.hero_capsule), thumb: fmt(a.hero_capsule), title: 'Hero capsule', kinds: ['cover', 'tile'] },
    { url: `${STEAM_CDN}/${appId}/logo_2x.png`, thumb: `${STEAM_CDN}/${appId}/logo.png`, title: 'Logo (large)', kinds: ['logo'] },
    { url: `${STEAM_CDN}/${appId}/logo.png`, title: 'Logo', kinds: ['logo'] },
    a.community_icon && { url: `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${appId}/${a.community_icon}.jpg`, title: 'Icon', kinds: ['icon'] },
    ...shots.map((x, i) => ({ url: x.url, thumb: x.thumb, title: `Screenshot ${i + 1}`, kinds: ['background', 'hero', 'tile'] })),
  ];
  return out.filter(Boolean);
}

// Steam controller categories: 28 full / 18 partial (Xbox-style) support, 55 DualShock, 57/58 DualSense
function controllersOf(item) {
  const ids = (item && item.categories && item.categories.controller_categoryids) || [];
  return {
    xbox: ids.includes(28) ? 'full' : ids.includes(18) ? 'partial' : null,
    dualshock: ids.includes(55),
    dualsense: ids.includes(57) || ids.includes(58),
    checked: true,
  };
}

// controller info for many Steam games in one request
async function steamControllers(appIds) {
  const out = {};
  for (let i = 0; i < appIds.length; i += 50) {
    const input = { ids: appIds.slice(i, i + 50).map(appid => ({ appid: Number(appid) })), context: { language: 'english', country_code: 'US' }, data_request: {} };
    const j = await getJson(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1?input_json=${encodeURIComponent(JSON.stringify(input))}`);
    for (const item of (j.response && j.response.store_items) || []) out[item.appid || item.id] = controllersOf(item);
  }
  return out;
}

async function steamScreenshots(appId) {
  const j = await getJson(`https://store.steampowered.com/api/appdetails?appids=${appId}&l=english&filters=screenshots`);
  const d = j[appId] && j[appId].success ? j[appId].data : null;
  return d && d.screenshots ? d.screenshots.map(x => ({ url: x.path_full, thumb: x.path_thumbnail })) : [];
}

module.exports = { steamControllers, steamArtwork, steamScreenshots, searchSteam, bestSteamMatch, steamDetails, sgdbSearch, sgdbImages, download, downloadFirst, normalize };
