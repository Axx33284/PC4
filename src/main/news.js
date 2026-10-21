// What's New: official news for games in the library (Steam news API, no key needed).
const fs = require('fs');
const { EventEmitter } = require('events');

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PC4/1.0' };
const CLAN_IMG = 'https://clan.akamai.steamstatic.com/images/';
const MAX_AGE = 120 * 24 * 3600 * 1000;
const REFRESH_MS = 45 * 60 * 1000;

function firstImage(raw) {
  const m = raw.match(/\[img[^\]]*\]\s*([^\[\s]+)\s*\[\/img\]/i) || raw.match(/<img[^>]+src=["']([^"']+)["']/i) || raw.match(/\{STEAM_CLAN_IMAGE\}\/[^\s"'\[\]<>]+/);
  if (!m) return null;
  const url = (m[1] || m[0]).replace('{STEAM_CLAN_IMAGE}/', CLAN_IMG);
  return /^https?:\/\//.test(url) && !/\.(gif)$/i.test(url) ? url : null;
}

function cleanText(raw) {
  return raw
    .replace(/\[img[^\]]*\].*?\[\/img\]/gis, '')
    .replace(/\[previewyoutube[^\]]*\].*?\[\/previewyoutube\]/gis, '')
    .replace(/\[\*\]/g, '\n• ')
    .replace(/\[(h\d|\/h\d)\]/gi, '\n')
    .replace(/\[\/?(p|list|olist)\]/gi, '\n')
    .replace(/\[url=[^\]]*\](.*?)\[\/url\]/gis, '$1')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\{STEAM_CLAN_IMAGE\}\S*/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

async function newsForApp(appId, count = 4) {
  const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=${count}&maxlength=0&format=json`;
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return [];
  const j = await res.json();
  return ((j.appnews && j.appnews.newsitems) || [])
    .filter(n => n.feed_type === 1 || /steam_community_announcements/.test(n.feedname || ''))
    .map(n => ({
      id: String(n.gid),
      appId: Number(appId),
      title: n.title,
      url: n.url,
      date: n.date * 1000,
      image: firstImage(n.contents || ''),
      body: cleanText(n.contents || '').slice(0, 6000),
    }));
}

class News extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.items = [];
    this.fetchedAt = 0;
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.items = j.items || [];
      this.fetchedAt = j.fetchedAt || 0;
    } catch {}
  }

  save() {
    try { fs.writeFileSync(this.file, JSON.stringify({ items: this.items, fetchedAt: this.fetchedAt })); } catch {}
  }

  stale() { return Date.now() - this.fetchedAt > REFRESH_MS; }

  // games: library list; newest-played and favorites first, up to 16 games
  async refresh(games) {
    if (this.busy) return this.items;
    this.busy = true;
    try {
      const picks = games
        .filter(g => g.meta && g.meta.steamAppId && !g.hidden)
        .sort((a, b) => (b.favorite - a.favorite) || ((b.lastPlayed || 0) - (a.lastPlayed || 0)) || (b.added - a.added))
        .slice(0, 16);
      const out = [];
      for (let i = 0; i < picks.length; i += 4) {
        const batch = await Promise.all(picks.slice(i, i + 4).map(g => newsForApp(g.meta.steamAppId).then(list => list.map(n => ({ ...n, gameId: g.id }))).catch(() => [])));
        out.push(...batch.flat());
      }
      const cutoff = Date.now() - MAX_AGE;
      const seen = new Set();
      this.items = out
        .filter(n => n.date > cutoff && !seen.has(n.id) && seen.add(n.id))
        .sort((a, b) => b.date - a.date)
        .slice(0, 60);
      this.fetchedAt = Date.now();
      this.save();
      this.emit('change');
    } finally {
      this.busy = false;
    }
    return this.items;
  }
}

module.exports = { News };
