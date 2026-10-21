// Console-mode editors: Edit Game Details (rename, artwork, theme song), the online image search,
// and the avatar picker. Everything is reachable with a controller.
import { ctx, api, gameById, media, gameArt, hintsHtml, padText } from './core.js';
import { openPanel, textInput, toast, showDialog, confirmDialog, spatialMove } from './ui.js';
import { sfx, Music } from './sound.js';
import { esc, icon, fileUrl, SOURCES, adjustStyle } from '../common/util.js';

const KINDS = [
  { k: 'icon', label: 'Icon', hint: 'Small square' },
  { k: 'cover', label: 'Cover Image', hint: '600×900' },
  { k: 'tile', label: 'Console Tile', hint: 'Square' },
  { k: 'hero', label: 'Banner', hint: 'Wide · tiles & cards' },
  { k: 'background', label: 'Wallpaper', hint: 'Full screen' },
  { k: 'logo', label: 'Logo', hint: 'Transparent' },
];
const ACTIONS = [
  { a: 'file', ico: 'plus', label: 'Choose from PC' },
  { a: 'url', ico: 'link', label: 'Link from URL' },
  { a: 'clear', ico: 'trash', label: 'Remove' },
  { a: 'web', ico: 'search', label: 'Search online' },
  { a: 'adjust', ico: 'crop', label: 'Adjust size & position' },
];
const IMG = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'ico'] }];
const AUDIO = [{ name: 'Audio', extensions: ['mp3', 'ogg', 'm4a', 'wav', 'flac', 'opus', 'aac', 'webm'] }];

// Focus handling shared by the screens below: [data-f] elements, moved between with the d-pad.
function focusable(root, onChange) {
  let cur = null;
  const items = () => [...root.querySelectorAll('[data-f]:not(.off)')].filter(n => n.offsetParent);
  const set = n => {
    if (!n) return;
    if (cur) cur.classList.remove('sel', 'focus-ring');
    cur = n;
    cur.classList.add('sel', 'focus-ring');
    cur.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    if (onChange) onChange(cur);
  };
  return {
    get cur() { return cur && cur.isConnected ? cur : null; },
    set,
    first(sel) { set([...root.querySelectorAll(sel || '[data-f]')].find(n => !n.classList.contains('off') && n.offsetParent)); },
    refocus(key) { const n = key && root.querySelector(`[data-f="${key}"]`); set(n || items()[0]); },
    move(dir) {
      const now = this.cur || items()[0];
      if (!this.cur) { set(now); return true; }
      const n = spatialMove(items(), now, dir);
      if (!n) { sfx('bump'); return false; }
      sfx('move');
      set(n);
      return true;
    },
  };
}

// ---------------- Edit Game Details ----------------
export function editGame(gameId, startTab = 'general') {
  let tab = startTab;
  let preview = null; // theme-song preview <audio>
  const p = openPanel(`<div class="edit">
      <div class="edit-head"><h1>Edit Game Details</h1><div class="sub"></div></div>
      <div class="edit-tabs"></div>
      <div class="edit-body"></div>
      <div class="edit-foot"></div>
    </div>
    <div class="hints">${hintsHtml([['l1', ''], ['r1', 'Tabs'], ['cross', 'Select'], ['circle', 'Back']])}</div>`, {
    handle(a) {
      if (a === 'l1' || a === 'r1') { switchTab(a === 'l1' ? -1 : 1); return true; }
      if (a === 'up' || a === 'down' || a === 'left' || a === 'right') { f.move(a); return true; }
      if (a === 'accept') { activate(f.cur); return true; }
    },
    onClose() { if (preview) { preview.pause(); Music.resume(); } },
  });
  const root = p.node.querySelector('.edit');
  const body = root.querySelector('.edit-body');
  const f = focusable(root, n => {
    const hint = root.querySelector('.slot-hint.show');
    if (hint) hint.classList.remove('show');
    const slot = n.closest('.slot');
    if (slot && n.dataset.act) { const h = slot.querySelector('.slot-hint'); h.textContent = ACTIONS.find(x => x.a === n.dataset.act).label; h.classList.add('show'); }
  });
  const TABS = [['general', 'General'], ['media', 'Media'], ['song', 'Theme Song']];
  const game = () => gameById(gameId);

  const switchTab = d => {
    const i = TABS.findIndex(t => t[0] === tab);
    const n = TABS[(i + d + TABS.length) % TABS.length][0];
    tab = n;
    sfx('move');
    render();
    f.first('.edit-body [data-f]');
  };

  const row = (key, label, value, kind = 'text') => `<div class="erow" data-f="${key}" data-kind="${kind}">
      <span class="lbl">${esc(label)}</span><span class="val">${kind === 'toggle' ? `<span class="check ${value ? 'on' : ''}">${icon('check')}</span>` : esc(value || '—')}</span></div>`;

  const renderGeneral = g => {
    const m = g.meta || {};
    return `<div class="erows">
      ${row('name', 'Name', g.name)}
      ${row('description', 'Description', m.description ? m.description.slice(0, 90) + (m.description.length > 90 ? '…' : '') : '')}
      ${row('developers', 'Developer', (m.developers || []).join(', '))}
      ${row('publishers', 'Publisher', (m.publishers || []).join(', '))}
      ${row('genres', 'Genres', (m.genres || []).join(', '))}
      ${row('releaseDate', 'Release Date', m.releaseDate)}
      ${row('steamAppId', 'Steam App ID', m.steamAppId ? String(m.steamAppId) : '')}
      ${row('source', 'Source', SOURCES[g.source] || g.source, 'source')}
      ${row('favorite', 'Favorite', g.favorite, 'toggle')}
      ${row('hidden', 'Hidden', g.hidden, 'toggle')}
      ${row('target', 'Launch', g.launch.target, 'target')}
      ${row('args', 'Launch Arguments', g.launch.args)}
    </div>`;
  };

  const renderMedia = g => `<div class="slots">${KINDS.map(({ k, label, hint }) => {
    const url = media(g, k);
    const canAdjust = url || (k === 'tile' && (media(g, 'hero') || media(g, 'cover')));
    return `<div class="slot" data-kind="${k}"><div class="slot-top"><h3>${label}</h3><span class="size" data-size="${k}">${url ? '' : hint}</span></div>
      <div class="slot-btns">${ACTIONS.map(x => `<div class="sbtn ${(x.a === 'clear' && !url) || (x.a === 'adjust' && !canAdjust) ? 'off' : ''}" data-f="${k}:${x.a}" data-act="${x.a}">${icon(x.ico)}</div>`).join('')}<span class="slot-hint"></span></div>
      <div class="slot-img kind-${k}">${url ? `<img src="${url}" data-k="${k}">` : `<span class="none">None</span>`}</div></div>`;
  }).join('')}</div>`;

  const renderSong = g => {
    const has = !!g.media.music;
    return `<div class="erows">
      <div class="erow ${has ? '' : 'off'}" data-f="play"><span class="lbl">${icon('music')} ${has ? 'Play / Stop Preview' : 'No theme song yet'}</span><span class="val">${has ? esc(g.media.music) : ''}</span></div>
      ${ctx.state.ytdlp
        ? `<div class="erow" data-f="search"><span class="lbl">${icon('search')} Search Online…</span><span class="val">Pick a song from YouTube results, with previews</span></div>
           <div class="erow" data-f="link"><span class="lbl">${icon('link')} Paste a YouTube Link…</span><span class="val">Uses the audio of that video</span></div>
           <div class="erow" data-f="find"><span class="lbl">${icon('refresh')} ${has ? 'Find a Different Song Automatically' : 'Find Theme Song Automatically'}</span><span class="val">Takes the best match for the game's main theme</span></div>`
        : `<div class="erow" data-f="install"><span class="lbl">${icon('plus')} Install Song Finder</span><span class="val">Lets PC4 search YouTube for theme songs (yt-dlp, via winget)</span></div>`}
      <div class="erow" data-f="songfile"><span class="lbl">${icon('folder')} Choose Music File…</span><span class="val">mp3, ogg, m4a, wav, flac</span></div>
      <div class="erow ${has ? '' : 'off'}" data-f="songclear"><span class="lbl">${icon('trash')} Remove Theme Song</span><span class="val"></span></div>
    </div>`;
  };

  const render = () => {
    const g = game();
    if (!g) { p.close(true); return; }
    const key = f.cur && f.cur.dataset.f;
    root.querySelector('.sub').textContent = g.name;
    root.querySelector('.edit-tabs').innerHTML = TABS.map(([k, l]) => `<div class="etab ${k === tab ? 'on' : ''}" data-f="tab:${k}">${l}</div>`).join('');
    body.innerHTML = tab === 'general' ? renderGeneral(g) : tab === 'media' ? renderMedia(g) : renderSong(g);
    root.querySelector('.edit-foot').innerHTML = `
      <div class="ebtn" data-f="meta">${icon('image')} Download Metadata…</div>
      <div class="ebtn" data-f="refresh">${icon('refresh')} Refresh Artwork</div>
      <div class="ebtn" data-f="folder">${icon('folder')} Open Metadata Folder</div>
      <div class="ebtn primary" data-f="done">Done</div>`;
    body.querySelectorAll('img[data-k]').forEach(img => img.addEventListener('load', () => {
      const s = root.querySelector(`[data-size="${img.dataset.k}"]`);
      if (s) s.textContent = `${img.naturalWidth}×${img.naturalHeight}px`;
    }, { once: true }));
    if (key) f.refocus(key);
  };

  const editText = async (title, value) => textInput({ title, value: value || '' });
  const list = s => s.split(',').map(x => x.trim()).filter(Boolean);

  const activate = async n => {
    if (!n) return;
    const g = game();
    const key = n.dataset.f;
    if (key.startsWith('tab:')) { tab = key.slice(4); sfx('accept'); render(); f.refocus(key); return; }
    sfx('accept');
    const m = g.meta || {};
    switch (key) {
      case 'name': { const v = await editText('Game name', g.name); if (v) await api.updateGame(g.id, { name: v }); break; }
      case 'description': { const v = await editText('Description', m.description); if (v !== null) await api.updateGame(g.id, { meta: { description: v } }); break; }
      case 'developers': case 'publishers': case 'genres': {
        const v = await editText(n.querySelector('.lbl').textContent + ' (separate with commas)', (m[key] || []).join(', '));
        if (v !== null) await api.updateGame(g.id, { meta: { [key]: list(v) } });
        break;
      }
      case 'releaseDate': { const v = await editText('Release date', m.releaseDate); if (v !== null) await api.updateGame(g.id, { meta: { releaseDate: v } }); break; }
      case 'steamAppId': {
        const v = await editText('Steam App ID (used to download artwork)', m.steamAppId ? String(m.steamAppId) : '');
        if (v !== null) await api.updateGame(g.id, { meta: { steamAppId: parseInt(v, 10) || null } });
        break;
      }
      case 'source': {
        const keys = Object.keys(SOURCES);
        await api.updateGame(g.id, { source: keys[(keys.indexOf(g.source) + 1) % keys.length] });
        break;
      }
      case 'favorite': case 'hidden': await api.updateGame(g.id, { [key]: !g[key] }); break;
      case 'target': {
        const file = await api.openFile({ title: 'Choose the game program', filters: [{ name: 'Programs', extensions: ['exe', 'lnk', 'bat', 'url'] }] });
        if (file) {
          const dir = file.replace(/[\\/][^\\/]+$/, '');
          await api.updateGame(g.id, { launch: { type: 'exe', target: file, workingDir: dir }, installDir: g.installDir || dir });
        }
        break;
      }
      case 'args': { const v = await editText('Launch arguments', g.launch.args); if (v !== null) await api.updateGame(g.id, { launch: { args: v } }); break; }
      case 'play': togglePreview(g); break;
      case 'find': {
        toast({ id: 'song-' + g.id, title: 'Finding theme song…', body: g.name, ico: 'music', duration: 0 });
        const r = await api.findThemeSong(g.id, true);
        toast({ id: 'song-' + g.id, title: r.ok ? 'Theme song ready' : 'No theme song found', body: r.ok ? g.name : r.error, ico: r.ok ? 'music' : 'x', sound: false, error: !r.ok });
        break;
      }
      case 'search': stopPreview(); songSearch(g); return;
      case 'link': stopPreview(); await pasteSongLink(g); break;
      case 'install': await installSongFinder(); break;
      case 'songfile': { const file = await api.openFile({ title: `Theme song for ${g.name}`, filters: AUDIO }); if (file) await api.setMusic(g.id, file); break; }
      case 'songclear': stopPreview(); await api.setMusic(g.id, null); break;
      case 'meta': p.close(true); (await import('./actions.js')).linkArtwork(g); return;
      case 'refresh': {
        toast({ id: 'art-' + g.id, title: 'Refreshing artwork…', body: g.name, ico: 'refresh', duration: 0 });
        try { await api.fetchMetadata(g.id, { force: true }); toast({ id: 'art-' + g.id, title: 'Artwork updated', body: g.name, ico: 'image', sound: false }); }
        catch (e) { toast({ id: 'art-' + g.id, title: 'Could not download artwork', body: e.message, ico: 'x', sound: false, error: true }); }
        break;
      }
      case 'folder': api.openMediaFolder(g.id); break;
      case 'done': p.close(); return;
      default: {
        const [kind, act] = key.split(':');
        await mediaAction(g, kind, act);
      }
    }
    render();
  };

  const mediaAction = async (g, kind, act) => {
    const label = KINDS.find(x => x.k === kind).label;
    try {
      if (act === 'file') {
        const file = await api.openFile({ title: `Choose ${label.toLowerCase()}`, filters: IMG });
        if (file) await api.setImage(g.id, kind, { file });
      } else if (act === 'url') {
        const url = await textInput({ title: `${label}: paste an image link (https://…)` });
        if (url) {
          toast({ id: 'img', title: 'Downloading image…', ico: 'image', duration: 0 });
          await api.setImage(g.id, kind, { url });
          toast({ id: 'img', title: `${label} updated`, body: g.name, ico: 'image', sound: false });
        }
      } else if (act === 'clear') {
        if (await confirmDialog(`Remove ${label}`, `Remove the ${label.toLowerCase()} of ${g.name}?`, 'Remove')) await api.setImage(g.id, kind, null);
      } else if (act === 'web') {
        imageSearch(g.id, kind);
      } else if (act === 'adjust') {
        if (kind === 'tile') adjustTile(g.id); else adjustArt(g.id, kind);
      }
    } catch (e) {
      toast({ id: 'img', title: 'Could not use that image', body: e.message, ico: 'x', sound: false, error: true });
    }
  };

  const stopPreview = () => { if (preview) { preview.pause(); preview = null; Music.resume(); } };
  const togglePreview = g => {
    if (preview) { stopPreview(); return; }
    Music.pause(300);
    preview = new Audio(fileUrl(`${ctx.state.mediaDir}/${g.id}/${g.media.music}`));
    preview.volume = ctx.settings.muteAll ? 0 : (ctx.settings.masterVolume ?? 1) * (ctx.settings.gameMusicVolume ?? 0.4);
    preview.play().catch(() => {});
  };

  root.addEventListener('click', e => {
    const n = e.target.closest('[data-f]');
    if (n && !n.classList.contains('off')) { f.set(n); activate(n); }
  });
  // keep the screen in step with changes (downloads finishing, renames…)
  const onState = () => { if (p.node.isConnected) render(); else ctx.subs.delete(onState); };
  ctx.subs.add(onState);
  render();
  f.first('.edit-body [data-f]');
  sfx('accept');
}

export async function installSongFinder() {
  const ok = await confirmDialog('Install Song Finder', 'PC4 will install yt-dlp with Windows Package Manager (winget) so it can find theme songs for your games by itself.\n\nThis can take a minute.', 'Install');
  if (!ok) return false;
  toast({ id: 'ytdlp', title: 'Installing song finder…', body: 'yt-dlp via winget', ico: 'music', duration: 0 });
  const r = await api.installSongFinder();
  toast({ id: 'ytdlp', title: r.ok ? 'Song finder installed' : 'Install failed', body: r.ok ? 'Theme songs will now be found automatically' : r.error, ico: r.ok ? 'check' : 'x', sound: false, error: !r.ok });
  return r.ok;
}

// ---------------- theme song search (YouTube through yt-dlp) ----------------
const fmtLen = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// Downloads the song behind a link (from the search or pasted) and makes it the game's theme song
export async function useSongLink(g, url, title) {
  toast({ id: 'song-' + g.id, title: 'Downloading theme song…', body: title || g.name, ico: 'music', duration: 0 });
  const r = await api.setThemeSongUrl(g.id, url);
  toast({ id: 'song-' + g.id, title: r.ok ? 'Theme song ready' : 'Could not use that song', body: r.ok ? g.name : r.error, ico: r.ok ? 'music' : 'x', sound: false, error: !r.ok });
  return r.ok;
}

// "Paste a YouTube link": the on-screen keyboard, already filled in when a link is on the clipboard
export async function pasteSongLink(g) {
  let clip = '';
  try { clip = (await api.clipboardText() || '').trim(); } catch {}
  const url = await textInput({ title: `YouTube link for ${g.name}'s theme song`, value: /^https?:\/\/\S+$/i.test(clip) ? clip : 'https://' });
  if (!url || url === 'https://') return false;
  return useSongLink(g, url);
}

export function songSearch(g, term = `${g.name} main theme`) {
  if (!ctx.state.ytdlp) { installSongFinder(); return; }
  let results = null;
  let error = '';
  let sel = 2;
  let preview = null; // { audio, id }
  let loadingPreview = null;
  const TOP = 2; // "search again" and "paste a link" come before the results
  const p = openPanel(`<div class="pick song-pick"><h1>Find Theme Song</h1>
    <div class="sub"></div>
    <div class="pick-list"></div></div>
    <div class="hints">${hintsHtml([['cross', 'Use This Song'], ['square', 'Preview'], ['triangle', 'Search'], ['circle', 'Back']])}</div>`, {
    handle(a) {
      const n = TOP + (results ? results.length : 0);
      if (a === 'up' || a === 'wheel-up') { if (sel > 0) { sel--; sfx('move'); render(); } return true; }
      if (a === 'down' || a === 'wheel-down') { if (sel < n - 1) { sel++; sfx('move'); render(); } return true; }
      if (a === 'accept') { choose(); return true; }
      if (a === 'square') { togglePreview(); return true; }
      if (a === 'triangle') { searchAgain(); return true; }
    },
    onClose: () => stopPreview(),
  });
  const list = p.node.querySelector('.pick-list');
  const sub = p.node.querySelector('.sub');
  const render = () => {
    sub.textContent = `Results from YouTube for “${term}”. Pick one to make it the theme song of ${g.name}.`;
    const rows = [
      `<div class="pick-item ${sel === 0 ? 'sel focus-ring' : ''}" data-i="0"><div class="ph">${icon('search')}</div><span>Search with different words…</span></div>`,
      `<div class="pick-item ${sel === 1 ? 'sel focus-ring' : ''}" data-i="1"><div class="ph">${icon('link')}</div><span>Paste a YouTube link…</span></div>`,
    ];
    if (!results) rows.push(`<div class="pick-status">${error ? esc(error) : 'Searching YouTube…'}</div>`);
    else if (!results.length) rows.push(`<div class="pick-status">Nothing found for “${esc(term)}”. Press ${esc(padText('triangle'))} to try different words.</div>`);
    else results.forEach((r, i) => {
      const playing = preview && preview.id === r.id;
      const loading = loadingPreview === r.id;
      rows.push(`<div class="pick-item song ${sel === i + TOP ? 'sel focus-ring' : ''} ${playing ? 'playing' : ''}" data-i="${i + TOP}">
        <div class="yt-thumb"><img src="${esc(r.thumb)}" loading="lazy"><b>${fmtLen(r.duration)}</b>${playing || loading ? `<i>${icon(loading ? 'refresh' : 'music')}</i>` : ''}</div>
        <div class="yt-text"><span class="yt-title">${esc(r.title)}</span><span class="yt-meta">${esc(r.channel)}${playing ? ' · Playing preview' : loading ? ' · Loading preview…' : ''}</span></div></div>`);
    });
    list.innerHTML = rows.join('');
    const selEl = list.querySelector('.sel');
    if (selEl) selEl.scrollIntoView({ block: 'nearest' });
  };
  const current = () => results && results[sel - TOP];
  const stopPreview = () => {
    if (preview) { preview.audio.pause(); preview = null; Music.resume(); }
    loadingPreview = null;
  };
  const togglePreview = async () => {
    const r = current();
    if (!r) return;
    sfx('accept');
    const same = preview && preview.id === r.id;
    stopPreview();
    if (same) { render(); return; }
    loadingPreview = r.id;
    render();
    const url = await api.songStream(r.url);
    if (loadingPreview !== r.id || !p.node.isConnected) return; // moved on meanwhile
    loadingPreview = null;
    if (!url) { toast({ title: 'Preview not available', body: r.title, ico: 'x', sound: false, error: true }); render(); return; }
    Music.pause(300);
    const audio = new Audio(url);
    audio.volume = ctx.settings.muteAll ? 0 : (ctx.settings.masterVolume ?? 1) * (ctx.settings.gameMusicVolume ?? 0.4);
    audio.play().catch(() => {});
    preview = { audio, id: r.id };
    render();
  };
  const search = () => {
    results = null; error = '';
    render();
    api.searchSongs(term).then(r => {
      if (!p.node.isConnected) return;
      if (r.ok) results = r.results; else error = r.error;
      sel = results && results.length ? TOP : 0;
      render();
    });
  };
  const searchAgain = async () => {
    sfx('accept');
    const t = await textInput({ title: 'Search YouTube for', value: term });
    if (t && t.trim()) { stopPreview(); term = t.trim(); search(); }
  };
  const choose = async () => {
    if (sel === 0) { searchAgain(); return; }
    if (sel === 1) {
      sfx('accept');
      stopPreview();
      if (await pasteSongLink(g)) p.close(true);
      return;
    }
    const r = current();
    if (!r) return;
    sfx('accept');
    stopPreview();
    p.close(true);
    useSongLink(g, r.url, r.title);
  };
  list.addEventListener('click', e => {
    const it = e.target.closest('[data-i]');
    if (it) { sel = Number(it.dataset.i); render(); choose(); }
  });
  sfx('accept');
  search();
}

// ---------------- online image search ----------------
export function imageSearch(gameId, kind) {
  const g = gameById(gameId);
  const label = (KINDS.find(x => x.k === kind) || { label: kind }).label;
  const sources = [['official', 'Official Art'], ['steam', 'Steam Search'], ['web', 'Internet'], ['sgdb', 'SteamGridDB']];
  let src = 'official';
  let term = g.name;
  let results = null;   // [{ url, thumb, title }] or [{ sgdb, title }]
  let message = '';
  let sgdbGame = null;  // SteamGridDB game whose images are listed
  let page = 0;
  let more = false;     // another page can be loaded
  let loading = false;
  let webNext;          // Internet paging token (undefined = not started)
  const p = openPanel(`<div class="isearch"><h1>Choose ${esc(label)}</h1>
      <div class="is-bar"><div class="is-tabs"></div><div class="is-term"></div><div class="is-count"></div></div>
      <div class="is-grid kind-${kind}"></div></div>
    <div class="hints">${hintsHtml([['l1', ''], ['r1', 'Source'], ['triangle', 'Search Term'], ['cross', 'Choose'], ['circle', 'Back']])}</div>`, {
    handle(a) {
      if (a === 'l1' || a === 'r1') {
        const i = sources.findIndex(s => s[0] === src);
        src = sources[(i + (a === 'l1' ? -1 : 1) + sources.length) % sources.length][0];
        sfx('move');
        load();
        return true;
      }
      if (a === 'triangle') { changeTerm(); return true; }
      if (['up', 'down', 'left', 'right'].includes(a)) {
        f.move(a);
        // reaching the last row loads the next page by itself
        if (more && !loading && f.cur && f.cur.dataset.f === 'more') loadMore();
        return true;
      }
      if (a === 'accept') { choose(f.cur); return true; }
    },
  });
  const root = p.node.querySelector('.isearch');
  const grid = root.querySelector('.is-grid');
  const f = focusable(grid);
  const itemHtml = (r, i) => `<div class="is-item" data-f="${i}">${r.url || r.thumb ? `<img src="${esc(r.thumb || r.url)}" loading="lazy" data-gone=".is-item" data-gone-hide="1">` : ''}${r.title ? `<span>${esc(r.title)}</span>` : ''}</div>`;
  const render = (keepFocus = false) => {
    root.querySelector('.is-tabs').innerHTML = sources.map(([k, l]) => `<span class="${k === src ? 'on' : ''}">${l}</span>`).join('');
    root.querySelector('.is-term').innerHTML = src === 'official' ? `${icon('image')} ${esc(g.name)}` : `${icon('search')} ${esc(term)}${sgdbGame ? ` › ${esc(sgdbGame.title)}` : ''}`;
    root.querySelector('.is-count').textContent = results && results.length && !results[0].sgdb ? `${results.length} image${results.length === 1 ? '' : 's'}` : '';
    if (!results) { grid.innerHTML = `<div class="pick-status">${esc(message || 'Searching…')}</div>`; return; }
    const key = keepFocus && f.cur ? f.cur.dataset.f : null;
    grid.innerHTML = results.length
      ? results.map(itemHtml).join('') + (more ? `<div class="is-item is-more" data-f="more">${icon('plus')}<span>${loading ? 'Loading…' : src === 'official' || src === 'steam' ? 'More from the Internet' : 'Load More'}</span></div>` : '')
      : `<div class="pick-status">${esc(message || `Nothing found. Press ${padText('triangle')} to try another name.`)}</div>`;
    if (key) f.refocus(key); else f.first();
  };
  const linkedAppId = async () => {
    if (g.meta && g.meta.steamAppId) return g.meta.steamAppId;
    const r = await api.searchSteam(term);
    return r[0] && r[0].appId;
  };
  const load = async () => {
    results = null;
    message = '';
    sgdbGame = null;
    page = 0;
    more = false;
    webNext = undefined;
    render();
    try {
      if (src === 'web') {
        results = await loadWebPage();
        if (!results.length) message = `No pictures found on the internet. Press ${padText('triangle')} to try another name.`;
      } else if (src === 'official') {
        const appId = await linkedAppId();
        results = appId ? (await api.steamArtwork(appId)).filter(x => x.kinds.includes(kind)) : [];
        if (!results.length) message = appId ? 'Steam has no official art of this kind. Try SteamGridDB.' : 'This game isn\'t linked to Steam. Use Download Metadata first, or try SteamGridDB.';
      } else if (src === 'steam') {
        if (kind === 'icon') { results = []; message = 'Steam search has no icons. Try Official Art or SteamGridDB.'; }
        else {
          const field = kind === 'tile' ? 'hero' : kind;
          results = (await api.searchSteam(term)).map(r => ({ url: r[field], title: r.name }));
        }
      } else if (!ctx.settings.sgdbKey) {
        results = [];
        message = 'SteamGridDB has thousands of community covers, wallpapers, logos and icons. It needs a free API key: add it in Settings › Library.';
      } else {
        results = (await api.searchSgdb(term)).slice(0, 15).map(x => ({ sgdb: x.id, title: `${x.name}${x.year ? ` (${x.year})` : ''}` }));
      }
    } catch (e) {
      results = [];
      message = `Search failed: ${e.message}`;
    }
    // Official Art and Steam Search can keep going with pictures from the internet
    if ((src === 'official' || src === 'steam') && kind !== 'icon') more = true;
    render();
  };
  const loadWebPage = async () => {
    const r = await api.webImages(term, kind, webNext || null);
    webNext = r.next;
    more = !!r.next;
    return r.items.map(x => ({ url: x.url, thumb: x.thumb, referer: x.referer, title: `${x.width}×${x.height}` }));
  };
  const loadSgdbPage = async () => {
    const list = await api.sgdbImages(sgdbGame.id, kind, page);
    more = list.length >= 20;
    return list.map(x => ({ url: x.url, thumb: x.thumb, title: `${x.width}×${x.height}` }));
  };
  const loadMore = async () => {
    if (loading || !results) return;
    if (src === 'sgdb' && !sgdbGame) return;
    loading = true;
    render(true);
    try {
      if (src === 'sgdb') { page++; results = results.concat(await loadSgdbPage()); }
      else results = results.concat(await loadWebPage());
    } catch (e) { more = false; toast({ title: 'Could not load more', body: e.message, ico: 'x', error: true }); }
    loading = false;
    render(true);
  };
  const changeTerm = async () => {
    const t = await textInput({ title: 'Search for', value: term });
    if (t) { term = t; if (src === 'official') src = 'steam'; load(); }
  };
  const choose = async n => {
    if (!n || !results) return;
    if (n.dataset.f === 'more') { sfx('accept'); loadMore(); return; }
    const r = results[Number(n.dataset.f)];
    if (!r) return;
    sfx('accept');
    if (r.sgdb) {
      sgdbGame = { id: r.sgdb, title: r.title };
      page = 0;
      results = null;
      render();
      try { results = await loadSgdbPage(); if (!results.length) message = 'No images of this kind for that game yet.'; } catch (e) { results = []; message = e.message; }
      render();
      return;
    }
    p.close(true);
    toast({ id: 'img', title: 'Downloading image…', body: g.name, ico: 'image', duration: 0 });
    try {
      await api.setImage(g.id, kind, { url: r.url, referer: r.referer });
      toast({ id: 'img', title: `${label} updated`, body: g.name, ico: 'image', sound: false });
    } catch (e) {
      toast({ id: 'img', title: 'Download failed', body: e.message, ico: 'x', sound: false, error: true });
    }
  };
  grid.addEventListener('click', e => { const n = e.target.closest('[data-f]'); if (n) { f.set(n); choose(n); } });
  load();
}

// ---------------- avatar picker ----------------
export function avatarPicker() {
  const choices = ctx.state.games.filter(g => !g.hidden).map(g => {
    const kind = ['tile', 'cover', 'hero', 'icon'].find(k => g.media[k]);
    return kind ? { g, file: `${ctx.state.mediaDir}/${g.id}/${g.media[kind]}`, url: media(g, kind + 'Thumb') || media(g, kind) } : null;
  }).filter(Boolean);
  const p = openPanel(`<div class="isearch"><h1>Choose Your Avatar</h1><div class="sub">Pick a picture from your PC, or use art from one of your games.</div>
      <div class="is-grid kind-avatar"><div class="is-item pc" data-f="pc">${icon('folder')}<span>From your PC…</span></div>
      ${choices.map((c, i) => `<div class="is-item" data-f="${i}"><img src="${esc(c.url)}"><span>${esc(c.g.name)}</span></div>`).join('')}</div></div>
    <div class="hints">${hintsHtml([['cross', 'Choose'], ['circle', 'Back']])}</div>`, {
    handle(a) {
      if (['up', 'down', 'left', 'right'].includes(a)) { f.move(a); return true; }
      if (a === 'accept') { pick(f.cur); return true; }
    },
  });
  const grid = p.node.querySelector('.is-grid');
  const f = focusable(grid);
  const pick = async n => {
    if (!n) return;
    sfx('accept');
    let file;
    if (n.dataset.f === 'pc') file = await api.openFile({ title: 'Choose an avatar', filters: IMG });
    else file = choices[Number(n.dataset.f)].file;
    if (!file) return;
    await api.setAvatar(file);
    p.close(true);
    toast({ title: 'Avatar updated', body: ctx.settings.profileName, ico: 'user' });
  };
  grid.addEventListener('click', e => { const n = e.target.closest('[data-f]'); if (n) { f.set(n); pick(n); } });
  f.first();
  sfx('accept');
}

export async function renameProfile() {
  const name = await textInput({ title: 'Your name', value: ctx.settings.profileName });
  if (name) { await api.updateSettings({ profileName: name }); toast({ title: 'Name changed', body: name, ico: 'user' }); }
}

// ---------------- screenshots & art gallery ----------------
// Every official picture of the game, full screen; OPTIONS uses the one on screen as wallpaper, banner, cover or tile.
export async function gallery(gameId) {
  const g = gameById(gameId);
  let items = null;
  let i = 0;
  const p = openPanel(`<div class="gallery">
      <div class="gal-stage"><img class="gal-img" alt=""><div class="pick-status gal-msg">Loading pictures…</div></div>
      <div class="gal-info"><span class="gal-title"></span><span class="gal-count"></span></div>
      <div class="gal-strip"></div></div>
    <div class="hints">${hintsHtml([['left', ''], ['right', 'Browse'], ['options', 'Use As…'], ['circle', 'Back']])}</div>`, {
    handle(a) {
      if (!items || !items.length) return a !== 'back';
      if (a === 'left' || a === 'right' || a === 'l1' || a === 'r1' || a === 'wheel-up' || a === 'wheel-down') {
        const d = a === 'left' || a === 'l1' || a === 'wheel-up' ? -1 : 1;
        if (!items[i + d]) { sfx('bump'); return true; }
        i += d;
        sfx('move');
        show();
        return true;
      }
      if (a === 'options' || a === 'accept') { useAs(); return true; }
    },
  });
  const root = p.node.querySelector('.gallery');
  const img = root.querySelector('.gal-img');
  const show = () => {
    const it = items[i];
    img.classList.remove('in');
    const next = new Image();
    next.onload = () => { if (items[i] === it) { img.src = it.url; img.classList.add('in'); } };
    next.onerror = () => { if (items[i] === it) { img.src = it.thumb || it.url; img.classList.add('in'); } };
    next.src = it.url;
    root.querySelector('.gal-title').textContent = it.title;
    root.querySelector('.gal-count').textContent = `${i + 1} / ${items.length}`;
    root.querySelectorAll('.gal-strip img').forEach((t, n) => t.classList.toggle('on', n === i));
    const on = root.querySelector('.gal-strip img.on');
    if (on) on.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  };
  const useAs = () => {
    const it = items[i];
    const kinds = [['background', 'Wallpaper'], ['hero', 'Banner'], ['cover', 'Cover Image'], ['tile', 'Console Tile'], ['logo', 'Logo'], ['icon', 'Icon']].filter(([k]) => it.kinds.includes(k));
    import('./ui.js').then(({ openOptions }) => openOptions({
      title: it.title,
      items: kinds.map(([k, l]) => ({ label: `Use as ${l}`, icon: 'image', action: async () => {
        toast({ id: 'img', title: 'Downloading image…', body: g.name, ico: 'image', duration: 0 });
        try { await api.setImage(g.id, k, { url: it.url }); toast({ id: 'img', title: `${l} updated`, body: g.name, ico: 'image', sound: false }); }
        catch (e) { toast({ id: 'img', title: 'Download failed', body: e.message, ico: 'x', sound: false, error: true }); }
      } })),
    }));
  };
  sfx('accept');
  const appId = g.meta && g.meta.steamAppId;
  try { items = appId ? await api.steamArtwork(appId) : []; } catch { items = []; }
  // keep the wide pictures (key art, backgrounds, screenshots); covers/logos are in Edit Game Details
  items = items.filter(x => x.kinds.includes('background') || x.kinds.includes('hero'));
  if (!items.length) { root.querySelector('.gal-msg').textContent = appId ? 'No pictures found.' : 'Link this game to Steam (Download Metadata) to see its pictures.'; return; }
  root.querySelector('.gal-msg').remove();
  root.querySelector('.gal-strip').innerHTML = items.map(x => `<img src="${esc(x.thumb || x.url)}" loading="lazy">`).join('');
  root.querySelector('.gal-strip').addEventListener('click', e => {
    const t = e.target.closest('img');
    if (!t) return;
    i = [...root.querySelectorAll('.gal-strip img')].indexOf(t);
    sfx('move');
    show();
  });
  show();
}

// ---------------- adjust size & position ----------------
// The image is shown in the exact frame it's used in (cover 2:3, tile square, wallpaper 16:9…).
const FRAMES = { cover: 2 / 3, tile: 1, hero: 31 / 10, background: 16 / 9, logo: 16 / 7, icon: 1 };

export function adjustArt(gameId, kind) {
  const g = gameById(gameId);
  const label = (KINDS.find(x => x.k === kind) || { label: kind }).label;
  const start = (g.artAdjust || {})[kind] || {};
  let a = { z: start.z || 1, x: start.x || 0, y: start.y || 0, fit: start.fit || 'cover' };
  const url = media(g, kind);
  const p = openPanel(`<div class="adjust">
      <h1>Adjust ${esc(label)}</h1><div class="sub">${esc(g.name)}</div>
      <div class="adj-body">
        <div class="adj-frame kind-${kind}" style="aspect-ratio:${FRAMES[kind] || 1}"><img src="${url}" draggable="false"></div>
        <div class="adj-info">
          <div><span>Zoom</span><b class="v-z"></b></div>
          <div><span>Left / Right</span><b class="v-x"></b></div>
          <div><span>Up / Down</span><b class="v-y"></b></div>
          <div><span>Mode</span><b class="v-fit"></b></div>
          <p>Move the picture with the d-pad (or drag it), zoom with L1 / R1 (or the mouse wheel).</p>
        </div>
      </div></div>
    <div class="hints">${hintsHtml([['l1', ''], ['r1', 'Zoom'], ['square', 'Fill / Fit'], ['triangle', 'Reset'], ['cross', 'Save'], ['circle', 'Cancel']])}</div>`, {
    handle(act, info) {
      const step = info && info.repeat ? 1 : 2;
      if (act === 'left') move(-step, 0);
      else if (act === 'right') move(step, 0);
      else if (act === 'up') move(0, -step);
      else if (act === 'down') move(0, step);
      else if (act === 'l1' || act === 'l2' || act === 'wheel-down') zoom(-0.05);
      else if (act === 'r1' || act === 'r2' || act === 'wheel-up') zoom(0.05);
      else if (act === 'square') { a.fit = a.fit === 'cover' ? 'contain' : 'cover'; sfx('move'); show(); }
      else if (act === 'triangle') { a = { z: 1, x: 0, y: 0, fit: 'cover' }; sfx('back'); show(); }
      else if (act === 'accept') { save(); }
      else return false;
      return true;
    },
  });
  const frame = p.node.querySelector('.adj-frame');
  const img = frame.querySelector('img');
  const show = () => {
    img.style.cssText = adjustStyle(a);
    p.node.querySelector('.v-z').textContent = `${Math.round(a.z * 100)}%`;
    p.node.querySelector('.v-x').textContent = `${a.x > 0 ? '+' : ''}${Math.round(a.x)}%`;
    p.node.querySelector('.v-y').textContent = `${a.y > 0 ? '+' : ''}${Math.round(a.y)}%`;
    p.node.querySelector('.v-fit').textContent = a.fit === 'cover' ? 'Fill the frame' : 'Fit whole picture';
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const move = (dx, dy) => { a.x = clamp(a.x + dx, -100, 100); a.y = clamp(a.y + dy, -100, 100); show(); };
  const zoom = d => { a.z = clamp(Math.round((a.z + d) * 100) / 100, a.fit === 'cover' ? 1 : 0.3, 4); sfx('move'); show(); };
  const save = async () => {
    sfx('accept');
    const isDefault = a.z === 1 && !a.x && !a.y && a.fit === 'cover';
    await api.updateGame(g.id, { artAdjust: { [kind]: isDefault ? null : { ...a } } });
    p.close(true);
    toast({ title: `${label} adjusted`, body: g.name, ico: 'crop' });
  };
  // mouse: drag to move, wheel to zoom
  let drag = null;
  frame.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, ax: a.x, ay: a.y }; });
  window.addEventListener('mousemove', e => {
    if (!drag) return;
    const r = frame.getBoundingClientRect();
    a.x = clamp(drag.ax + ((e.clientX - drag.x) / r.width) * 100, -100, 100);
    a.y = clamp(drag.ay + ((e.clientY - drag.y) / r.height) * 100, -100, 100);
    show();
  });
  window.addEventListener('mouseup', () => { drag = null; });
  frame.addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY < 0 ? 0.05 : -0.05); }, { passive: false });
  show();
  sfx('accept');
}

// ---------------- adjust the home-screen tile ----------------
// Frames the picture inside the square tile exactly as the home row shows it, and can move/resize the logo.
export function adjustTile(gameId) {
  const g = gameById(gameId);
  const adj0 = g.artAdjust || {};
  const pic = { z: 1, x: 0, y: 0, fit: 'cover', ...(adj0.tileArt || {}) };
  const logo = { z: 1, x: 0, y: 0, ...(adj0.tileLogo || {}) };
  const hasLogo = !!(media(g, 'logo') && !media(g, 'tile') && ctx.settings.tileStyle !== 'cover' && media(g, 'hero'));
  let layer = 'picture';
  const p = openPanel(`<div class="adjust">
      <h1>Adjust Tile</h1><div class="sub">${esc(g.name)} · how it looks on the home screen</div>
      <div class="adj-body">
        <div class="adj-frame tile-frame"><div class="art"></div></div>
        <div class="adj-info">
          <div class="adj-layer"></div>
          <div><span>Zoom</span><b class="v-z"></b></div>
          <div><span>Left / Right</span><b class="v-x"></b></div>
          <div><span>Up / Down</span><b class="v-y"></b></div>
          <div><span>Picture mode</span><b class="v-fit"></b></div>
          <div class="adj-small"><span>In the row</span><div class="mini-tile"><div class="art"></div></div></div>
        </div>
      </div></div>
    <div class="hints">${hintsHtml([['l1', ''], ['r1', 'Zoom'], ...(hasLogo ? [['square', 'Picture / Logo']] : []), ['options', 'Fill / Fit'], ['triangle', 'Reset'], ['cross', 'Save'], ['circle', 'Cancel']])}</div>`, {
    handle(a, info) {
      const step = info && info.repeat ? 1 : 2;
      if (a === 'left') move(-step, 0);
      else if (a === 'right') move(step, 0);
      else if (a === 'up') move(0, -step);
      else if (a === 'down') move(0, step);
      else if (a === 'l1' || a === 'l2' || a === 'wheel-down') zoom(-0.05);
      else if (a === 'r1' || a === 'r2' || a === 'wheel-up') zoom(0.05);
      else if (a === 'square' && hasLogo) { layer = layer === 'picture' ? 'logo' : 'picture'; sfx('move'); show(); }
      else if (a === 'options') { pic.fit = pic.fit === 'cover' ? 'contain' : 'cover'; sfx('move'); show(); }
      else if (a === 'triangle') { Object.assign(cur(), { z: 1, x: 0, y: 0 }, layer === 'picture' ? { fit: 'cover' } : {}); sfx('back'); show(); }
      else if (a === 'accept') save();
      else return false;
      return true;
    },
  });
  const cur = () => (layer === 'picture' ? pic : logo);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const isDefault = o => o.z === 1 && !o.x && !o.y && (!o.fit || o.fit === 'cover');
  const preview = () => ({ ...g, artAdjust: { ...adj0, tileArt: isDefault(pic) ? null : pic, tileLogo: isDefault(logo) ? null : logo } });
  const show = () => {
    const html = gameArt(preview());
    p.node.querySelectorAll('.art').forEach(n => { n.innerHTML = html; });
    const c = cur();
    p.node.querySelector('.adj-layer').innerHTML = `<span>Editing</span><b>${layer === 'picture' ? 'Picture' : 'Logo'}</b>`;
    p.node.querySelector('.v-z').textContent = `${Math.round(c.z * 100)}%`;
    p.node.querySelector('.v-x').textContent = `${c.x > 0 ? '+' : ''}${Math.round(c.x)}%`;
    p.node.querySelector('.v-y').textContent = `${c.y > 0 ? '+' : ''}${Math.round(c.y)}%`;
    p.node.querySelector('.v-fit').textContent = pic.fit === 'cover' ? 'Fill the tile' : 'Fit whole picture';
    p.node.querySelector('.tile-frame').classList.toggle('logo-layer', layer === 'logo');
  };
  const move = (dx, dy) => { const c = cur(); c.x = clamp(c.x + dx, -100, 100); c.y = clamp(c.y + dy, -100, 100); show(); };
  const zoom = d => { const c = cur(); c.z = clamp(Math.round((c.z + d) * 100) / 100, c === pic && pic.fit === 'cover' ? 1 : 0.3, 4); sfx('move'); show(); };
  const save = async () => {
    sfx('accept');
    await api.updateGame(g.id, { artAdjust: { tileArt: isDefault(pic) ? null : { ...pic }, tileLogo: isDefault(logo) ? null : { ...logo } } });
    p.close(true);
    toast({ title: 'Tile adjusted', body: g.name, ico: 'crop' });
  };
  // mouse: drag moves the current layer, wheel zooms it
  const frame = p.node.querySelector('.tile-frame');
  let drag = null;
  frame.addEventListener('mousedown', e => { const c = cur(); drag = { x: e.clientX, y: e.clientY, ax: c.x, ay: c.y }; });
  window.addEventListener('mousemove', e => {
    if (!drag || !p.node.isConnected) return;
    const r = frame.getBoundingClientRect();
    const c = cur();
    c.x = clamp(drag.ax + ((e.clientX - drag.x) / r.width) * 100, -100, 100);
    c.y = clamp(drag.ay + ((e.clientY - drag.y) / r.height) * 100, -100, 100);
    show();
  });
  window.addEventListener('mouseup', () => { drag = null; });
  frame.addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY < 0 ? 0.05 : -0.05); }, { passive: false });
  show();
  sfx('accept');
}
