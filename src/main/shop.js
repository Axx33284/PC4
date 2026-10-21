// Game Store data: Epic's free games (this week and next) from its public promotions feed, plus Steam's
// deals, top sellers and new releases (from What's New's trend data). Cached for half an hour.
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PC4/1.0' };
const EPIC = 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US';

let cache = null, at = 0;

function epicGame(e, offer, when) {
  const img = type => (e.keyImages || []).find(i => i.type === type);
  const wide = img('OfferImageWide') || img('featuredMedia') || img('DieselStoreFrontWide') || img('Thumbnail');
  const tall = img('OfferImageTall') || img('Thumbnail');
  const slug = (e.catalogNs && e.catalogNs.mappings && e.catalogNs.mappings[0] && e.catalogNs.mappings[0].pageSlug)
    || (e.offerMappings && e.offerMappings[0] && e.offerMappings[0].pageSlug) || (e.productSlug || '').replace(/\/home$/, '');
  return {
    store: 'epic', id: e.id, name: e.title,
    image: wide ? wide.url : null, tall: tall ? tall.url : null,
    price: (e.price && e.price.totalPrice && e.price.totalPrice.fmtPrice && e.price.totalPrice.fmtPrice.originalPrice) || '',
    free: when, // 'now' | 'soon'
    start: offer.startDate, end: offer.endDate,
    url: slug ? `https://store.epicgames.com/en-US/p/${slug}` : 'https://store.epicgames.com/en-US/free-games',
    launcher: slug ? `com.epicgames.launcher://store/p/${slug}` : null,
    seller: e.seller && e.seller.name,
  };
}

async function epicFree() {
  const res = await fetch(EPIC, { headers: UA, signal: AbortSignal.timeout(15000) });
  const j = await res.json();
  const els = (((j.data || {}).Catalog || {}).searchStore || {}).elements || [];
  const now = [], soon = [];
  for (const e of els) {
    const pr = e.promotions || {};
    // Epic marks a free game as a 100% discount, written as discountPercentage 0
    const cur = (pr.promotionalOffers || []).flatMap(g => g.promotionalOffers || []).find(o => o.discountSetting && o.discountSetting.discountPercentage === 0);
    const up = (pr.upcomingPromotionalOffers || []).flatMap(g => g.promotionalOffers || []).find(o => o.discountSetting && o.discountSetting.discountPercentage === 0);
    if (cur) now.push(epicGame(e, cur, 'now'));
    else if (up) soon.push(epicGame(e, up, 'soon'));
  }
  return { now, soon };
}

async function shop(trends, force = false) {
  if (cache && !force && Date.now() - at < 30 * 60000) return { ...cache, steam: steam(trends) };
  let epic = { now: [], soon: [] };
  try { epic = await epicFree(); } catch (e) { if (cache) epic = cache.epic; }
  cache = { epic };
  at = Date.now();
  return { epic, steam: steam(trends), fetchedAt: at };
}

function steam(t) {
  t = t || {};
  const s = x => ({ store: 'steam', appId: x.appId, name: x.name, image: x.image, discount: x.discount || 0, price: x.price, currency: x.currency, players: x.players,
    url: `https://store.steampowered.com/app/${x.appId}`, launcher: `steam://store/${x.appId}` });
  return { deals: (t.deals || []).map(s), topSellers: (t.topSellers || []).map(s), newReleases: (t.newReleases || []).map(s), mostPlayed: (t.mostPlayed || []).map(s) };
}

module.exports = { shop };
