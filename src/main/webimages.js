// Internet image search (DuckDuckGo Images, Bing as a fallback; no key needed). Pages of ~100 results with sizes.
// The search runs inside a hidden browser window, like a normal visit: plain requests get turned away
// (403) as soon as a few searches come quickly, a real browser session doesn't.
const { BrowserWindow, session } = require('electron');

// what to search for and which size filter to use, per kind of artwork
const KIND = {
  cover: { words: 'game cover art', filter: 'layout:Tall', bing: 'filterui:aspect-tall' },
  background: { words: 'wallpaper 4k', filter: 'size:Wallpaper', bing: 'filterui:imagesize-wallpaper' },
  hero: { words: 'banner key art', filter: 'layout:Wide', bing: 'filterui:aspect-wide' },
  tile: { words: 'game icon square', filter: 'layout:Square', bing: 'filterui:aspect-square' },
  logo: { words: 'logo transparent png', filter: 'type:transparent', bing: 'filterui:photo-transparent' },
  icon: { words: 'icon', filter: 'layout:Square', bing: 'filterui:aspect-square' },
};

let win = null, idle = null, loadedFor = null, vqd = null, queue = Promise.resolve();
const wait = ms => new Promise(r => setTimeout(r, ms));

function browser() {
  clearTimeout(idle);
  idle = setTimeout(() => { if (win && !win.isDestroyed()) win.destroy(); win = null; loadedFor = null; }, 120000);
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { session: session.fromPartition('persist:imagesearch'), sandbox: true, contextIsolation: true, images: false } });
  win.webContents.setAudioMuted(true);
  loadedFor = null;
  return win;
}

async function load(w, url) {
  try { await w.loadURL(url); }
  catch (e) { if (!/ERR_ABORTED|\(-3\)/.test(e.message)) throw e; } // a redirect on the way is fine
  if (w.webContents.isLoading()) await new Promise(r => w.webContents.once('did-stop-loading', r));
}

async function duck(q, k, next) {
  const w = browser();
  if (loadedFor !== q || !vqd) {
    await load(w, `https://duckduckgo.com/?q=${encodeURIComponent(q)}&iax=images&ia=images`);
    vqd = await w.webContents.executeJavaScript(`(document.documentElement.innerHTML.match(/vqd=["']?([\\w-]+)/) || [])[1] || window.vqd || null`);
    if (!vqd) throw new Error('unavailable');
    loadedFor = q;
  }
  const path = next ? `/${next}&vqd=${vqd}` : `/i.js?l=us-en&o=json&q=${encodeURIComponent(q)}&vqd=${vqd}&f=${encodeURIComponent(`${k.filter},,,,`)}&p=1`;
  const r = await w.webContents.executeJavaScript(`fetch(${JSON.stringify(path)}).then(async r => r.ok ? { ok: true, j: await r.json() } : { ok: false, status: r.status }).catch(e => ({ ok: false, status: 0 }))`);
  if (!r.ok) { loadedFor = null; throw new Error(`Image search failed (${r.status})`); }
  return {
    items: (r.j.results || []).map(x => ({ url: x.image, thumb: x.thumbnail, width: x.width, height: x.height, title: x.title, referer: x.url })),
    next: r.j.next ? `ddg:${r.j.next}` : null,
  };
}

async function bing(q, k, first = 1) {
  const w = browser();
  loadedFor = null;
  await load(w, `https://www.bing.com/images/search?q=${encodeURIComponent(q)}&qft=${encodeURIComponent(`+${k.bing}`)}&form=IRFLTR&first=${first}`);
  await wait(800);
  const items = await w.webContents.executeJavaScript(`[...document.querySelectorAll('a.iusc')].map(a => { try { const m = JSON.parse(a.getAttribute('m')); const d = (a.closest('li') || a).querySelector('.img_info .nowrap'); const s = d && d.textContent.match(/(\\d+)\\s*x\\s*(\\d+)/); return { url: m.murl, thumb: m.turl, title: m.t, referer: m.purl, width: s ? +s[1] : null, height: s ? +s[2] : null }; } catch { return null; } }).filter(Boolean)`);
  return { items, next: items.length ? `bing:${first + items.length}` : null };
}

// page: null for the first page, or the `next` value returned by the previous call
function searchImages(name, kind, next = null) {
  const k = KIND[kind] || KIND.background;
  const q = `${name} ${k.words}`;
  // one search at a time through the hidden window
  const job = queue.then(async () => {
    if (next && next.startsWith('bing:')) return bing(q, k, Number(next.slice(5)));
    let last;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return await duck(q, k, next && next.startsWith('ddg:') ? next.slice(4) : null); }
      catch (e) { last = e; await wait(1000); }
    }
    // DuckDuckGo still says no: Bing
    try { const b = await bing(q, k); if (b.items.length) return b; } catch {}
    throw new Error('The image search is busy right now. Try again in a few seconds.');
  });
  queue = job.catch(() => {});
  return job;
}

module.exports = { searchImages };
