// What's New: news from the whole games industry (RSS feeds of the big gaming sites) and what's trending
// right now (Steam's live most-played chart, top sellers, new releases and deals). No keys needed.
// Everything is cached in pc4-data/industry.json so What's New opens instantly, even offline.
const fs = require('fs');
const { EventEmitter } = require('events');

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PC4/1.0' };
const REFRESH_MS = 30 * 60 * 1000;
const MAX_AGE = 10 * 24 * 3600 * 1000;
const PER_SOURCE = 12;

const SOURCES = [
  { id: 'ign', name: 'IGN', url: 'https://www.ign.com/rss/articles/feed?tags=news' },
  { id: 'gamespot', name: 'GameSpot', url: 'https://www.gamespot.com/feeds/news/' },
  { id: 'pcgamer', name: 'PC Gamer', url: 'https://www.pcgamer.com/rss/' },
  { id: 'eurogamer', name: 'Eurogamer', url: 'https://www.eurogamer.net/feed' },
  { id: 'polygon', name: 'Polygon', url: 'https://www.polygon.com/rss/index.xml' },
  { id: 'kotaku', name: 'Kotaku', url: 'https://kotaku.com/rss' },
  { id: 'rps', name: 'Rock Paper Shotgun', url: 'https://www.rockpapershotgun.com/feed' },
  { id: 'vgc', name: 'VGC', url: 'https://www.videogameschronicle.com/feed/' },
  { id: 'verge', name: 'The Verge', url: 'https://www.theverge.com/rss/games/index.xml' },
  { id: 'psblog', name: 'PlayStation Blog', url: 'https://blog.playstation.com/feed/' },
  { id: 'xbox', name: 'Xbox Wire', url: 'https://news.xbox.com/en-us/feed/' },
  { id: 'pushsquare', name: 'Push Square', url: 'https://www.pushsquare.com/feeds/latest' },
  { id: 'gematsu', name: 'Gematsu', url: 'https://www.gematsu.com/feed' },
];

// ---------------- tiny RSS / Atom reader ----------------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
const decode = s => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
const unCdata = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i')); return m ? unCdata(m[1]).trim() : ''; };
const attr = (xml, name, a) => { const m = xml.match(new RegExp(`<${name}\\s[^>]*?${a}=["']([^"']+)["']`, 'i')); return m ? decode(m[1]) : ''; };

function toText(html) {
  return decode(html
    .replace(/<(script|style|figure|figcaption|iframe)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d|li)>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

function pickImage(item) {
  // the biggest media:content, then thumbnails / enclosures, then the first picture in the story
  let best = '', bestW = -1;
  for (const m of item.matchAll(/<media:content\s[^>]*>/gi)) {
    const url = (m[0].match(/url=["']([^"']+)["']/i) || [])[1];
    const medium = (m[0].match(/medium=["'](\w+)/i) || [])[1];
    const type = (m[0].match(/type=["']([^"']+)/i) || [])[1] || '';
    if (!url || (medium && medium !== 'image') || (type && !type.startsWith('image'))) continue;
    const w = Number((m[0].match(/width=["'](\d+)/i) || [])[1] || 0);
    if (w > bestW) { best = decode(url); bestW = w; }
  }
  const enc = item.match(/<enclosure\s[^>]*url=["']([^"']+)["'][^>]*type=["']image/i) || item.match(/<enclosure\s[^>]*type=["']image[^>]*url=["']([^"']+)["']/i);
  const img = unCdata(item).match(/<img[^>]+src=["']([^"']+)["']/i);
  const url = best || attr(item, 'media:thumbnail', 'url') || (enc && decode(enc[1])) || (img && decode(img[1])) || '';
  return /^https?:\/\//.test(url) ? url : null;
}

function parseFeed(xml, src) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.map(b => {
    const link = tag(b, 'link') || attr(b, 'link', 'href');
    const date = Date.parse(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date')) || 0;
    const summary = toText(tag(b, 'description') || tag(b, 'summary') || '').slice(0, 600);
    return {
      id: `${src.id}:${link}`,
      source: src.id,
      sourceName: src.name,
      title: toText(tag(b, 'title')),
      url: decode(link),
      date,
      image: pickImage(b),
      summary,
    };
  }).filter(n => n.title && /^https?:\/\//.test(n.url) && n.date);
}

async function get(url, type = 'text') {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return type === 'json' ? res.json() : res.text();
}

// ---------------- trends (Steam) ----------------
const header = id => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`;

async function steamTrends(names) {
  const out = { mostPlayed: [], topSellers: [], newReleases: [], deals: [] };
  const [charts, cats] = await Promise.all([
    get('https://api.steampowered.com/ISteamChartsService/GetMostPlayedGames/v1/', 'json').catch(() => null),
    get('https://store.steampowered.com/api/featuredcategories?cc=us&l=english', 'json').catch(() => null),
  ]);
  const game = i => ({ appId: i.id, name: i.name, image: i.large_capsule_image || i.header_image || header(i.id), discount: i.discount_percent || 0, price: i.final_price, currency: i.currency });
  const uniq = list => { const seen = new Set(); return list.filter(x => x.appId && !seen.has(x.appId) && seen.add(x.appId)); };
  if (cats) {
    out.topSellers = uniq((cats.top_sellers && cats.top_sellers.items || []).map(game)).slice(0, 10);
    out.newReleases = uniq((cats.new_releases && cats.new_releases.items || []).map(game)).slice(0, 10);
    out.deals = uniq((cats.specials && cats.specials.items || []).map(game)).slice(0, 10);
  }
  if (charts && charts.response) {
    const ranks = (charts.response.ranks || []).slice(0, 10);
    // the chart only has app ids: names come from the store once and are remembered
    // (newer games keep their header art under a hashed path, so the store's own link is remembered too)
    await Promise.all(ranks.filter(r => !names[r.appid] || typeof names[r.appid] === 'string').map(r =>
      get(`https://store.steampowered.com/api/appdetails?appids=${r.appid}&filters=basic`, 'json')
        .then(j => { const d = j[r.appid] && j[r.appid].data; if (d) names[r.appid] = { name: d.name, image: d.header_image || header(r.appid) }; }).catch(() => {})));
    out.mostPlayed = ranks.filter(r => names[r.appid] && names[r.appid].name).map(r => ({ appId: r.appid, name: names[r.appid].name, image: names[r.appid].image, players: r.peak_in_game, rank: r.rank, lastRank: r.last_week_rank }));
  }
  return out;
}

// ---------------- full article text for the reader ----------------
const articles = new Map();
async function readArticle(url) {
  if (articles.has(url)) return articles.get(url);
  const html = await get(url);
  const scope = (html.match(/<article[\s\S]*?<\/article>/i) || [html])[0];
  const paras = [...scope.matchAll(/<(p|h2|h3|li)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)]
    .map(m => ({ t: m[1].toLowerCase(), text: toText(m[2]) }))
    // real sentences only: drops tag lists, captions and bylines that sit in <p> tags too
    .filter(p => (p.t === 'p' ? p.text.length > 40 && (/[.!?"”’)]$/.test(p.text) || p.text.length > 140) : p.text.length > 3) && !/^(advertisement|sign up|subscribe|related:|read more)/i.test(p.text))
    .map(p => (p.t === 'li' ? `• ${p.text}` : p.text));
  const image = (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || [])[1];
  const out = { body: paras.join('\n\n').slice(0, 14000), image: image ? decode(image) : null };
  articles.set(url, out);
  if (articles.size > 60) articles.delete(articles.keys().next().value);
  return out;
}

class Industry extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.items = [];
    this.trends = null;
    this.names = {};
    this.fetchedAt = 0;
    this.version = 0;
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      Object.assign(this, { items: j.items || [], trends: j.trends || null, names: j.names || {}, fetchedAt: j.fetchedAt || 0 });
      this.version = this.fetchedAt;
    } catch {}
  }

  static get sources() { return SOURCES.map(({ id, name }) => ({ id, name })); }

  save() {
    fs.promises.writeFile(this.file, JSON.stringify({ items: this.items, trends: this.trends, names: this.names, fetchedAt: this.fetchedAt })).catch(() => {});
  }

  stale() { return Date.now() - this.fetchedAt > REFRESH_MS; }

  data() { return { items: this.items, trends: this.trends, fetchedAt: this.fetchedAt }; }

  // enabled: { sourceId: false } turns a site off
  async refresh(enabled = {}) {
    if (this.busy) return this.busy;
    this.busy = (async () => {
      const list = SOURCES.filter(s => enabled[s.id] !== false);
      const [feeds, trends] = await Promise.all([
        Promise.all(list.map(s => get(s.url).then(xml => parseFeed(xml, s).slice(0, PER_SOURCE)).catch(() => []))),
        steamTrends(this.names).catch(() => null),
      ]);
      const cutoff = Date.now() - MAX_AGE;
      const seen = new Set();
      const items = feeds.flat()
        .filter(n => n.date > cutoff && n.date < Date.now() + 3600e3)
        .filter(n => { const k = n.title.toLowerCase().replace(/\W+/g, ' ').trim(); return !seen.has(k) && seen.add(k); })
        .sort((a, b) => b.date - a.date)
        .slice(0, 90);
      if (items.length) this.items = items;
      if (trends && (trends.mostPlayed.length || trends.topSellers.length)) this.trends = trends;
      this.fetchedAt = Date.now();
      this.version = this.fetchedAt;
      this.save();
      this.emit('change');
      return this.data();
    })().finally(() => { this.busy = null; });
    return this.busy;
  }
}

module.exports = { Industry, readArticle };
