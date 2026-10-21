// Game actions and the panels that hang off them (options, info, artwork linking, profile, power…).
import { ctx, api, el, gameById, games, media, isRunning, gameArt, backdrop, cardArt, pushLayer, removeLayer, hintsHtml, padText } from './core.js';
import { openOptions, showDialog, confirmDialog, toast, textInput, openPanel, scrollIntoList } from './ui.js';
import { sfx, Music, soundDuration, soundsDone } from './sound.js';
import { WORDMARK } from './boot.js';
import { editGame, installSongFinder, avatarPicker, renameProfile, gallery, adjustTile, songSearch, pasteSongLink } from './editor.js';
import { esc, icon, fmtPlaytime, fmtHours, timeAgo, SOURCES, avatarUrl, fileUrl, adjustBackground, controllerSupport, SUPPORT_LABEL } from '../common/util.js';

// ---------------- launching ----------------
let launchLayer = null;
let launchNode = null;
let launchedId = null;

function launchOverlay() {
  if (!launchNode) {
    launchNode = el('<div class="launch"><div class="l-art"></div><img class="l-logo" alt=""><div class="l-name"></div><div class="l-hint"></div><div class="l-status"></div></div>');
    document.body.appendChild(launchNode);
  }
  return launchNode;
}

function prepareLaunch(g, status, spinning = true) {
  const n = launchOverlay();
  const art = backdrop(g);
  const logo = media(g, 'logo');
  n.querySelector('.l-art').style.backgroundImage = art ? `url("${art}")` : 'linear-gradient(135deg,#123f9f,#051a55)';
  adjustBackground(n.querySelector('.l-art'), g.media.background ? (g.artAdjust || {}).background || null : null);
  const img = n.querySelector('.l-logo');
  img.style.display = logo ? '' : 'none';
  if (logo) img.src = logo;
  n.querySelector('.l-name').textContent = logo ? '' : g.name;
  setLaunchStatus(status, spinning);
}

function setLaunchStatus(text, spinning = true) {
  const n = launchOverlay();
  n.querySelector('.l-status').innerHTML = text ? `${spinning ? '<div class="spinner"></div>' : ''}<span>${esc(text)}</span>` : '';
}

export function hideLaunch() {
  if (launchNode) launchNode.classList.remove('show', 'hints-on');
  document.getElementById('app').classList.remove('launching');
  if (launchLayer) { removeLayer(launchLayer); launchLayer = null; }
  launchedId = null;
}

function runningLayer(g) {
  const n = launchOverlay();
  n.querySelector('.l-hint').innerHTML = hintsHtml([['circle', 'Home'], ['options', 'Close Game']]);
  if (launchLayer) removeLayer(launchLayer);
  launchLayer = {
    handle(a) {
      if (a === 'back' || a === 'home') { sfx('back'); hideLaunch(); }
      else if (a === 'options') closeGame(g);
    },
  };
  pushLayer(launchLayer);
}

// PS4-style start: the tile lifts out of the row and grows until it fills the screen,
// the home screen falls away behind it, then the game's splash (background + logo) takes over.
function zoomIn(g, fromEl) {
  const app = document.getElementById('app');
  const n = launchOverlay();
  return new Promise(resolve => {
    if (!fromEl || !fromEl.isConnected || !fromEl.getBoundingClientRect().width) {
      app.classList.add('launching');
      n.classList.add('show');
      setTimeout(resolve, 600);
      return;
    }
    const r = fromEl.getBoundingClientRect();
    const z = el(`<div class="zoom"><div class="art">${gameArt(g)}</div></div>`);
    Object.assign(z.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    document.body.appendChild(z);
    fromEl.style.visibility = 'hidden';
    const scale = Math.max(innerWidth / r.width, innerHeight / r.height) * 1.04;
    const dx = innerWidth / 2 - (r.left + r.width / 2);
    const dy = innerHeight / 2 - (r.top + r.height / 2);
    app.classList.add('launching');
    const grow = z.animate([
      { transform: 'none', boxShadow: '0 0 0 rgba(0,0,0,0)' },
      { transform: 'translate(0,0) scale(1.08)', boxShadow: '0 2rem 6rem rgba(0,0,0,.6)', offset: 0.18 },
      { transform: `translate(${dx}px,${dy}px) scale(${scale})`, boxShadow: '0 0 0 rgba(0,0,0,0)' },
    ], { duration: 820, easing: 'cubic-bezier(.6,0,.2,1)', fill: 'forwards' });
    setTimeout(() => n.classList.add('show'), 560);
    grow.finished.then(() => {
      resolve();
      z.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 450, fill: 'forwards' }).finished.then(() => {
        z.remove();
        fromEl.style.visibility = '';
      });
    });
  });
}

// The console's own start: the home screen fades out, then the game's splash screen
// (its artwork with the logo) fades in and stays while the game loads.
function fadeIn() {
  const app = document.getElementById('app');
  const n = launchOverlay();
  n.classList.add('ps4');
  app.classList.add('launching');
  return new Promise(resolve => setTimeout(() => { n.classList.add('show'); setTimeout(resolve, 900); }, 450));
}

function startAnimation(g, fromEl) {
  const n = launchOverlay();
  n.classList.remove('ps4');
  return ctx.settings.launchStyle === 'zoom' ? zoomIn(g, fromEl) : fadeIn();
}

export async function launchGame(g, fromEl = null) {
  if (isRunning(g.id)) {
    sfx('accept');
    prepareLaunch(g, 'Game is running', false);
    await startAnimation(g, fromEl);
    runningLayer(g);
    return;
  }
  if (!g.installed && g.source !== 'manual') {
    const ok = await confirmDialog('Not Installed', `${g.name} doesn't look installed. Try to start it anyway? The launcher may offer to install it.`, 'Start Anyway');
    if (!ok) return;
  }
  sfx('launch');
  Music.pause(900);
  launchedId = g.id;
  document.body.classList.add('game-running'); // PC4 pauses while the game runs
  prepareLaunch(g, ctx.settings.launchStyle === 'zoom' ? 'Starting…' : '', true);
  runningLayer(g);
  const started = api.launch(g.id);
  await startAnimation(g, fromEl);
  const r = await started;
  if (!r.ok) {
    hideLaunch();
    document.body.classList.remove('game-running');
    Music.resume();
    showDialog({ title: "Can't Start the Game", message: r.error || 'Something went wrong.', error: true });
    return;
  }
  setTimeout(() => {
    if (launchedId !== g.id) return;
    if (ctx.settings.launchStyle === 'zoom') setLaunchStatus('Now playing', false);
    launchOverlay().classList.add('hints-on');
  }, 5000);
}

export async function closeGame(g) {
  const ok = await confirmDialog('Close Game', `Close ${g.name}? Any unsaved progress will be lost.`, 'Close Game');
  if (!ok) return;
  setLaunchStatus('Closing…');
  await api.closeGame(g.id);
}

export function onGameStopped(id, seconds, failed = false) {
  const g = gameById(id);
  // back exactly where you were: same tile, same area; animations and music carry on
  if (!ctx.state.running.filter(x => x !== id).length) document.body.classList.remove('game-running');
  if (launchNode && launchNode.classList.contains('show')) hideLaunch();
  else document.getElementById('app').classList.remove('launching');
  Music.resume();
  if (g && !failed) toast({ title: g.name, body: seconds >= 60 ? `You played for ${fmtPlaytime(seconds)}` : 'Game closed', img: media(g, 'icon') || media(g, 'cover'), ico: 'gamepad' });
}

// ---------------- options ----------------
// ---------------- Secure Connection (Cloudflare WARP) ----------------
// Asked once, before PC4 first switches WARP on or installs it
export async function warpTerms() {
  if (ctx.settings.warpTerms) return true;
  const ok = await showDialog({
    title: 'Secure Connection',
    message: "PC4 uses Cloudflare WARP, a free service from Cloudflare, to send your internet traffic through Cloudflare. That gets games and sites past blocks from your internet provider or network, like Roblox in Turkey.\n\nWhile it's on, all of this PC's traffic goes through Cloudflare, and Cloudflare's WARP terms and privacy policy apply (one.one.one.one).",
    buttons: [{ label: 'Agree and Continue', value: true }, { label: 'Cancel', value: false }], cancelValue: false,
  });
  if (ok) await api.updateSettings({ warpTerms: true });
  return ok;
}

export async function warpInstall() {
  if (!(await warpTerms())) return;
  if (!(await confirmDialog('Install Cloudflare WARP', 'PC4 will install Cloudflare WARP with Windows Package Manager (winget). Windows asks for permission, and it can take a minute.', 'Install'))) return;
  toast({ id: 'warp', title: 'Installing Cloudflare WARP…', ico: 'download', duration: 0 });
  const r = await api.warpInstall();
  toast({ id: 'warp', title: r.ok ? 'Cloudflare WARP installed' : 'Install failed', body: r.ok ? '' : r.error, ico: r.ok ? 'check' : 'x', error: !r.ok, sound: false });
}

// on / off right now
export async function warpSwitch(on) {
  if (!(ctx.state.warp || {}).installed) { warpInstall(); return; }
  if (on && !(await warpTerms())) return;
  toast({ id: 'warp', title: on ? 'Connecting…' : 'Turning off…', body: 'Secure Connection', ico: 'shieldCheck', duration: 0, sound: false });
  const r = on ? await api.warpConnect() : await api.warpDisconnect();
  if (on && !r.ok) toast({ id: 'warp', title: "Couldn't Connect", body: r.error || '', ico: 'x', error: true, sound: false });
  else toast({ id: 'warp', title: on ? 'Secure Connection on' : 'Secure Connection off', body: on ? 'Your traffic goes through Cloudflare WARP' : '', ico: 'shieldCheck', sound: false });
}

// this game starts with WARP on
export async function toggleGameWarp(g) {
  const on = !g.warp;
  if (on && !(await warpTerms())) return;
  await api.updateGame(g.id, { warp: on });
  toast({ title: on ? 'Secure Connection On for This Game' : 'Secure Connection Off for This Game', body: on ? `${g.name} starts with Cloudflare WARP on` : g.name, ico: 'shieldCheck' });
  if (on && !(ctx.state.warp || {}).installed) warpInstall();
}

export function gameOptions(g, { folder = null } = {}) {
  const running = isRunning(g.id);
  const items = [
    running ? { label: 'Close Game', icon: 'close', action: () => closeGame(g) } : { label: 'Start', icon: 'play', action: () => launchGame(g) },
    { label: 'Information', icon: 'info', action: () => showInfo(g) },
    { label: g.favorite ? 'Remove from Favorites' : 'Add to Favorites', icon: 'star', action: async () => {
      await api.updateGame(g.id, { favorite: !g.favorite });
      toast({ title: g.favorite ? 'Removed from Favorites' : 'Added to Favorites', body: g.name, ico: 'star' });
    } },
    { label: 'Secure Connection', icon: 'shieldCheck', value: g.warp ? 'On' : 'Off', action: () => toggleGameWarp(g) },
    { label: 'Edit Game Details…', icon: 'edit', action: () => editGame(g.id) },
    { label: 'Rename…', icon: 'keyboard', action: async () => {
      const name = await textInput({ title: 'Game name', value: g.name });
      if (name) { await api.updateGame(g.id, { name }); toast({ title: 'Game renamed', body: name, ico: 'edit' }); }
    } },
    { label: 'Add to Folder…', icon: 'folder', action: () => addToFolder(g) },
    folder && { label: `Remove from "${folder.name}"`, icon: 'folder', action: () => api.updateFolder(folder.id, { gameIds: folder.gameIds.filter(x => x !== g.id) }) },
    { label: 'Link Artwork…', icon: 'link', action: () => linkArtwork(g) },
    { label: 'Adjust Tile…', icon: 'crop', action: () => adjustTile(g.id) },
    { label: 'Change Artwork…', icon: 'image', action: () => editGame(g.id, 'media') },
    g.meta && g.meta.steamAppId && { label: 'Screenshots & Art…', icon: 'image', action: () => gallery(g.id) },
    { label: 'Theme Song…', icon: 'music', action: () => themeSongMenu(g) },
    { label: 'Refresh Artwork', icon: 'refresh', action: () => refreshArtwork(g) },
    { label: 'Open Install Folder', icon: 'folder', disabled: !(g.installDir || g.launch.type === 'exe'), action: () => api.openGameFolder(g.id) },
    { label: g.hidden ? 'Unhide Game' : 'Hide Game', icon: 'eyeOff', action: () => api.updateGame(g.id, { hidden: !g.hidden }) },
    { label: 'Remove from Library', icon: 'trash', action: async () => {
      if (await confirmDialog('Remove Game', `Remove "${g.name}" from your PC4 library?\nThe game itself stays installed.`, 'Remove')) api.removeGame(g.id);
    } },
  ].filter(Boolean);
  openOptions({ title: g.name, items });
}

export function folderOptions(f) {
  openOptions({
    title: f.name,
    items: [
      { label: 'Rename Folder', icon: 'edit', action: async () => {
        const name = await textInput({ title: 'Folder name', value: f.name });
        if (name) api.updateFolder(f.id, { name });
      } },
      { label: 'Delete Folder', icon: 'trash', action: async () => {
        if (await confirmDialog('Delete Folder', `Delete "${f.name}"? The games inside stay in your library.`, 'Delete')) api.removeFolder(f.id);
      } },
    ],
  });
}

async function refreshArtwork(g) {
  toast({ id: 'art-' + g.id, title: 'Refreshing artwork…', body: g.name, ico: 'refresh', duration: 0 });
  try {
    await api.fetchMetadata(g.id, { force: true });
    toast({ id: 'art-' + g.id, title: 'Artwork updated', body: g.name, ico: 'image', sound: false });
  } catch (e) {
    toast({ id: 'art-' + g.id, title: 'Could not download artwork', body: e.message, ico: 'x', sound: false, error: true });
  }
}

export function addToFolder(g) {
  const folders = ctx.state.folders;
  openOptions({
    title: 'Add to Folder',
    items: [
      ...folders.map(f => ({
        label: f.name, icon: 'folder', value: f.gameIds.includes(g.id) ? 'Added' : '',
        action: async () => {
          await api.updateFolder(f.id, { gameIds: [...new Set([...f.gameIds, g.id])] });
          toast({ title: `Added to "${f.name}"`, body: g.name, ico: 'folder' });
        },
      })),
      { label: 'New Folder…', icon: 'plus', action: async () => {
        const name = await textInput({ title: 'Folder name', value: `Folder ${folders.length + 1}` });
        if (name) { await api.addFolder(name, [g.id]); toast({ title: `Created "${name}"`, body: g.name, ico: 'folder' }); }
      } },
    ],
  });
}

// ---------------- information ----------------
export function showInfo(g) {
  const hero = backdrop(g);
  const logo = media(g, 'logo');
  const m = g.meta || {};
  const rows = [
    ['Play Time', fmtPlaytime(g.playtime)],
    ['Last Played', timeAgo(g.lastPlayed)],
    ['Times Played', String(g.playCount || 0)],
    ['Source', SOURCES[g.source] || g.source],
    controllerSupport(g).known && ['Controllers', `PlayStation: ${SUPPORT_LABEL[controllerSupport(g).playstation]} · Xbox: ${SUPPORT_LABEL[controllerSupport(g).xbox]} · Keyboard: Supported`],
    m.developers && m.developers.length && ['Developer', m.developers.join(', ')],
    m.publishers && m.publishers.length && ['Publisher', m.publishers.join(', ')],
    m.genres && m.genres.length && ['Genre', m.genres.join(', ')],
    m.releaseDate && ['Release Date', m.releaseDate],
    ['Added', new Date(g.added).toLocaleDateString()],
    g.installDir && ['Location', g.installDir],
  ].filter(Boolean);
  openPanel(`
    <div class="info-hero">${hero ? `<img src="${hero}">` : ''}</div>
    <div class="info-top">${logo ? `<img class="logo" src="${logo}">` : `<h1>${esc(g.name)}</h1>`}</div>
    <div class="info-grid">
      <p>${esc(m.description || 'No description yet. Use Link Artwork to match this game with the Steam store and download its details.')}</p>
      <dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    </div>
    <div class="hints">${hintsHtml([['cross', 'Start'], ['options', 'Options'], ['circle', 'Back']])}</div>`, {
    handle(a) {
      if (a === 'accept') { launchGame(g); return true; }
      if (a === 'options') { gameOptions(g); return true; }
    },
  });
}

// ---------------- link artwork (choose the matching Steam game) ----------------
export function linkArtwork(g, term = g.name) {
  let results = null;
  let sel = 0;
  const p = openPanel(`<div class="pick"><h1>Link Artwork</h1>
    <div class="sub">Choose the game that matches “${esc(g.name)}”. PC4 downloads its cover, background, logo and details.</div>
    <div class="pick-list"></div></div>
    <div class="hints">${hintsHtml([['cross', 'Select'], ['circle', 'Back']])}</div>`, {
    handle(a) {
      const n = (results ? results.length : 0) + 1;
      if (a === 'up' || a === 'wheel-up') { if (sel > 0) { sel--; sfx('move'); render(); } else sfx('bump'); return true; }
      if (a === 'down' || a === 'wheel-down') { if (sel < n - 1) { sel++; sfx('move'); render(); } else sfx('bump'); return true; }
      if (a === 'accept') { choose(); return true; }
    },
  });
  const list = p.node.querySelector('.pick-list');
  const render = () => {
    const rows = [`<div class="pick-item ${sel === 0 ? 'sel focus-ring' : ''}" data-i="0"><div class="ph">${icon('search')}</div><span>Search with a different name…</span></div>`];
    if (!results) rows.push(`<div class="pick-status">Searching the Steam store for “${esc(term)}”…</div>`);
    else if (!results.length) rows.push(`<div class="pick-status">No matches for “${esc(term)}”. Try a different name.</div>`);
    else results.forEach((r, i) => rows.push(`<div class="pick-item ${sel === i + 1 ? 'sel focus-ring' : ''}" data-i="${i + 1}"><img src="${esc(r.thumb)}"><span>${esc(r.name)}</span></div>`));
    list.innerHTML = rows.join('');
    const selEl = list.querySelector('.sel');
    if (selEl) selEl.scrollIntoView({ block: 'nearest' });
  };
  const choose = async () => {
    sfx('accept');
    if (sel === 0) {
      const t = await textInput({ title: 'Search for', value: term });
      if (t) { p.close(true); linkArtwork(g, t); }
      return;
    }
    const r = results && results[sel - 1];
    if (!r) return;
    p.close(true);
    toast({ id: 'art-' + g.id, title: 'Downloading artwork…', body: r.name, ico: 'image', duration: 0 });
    try {
      await api.fetchMetadata(g.id, { appId: r.appId, force: true });
      toast({ id: 'art-' + g.id, title: 'Artwork linked', body: `${g.name} → ${r.name}`, ico: 'image', sound: false });
    } catch (e) {
      toast({ id: 'art-' + g.id, title: 'Download failed', body: e.message, ico: 'x', sound: false, error: true });
    }
  };
  list.addEventListener('click', e => {
    const it = e.target.closest('[data-i]');
    if (it) { sel = Number(it.dataset.i); render(); choose(); }
  });
  render();
  sfx('accept');
  api.searchSteam(term).then(r => { results = r; render(); }).catch(() => { results = []; render(); });
}

// ---------------- import ----------------
export async function runImport(sources) {
  const label = !sources || sources.length > 1 ? 'Steam, Epic Games and GOG' : { steam: 'Steam', epic: 'Epic Games', gog: 'GOG Galaxy' }[sources[0]];
  toast({ id: 'import', title: 'Looking for games…', body: label, ico: 'search', duration: 0 });
  try {
    const r = await api.importLibraries(sources);
    const missing = Object.entries(r.sources).filter(([, v]) => !v.found).map(([k]) => ({ steam: 'Steam', epic: 'Epic Games', gog: 'GOG Galaxy' }[k]));
    let body = r.added ? `${r.added} new game${r.added > 1 ? 's' : ''} added` : 'No new games found';
    if (missing.length) body += ` · ${missing.join(', ')} not installed`;
    toast({ id: 'import', title: 'Import complete', body, ico: 'check', sound: false });
  } catch (e) {
    toast({ id: 'import', title: 'Import failed', body: e.message, ico: 'x', sound: false, error: true });
  }
}

export async function addExe() {
  const f = await api.openFile({ title: 'Choose a game', filters: [{ name: 'Games and shortcuts', extensions: ['exe', 'lnk', 'url', 'bat'] }] });
  if (!f) return;
  const g = await api.addGameFromPath(f);
  toast({ title: 'Game added', body: `${g.name} · downloading artwork…`, ico: 'plus' });
}

// ---------------- activity ----------------
export function activityFeed(limit = 8) {
  const out = [];
  for (const a of ctx.state.activity) {
    if (a.type === 'started') continue;
    const g = a.gameId && gameById(a.gameId);
    if (a.gameId && !g) continue;
    const prev = out[out.length - 1];
    if (a.type === 'added' && prev && prev.type === 'added' && Math.abs(prev.ts - a.ts) < 120000) { prev.others++; continue; }
    out.push({ ...a, g, others: 0 });
    if (out.length >= limit) break;
  }
  return out.map(a => {
    let html = '';
    if (a.type === 'played') html = `You played <b>${esc(a.g.name)}</b>${a.seconds >= 60 ? ` for ${fmtPlaytime(a.seconds)}` : ''}.`;
    else if (a.type === 'added') html = a.others ? `<b>${esc(a.g.name)}</b> and ${a.others} other game${a.others > 1 ? 's' : ''} were added to your library.` : `<b>${esc(a.g.name)}</b> was added to your library.`;
    else if (a.type === 'import') html = `You imported <b>${a.count}</b> game${a.count > 1 ? 's' : ''} from your launchers.`;
    return { ...a, html };
  });
}

export function showNotifications() {
  const feed = activityFeed(40);
  let sel = 0;
  const p = openPanel(`<div class="notif"><h1>${icon('bell')} Notifications</h1><div class="notif-list"></div></div>
    <div class="hints">${hintsHtml([['cross', 'Go to Game'], ['circle', 'Back']])}</div>`, {
    handle(a) {
      if (a === 'up' || a === 'wheel-up') { if (sel > 0) { sel--; sfx('move'); render(); } return true; }
      if (a === 'down' || a === 'wheel-down') { if (sel < feed.length - 1) { sel++; sfx('move'); render(); } return true; }
      if (a === 'accept' && feed[sel] && feed[sel].g) { p.close(true); showInfo(feed[sel].g); return true; }
    },
  });
  const list = p.node.querySelector('.notif-list');
  const render = () => {
    list.innerHTML = feed.length ? feed.map((a, i) => `<div class="wn-entry ${i === sel ? 'focus-ring' : ''}">
      <div class="thumb">${a.g ? `<div class="art">${gameArt(a.g)}</div>` : `<div class="art"><div class="art-sys">${icon('bag')}</div></div>`}</div>
      <div class="txt">${a.html}<span class="when">${timeAgo(a.ts)}</span></div></div>`).join('')
      : '<div class="pick-status">No notifications yet.</div>';
    const s = list.children[sel];
    if (s) s.scrollIntoView({ block: 'nearest' });
  };
  render();
  sfx('accept');
}

// ---------------- profile ----------------
export function showProfile() {
  const s = ctx.settings;
  const all = games();
  const total = all.reduce((n, g) => n + (g.playtime || 0), 0);
  const top = [...all].filter(g => g.playtime).sort((a, b) => b.playtime - a.playtime).slice(0, 6);
  const av = avatarUrl(ctx.state);
  openPanel(`<div class="prof">
    <div class="prof-head"><div class="avatar">${av ? `<img src="${av}">` : esc((s.profileName || 'P')[0].toUpperCase())}</div>
      <div><h1>${esc(s.profileName)}</h1><div class="muted" style="font-size:2.6rem">PC4 Player</div></div></div>
    <div class="prof-stats">
      <div><b>${all.length}</b><span>Games</span></div>
      <div><b>${all.filter(g => g.installed).length}</b><span>Installed</span></div>
      <div><b>${fmtHours(total)}</b><span>Total play time</span></div>
      <div><b>${all.filter(g => g.favorite).length}</b><span>Favorites</span></div>
    </div>
    <h4>Most Played</h4>
    <div class="prof-top">${top.length ? top.map(g => `<div class="it"><div class="sq"><div class="art">${gameArt(g)}</div></div><div class="nm">${esc(g.name)}</div><div class="pt">${fmtPlaytime(g.playtime)}</div></div>`).join('') : '<div class="muted" style="font-size:2.4rem">Play some games and they will show up here.</div>'}</div>
  </div><div class="hints">${hintsHtml([['options', 'Edit Profile'], ['circle', 'Back']])}</div>`, {
    handle(a) {
      if (a === 'options') { profileOptions(); return true; }
    },
  });
  sfx('accept');
}

export function profileOptions() {
  openOptions({
    title: 'Profile',
    items: [
      { label: 'Change Name', icon: 'edit', action: renameProfile },
      { label: 'Change Avatar…', icon: 'image', action: avatarPicker },
      ctx.settings.avatar && { label: 'Remove Avatar', icon: 'trash', action: () => api.updateSettings({ avatar: null }) },
    ].filter(Boolean),
  });
}

// ---------------- power ----------------
// PS4-style: the shutdown sound plays over a black "Turning off…" screen before the action runs
export async function shutdownThen(text, fn) {
  sfx('shutdown');
  Music.pause(400);
  const node = el(`<div class="boot shut"><div class="boot-logo">${WORDMARK}</div><div class="shut-txt">${esc(text)}</div></div>`);
  document.body.appendChild(node);
  const len = soundDuration('shutdown');
  await new Promise(r => setTimeout(r, Math.max(1600, len * 1000 + 300)));
  await soundsDone(1500);
  fn();
}

export const exitPC4 = () => shutdownThen('Closing PC4…', () => api.window('quit'));

// switching pages would cut off the select sound, so wait for it to finish first
export async function switchMode(m) {
  Music.pause(400);
  await soundsDone(900);
  api.setMode(m);
}

export function powerMenu() {
  const pc = (label, action, msg, text) => async () => {
    if (await confirmDialog(label, msg, label)) shutdownThen(text, () => api.power(action));
  };
  openOptions({
    title: 'Power',
    items: [
      { label: 'Switch to Desktop Mode', icon: 'desktop', action: () => switchMode('desktop') },
      { label: 'Exit PC4', icon: 'exit', action: exitPC4 },
      { label: 'Minimize PC4', icon: 'down', action: () => api.window('minimize') },
      { label: 'Sleep', icon: 'moon', action: pc('Sleep', 'sleep', 'Put the PC to sleep?', 'Entering sleep…') },
      { label: 'Restart PC', icon: 'restart', action: pc('Restart PC', 'restart', 'Restart the PC now? Unsaved work in other apps will be lost.', 'Restarting…') },
      { label: 'Turn Off PC', icon: 'power', action: pc('Turn Off PC', 'shutdown', 'Turn off the PC now? Unsaved work in other apps will be lost.', 'Turning off…') },
    ],
  });
}

// ---------------- What's New: game news and your own posts ----------------
export function gameNews(gameId) {
  return (ctx.state.news || []).filter(n => n.gameId === gameId);
}

// your posts, then news and activity, newest first
// What's New: your posts first, then the games industry's news mixed with news for your own games and
// a little of your own activity, newest first
export function newsFeed(activity) {
  const posts = (ctx.state.posts || []).map(p => ({ ...p, kind: 'post' }));
  const news = (ctx.state.news || []).filter(n => gameById(n.gameId)).slice(0, 10).map(n => ({ ...n, kind: 'news', ts: n.date }));
  const industry = ctx.settings.industryNews !== false ? ((ctx.industry && ctx.industry.items) || []).slice(0, 40).map(n => ({ ...n, kind: 'industry', ts: n.date })) : [];
  const acts = activity.slice(0, 4).map(a => ({ ...a, kind: 'activity' }));
  return [...posts, ...[...industry, ...news, ...acts].sort((a, b) => b.ts - a.ts)].slice(0, 36);
}

// the industry stories live in the main process; the renderer keeps one copy and refetches when it changes
export async function loadIndustry() {
  try { ctx.industry = await api.getIndustry(); } catch {}
  return ctx.industry;
}

export function showArticle(a) {
  const g = a.gameId ? gameById(a.gameId) : null;
  const img = a.kind === 'post' ? (a.image ? fileUrl(`${ctx.state.mediaDir}/_posts/${a.image}`) : null) : (a.image || (g && cardArt(g)));
  const who = a.kind === 'post' ? `${ctx.settings.profileName} posted` : a.sourceName || (g ? g.name : 'News');
  let off = 0;
  const p = openPanel(`<div class="article"><div class="a-inner">
      ${img ? `<div class="a-img" style="background-image:url('${esc(img)}')"></div>` : ''}
      <div class="a-game">${esc(who)} · ${esc(timeAgo(a.date || a.ts))}</div>
      <h1>${esc(a.title)}</h1>
      <div class="a-body">${esc(a.body || a.summary || '')}</div>
      ${a.kind === 'industry' ? `<div class="a-more">Loading the full story…</div>` : ''}</div></div>
    <div class="hints">${hintsHtml([['options', 'Options'], ['circle', 'Back']])}</div>`, {
    handle(action) {
      const inner = p.node.querySelector('.a-inner');
      const max = Math.max(0, inner.scrollHeight - p.node.querySelector('.article').clientHeight);
      const step = innerHeight * 0.3;
      if (action === 'down' || action === 'wheel-down') { off = Math.min(max, off + step); inner.style.transform = `translateY(${-off}px)`; return true; }
      if (action === 'up' || action === 'wheel-up') { off = Math.max(0, off - step); inner.style.transform = `translateY(${-off}px)`; return true; }
      if (action === 'options') {
        openOptions({
          title: a.title,
          items: [
            a.url && { label: 'Open in Browser', icon: 'link', action: () => api.openExternal(a.url) },
            g && { label: 'Go to Game', icon: 'gamepad', action: () => { p.close(true); showInfo(g); } },
            a.kind === 'post' && { label: 'Delete Post', icon: 'trash', action: async () => {
              if (await confirmDialog('Delete Post', `Delete "${a.title}"?`, 'Delete')) { p.close(true); api.removePost(a.id); }
            } },
          ].filter(Boolean),
        });
        return true;
      }
    },
  });
  sfx('accept');
  // a picture the site won't share: drop the empty frame
  if (img && /^https?:/.test(img)) { const test = new Image(); test.onerror = () => { const box = p.node.querySelector('.a-img'); if (box) box.remove(); }; test.src = img; }
  // industry stories: the feed only has a summary, so the reader fetches the article itself
  if (a.kind === 'industry') {
    api.readArticle(a.url).then(r => {
      if (!p.node.isConnected) return;
      const more = p.node.querySelector('.a-more');
      if (r && r.body && r.body.length > (a.summary || '').length) {
        p.node.querySelector('.a-body').textContent = r.body;
        if (more) more.remove();
      } else if (more) more.textContent = `Read the full story on ${a.sourceName}: ${padText('options')} › Open in Browser`;
    });
  }
}

// ---------------- Trending (Steam): most played now, top sellers, new releases, deals ----------------
const TREND_TABS = [
  ['mostPlayed', 'Most Played'], ['topSellers', 'Top Sellers'], ['newReleases', 'New Releases'], ['deals', 'Deals'],
];
const fmtPlayers = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
const money = (cents, cur) => (cents ? new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD' }).format(cents / 100) : 'Free');

export function trendLine(it, tab) {
  if (tab === 'mostPlayed') {
    const move = it.lastRank && it.lastRank !== it.rank ? (it.lastRank > it.rank ? ` · ▲ ${it.lastRank - it.rank}` : ` · ▼ ${it.rank - it.lastRank}`) : '';
    return `#${it.rank} · ${fmtPlayers(it.players)} playing at peak${move}`;
  }
  if (tab === 'deals') return `−${it.discount}% · ${money(it.price, it.currency)}`;
  return it.discount ? `−${it.discount}% · ${money(it.price, it.currency)}` : money(it.price, it.currency);
}

export function showTrending(startTab = 0) {
  const trends = (ctx.industry && ctx.industry.trends) || {};
  let tab = startTab;
  let sel = 0;
  const owned = appId => ctx.state.games.find(x => x.meta && Number(x.meta.steamAppId) === Number(appId));
  const p = openPanel(`<div class="pick trend"><h1>Trending</h1><div class="trend-tabs"></div><div class="sub">What people are playing and buying on Steam right now.</div><div class="pick-list"></div></div>
    <div class="hints">${hintsHtml([['l1', 'Previous'], ['r1', 'Next'], ['cross', 'Open in Steam'], ['circle', 'Back']])}</div>`, {
    handle(a) {
      const list = trends[TREND_TABS[tab][0]] || [];
      if (a === 'up' || a === 'wheel-up') { if (sel > 0) { sel--; sfx('move'); render(); } return true; }
      if (a === 'down' || a === 'wheel-down') { if (sel < list.length - 1) { sel++; sfx('move'); render(); } return true; }
      if (a === 'l1' || a === 'r1' || a === 'left' || a === 'right') {
        const n = tab + (a === 'l1' || a === 'left' ? -1 : 1);
        if (n >= 0 && n < TREND_TABS.length) { tab = n; sel = 0; sfx('move'); render(); }
        return true;
      }
      if (a === 'accept') { open(list[sel]); return true; }
    },
  });
  const listEl = p.node.querySelector('.pick-list');
  const render = () => {
    p.node.querySelector('.trend-tabs').innerHTML = TREND_TABS.map(([, l], i) => `<span class="${i === tab ? 'on' : ''}" data-t="${i}">${l}</span>`).join('');
    const key = TREND_TABS[tab][0];
    const list = trends[key] || [];
    listEl.innerHTML = list.length ? list.map((it, i) => `<div class="pick-item trend-item ${i === sel ? 'sel focus-ring' : ''}" data-i="${i}">
      <img src="${esc(it.image)}" loading="lazy" decoding="async"><span class="tr-text"><span class="tr-name">${esc(it.name)}${owned(it.appId) ? ' <em>In Library</em>' : ''}</span><span class="tr-line">${esc(trendLine(it, key))}</span></span></div>`).join('')
      : '<div class="pick-status">Nothing here yet. PC4 checks Steam every half hour while you\'re online.</div>';
    const s = listEl.querySelector('.sel');
    if (s) s.scrollIntoView({ block: 'nearest' });
  };
  const open = it => {
    if (!it) return;
    sfx('accept');
    const g = owned(it.appId);
    if (g) { openOptions({ title: it.name, items: [
      { label: 'Go to Game', icon: 'gamepad', action: () => { p.close(true); showInfo(g); } },
      { label: 'Open in Steam', icon: 'bag', action: () => api.openExternal(`steam://store/${it.appId}`) },
    ] }); return; }
    api.openExternal(`steam://store/${it.appId}`);
    toast({ title: 'Opening in Steam', body: it.name, ico: 'bag' });
  };
  p.node.querySelector('.trend-tabs').addEventListener('click', e => { const t = e.target.closest('[data-t]'); if (t) { tab = Number(t.dataset.t); sel = 0; render(); } });
  listEl.addEventListener('click', e => { const it = e.target.closest('[data-i]'); if (it) { sel = Number(it.dataset.i); render(); open((trends[TREND_TABS[tab][0]] || [])[sel]); } });
  render();
  sfx('accept');
}

export async function postNews() {
  const title = await textInput({ title: 'Post to What\'s New: headline' });
  if (!title) return;
  const body = await textInput({ title: 'Write your post (optional)' });
  let imageFile = null;
  const pic = await showDialog({ title: 'Add a Picture?', message: 'Show an image with your post.', buttons: [{ label: 'Choose Picture…', value: true }, { label: 'No Picture', value: false }], cancelValue: false });
  if (pic) imageFile = await api.openFile({ title: 'Choose a picture', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
  await api.addPost({ title, body: body || '', imageFile });
  toast({ title: 'Posted to What\'s New', body: title, ico: 'shapes' });
}

export function whatsNewOptions(entry) {
  openOptions({
    title: "What's New",
    items: [
      { label: 'Post News…', icon: 'edit', action: postNews },
      { label: 'Refresh News', icon: 'refresh', action: async () => {
        toast({ id: 'news', title: 'Checking for news…', ico: 'refresh', duration: 0 });
        const [items, ind] = await Promise.all([api.refreshNews(), api.refreshIndustry()]);
        const n = ((ind && ind.items) || []).length;
        toast({ id: 'news', title: 'News updated', body: `${n} gaming stories · ${items.length} from your games`, ico: 'check', sound: false });
      } },
      { label: 'Trending on Steam', icon: 'star', action: () => showTrending() },
      entry && entry.kind === 'post' && { label: 'Delete This Post', icon: 'trash', action: async () => {
        if (await confirmDialog('Delete Post', `Delete "${entry.title}"?`, 'Delete')) api.removePost(entry.id);
      } },
      entry && entry.url && { label: 'Open in Browser', icon: 'link', action: () => api.openExternal(entry.url) },
    ].filter(Boolean),
  });
}

// ---------------- YouTube (the TV app, inside PC4) ----------------
let ytLayer = null;
let ytSplash = null;
const YT_SPLASH = `<div class="app-splash"><div class="as-logo">${icon('ytFill')}<span>YouTube</span></div><div class="as-dots"><i></i><i></i><i></i></div></div>`;

// like starting an app on a PS4: a splash while it loads, then the app fills the screen
export async function openYouTube() {
  if (ytLayer) return;
  sfx('launch');
  Music.hold(500);
  ctx.appOpen = true;
  document.body.classList.add('app-open'); // PC4 sits still behind the app
  // the app has the controller once it's on screen; while it loads, ○ or the PS button cancel
  let requested = false;
  const layer = ytLayer = { handle(a) {
    if ((a !== 'back' && a !== 'home') || !ytSplash || ytSplash.classList.contains('shown')) return;
    if (requested) api.closeYouTube(); else onYouTubeClosed();
  } };
  pushLayer(ytLayer);
  ytSplash = el(YT_SPLASH);
  document.body.appendChild(ytSplash);
  requestAnimationFrame(() => ytSplash && ytSplash.classList.add('in'));
  await new Promise(r => setTimeout(r, 400));
  if (ytLayer !== layer) return; // cancelled during the fade
  requested = true;
  const ok = await api.openYouTube();
  if (!ok) onYouTubeClosed();
}

export function onYouTubeShown() { if (ytSplash) ytSplash.classList.add('shown'); }

export function onYouTubeClosed(reason) {
  if (!ytLayer) return;
  removeLayer(ytLayer);
  ytLayer = null;
  ctx.appOpen = false;
  document.body.classList.remove('app-open');
  const splash = ytSplash;
  ytSplash = null;
  if (splash) { splash.classList.remove('in'); setTimeout(() => splash.remove(), 450); }
  sfx('back');
  Music.release();
  if (reason === 'offline') toast({ title: "Can't reach YouTube", body: 'Check your internet connection and try again.', ico: 'x', error: true });
}

export async function clearYouTube() {
  if (!await confirmDialog('Sign Out of YouTube', 'Sign out of YouTube and forget everything it saved on this PC (watch history on this device, settings)?', 'Sign Out')) return;
  await api.clearYouTube();
  toast({ title: 'Signed out of YouTube', ico: 'check' });
}

// ---------------- theme songs ----------------
export function themeSongMenu(g) {
  const has = !!g.media.music;
  openOptions({
    title: `${g.name} · Theme Song`,
    items: [
      ctx.state.ytdlp && { label: 'Search Online…', icon: 'search', action: () => songSearch(g) },
      ctx.state.ytdlp && { label: 'Paste a YouTube Link…', icon: 'link', action: () => pasteSongLink(g) },
      ctx.state.ytdlp && { label: has ? 'Find a Different Song Automatically' : 'Find Automatically', icon: 'refresh', action: async () => {
        toast({ id: 'song-' + g.id, title: 'Finding theme song…', body: g.name, ico: 'music', duration: 0 });
        const r = await api.findThemeSong(g.id, true);
        toast({ id: 'song-' + g.id, title: r.ok ? 'Theme song ready' : 'No theme song found', body: r.ok ? g.name : r.error, ico: r.ok ? 'music' : 'x', sound: false, error: !r.ok });
      } },
      { label: 'Choose Music File…', icon: 'folder', action: async () => {
        const f = await api.openFile({ title: `Theme song for ${g.name}`, filters: [{ name: 'Audio', extensions: ['mp3', 'ogg', 'm4a', 'wav', 'flac', 'opus', 'aac', 'webm'] }] });
        if (f) { await api.setMusic(g.id, f); toast({ title: 'Theme song set', body: g.name, ico: 'music' }); }
      } },
      has && { label: 'Remove Theme Song', icon: 'trash', action: () => api.setMusic(g.id, null) },
      !ctx.state.ytdlp && { label: 'Install Song Finder…', icon: 'plus', action: () => installSongFinder() },
    ].filter(Boolean),
  });
}

export { editGame };
