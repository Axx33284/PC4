// Capture Gallery, like the PS4's: every screenshot and clip, sorted by game. Pictures open full screen,
// clips play; △ deletes (to the Recycle Bin) or shows the file in its folder.
import { ctx, api, el, pushLayer, removeLayer, hintsHtml } from './core.js';
import { sfx, Music } from './sound.js';
import { esc, icon, fileUrl } from '../common/util.js';
import { openOptions, confirmDialog, toast, raise } from './ui.js';
import { fmtTime } from './player.js';

const COLS = 4;
let open_ = false;
const thumbs = new Map();

export async function openGallery() {
  if (open_) return;
  open_ = true;
  sfx('accept');
  const node = el(`<div class="layer app-screen gallery-app"><div class="as-head">${icon('gallery')}<h1>Capture Gallery</h1><div class="md-path"></div></div>
    <div class="md-body"><div class="md-side"></div><div class="md-main"><div class="md-grid gl-grid"></div></div></div>
    <div class="hints">${hintsHtml([['cross', 'View'], ['triangle', 'Options'], ['circle', 'Back']])}</div></div>`);
  document.body.appendChild(raise(node));
  requestAnimationFrame(() => node.classList.add('in'));
  const side = node.querySelector('.md-side'), grid = node.querySelector('.md-grid');
  let all = [], groups = [], g = 0, zone = 'grid', sel = 0;

  const shown = () => (g === 0 ? all : all.filter(x => x.game === groups[g].name));
  const load = async () => {
    all = await api.listCaptures();
    const names = [...new Set(all.map(x => x.game))];
    groups = [{ name: 'All', n: all.length }, ...names.map(n => ({ name: n, n: all.filter(x => x.game === n).length }))];
    g = Math.min(g, groups.length - 1);
    render();
  };
  const when = t => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  const render = () => {
    side.innerHTML = groups.map((x, i) => `<div class="md-src ${i === g ? 'on' : ''} ${zone === 'side' && i === g ? 'sel focus-ring' : ''}" data-s="${i}">${icon(i ? 'gamepad' : 'gallery')}<span>${esc(x.name)}</span><em>${x.n}</em></div>`).join('');
    const list = shown();
    sel = Math.min(sel, Math.max(0, list.length - 1));
    node.querySelector('.md-path').textContent = `${list.length} capture${list.length === 1 ? '' : 's'}`;
    grid.innerHTML = list.length ? list.map((c, i) => `<div class="md-item gl-item ${zone === 'grid' && i === sel ? 'sel focus-ring' : ''}" data-i="${i}">
      <div class="md-th" data-th="${i}">${c.kind === 'screenshot' ? `<img src="${fileUrl(c.file)}" loading="lazy" decoding="async" alt="">` : icon('film')}${c.kind === 'video' ? `<span class="gl-vid">${icon('playFill')}</span>` : ''}</div>
      <div class="md-name">${esc(c.game)}<small>${when(c.time)}</small></div></div>`).join('')
      : `<div class="pick-status">No captures yet. Press SHARE for a screenshot, or hold it to record a clip — also during games.</div>`;
    grid.querySelectorAll('[data-th]').forEach(th => {
      const c = list[Number(th.dataset.th)];
      if (!c || c.kind !== 'video') return;
      const done = url => { if (url && th.isConnected) th.insertAdjacentHTML('afterbegin', `<img src="${url}" alt="">`); };
      if (thumbs.has(c.file)) done(thumbs.get(c.file)); else api.captureThumb(c.file).then(u => { thumbs.set(c.file, u); done(u); });
    });
    const s = grid.querySelector('.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
  };

  const options = () => {
    const c = zone === 'grid' ? shown()[sel] : null;
    openOptions({
      title: 'Capture Gallery',
      items: [
        c && { label: 'Delete', icon: 'trash', action: async () => {
          if (!(await confirmDialog('Delete Capture', `Move this ${c.kind === 'video' ? 'clip' : 'screenshot'} to the Recycle Bin?`, 'Delete'))) return;
          await api.deleteCapture(c.file); toast({ title: 'Moved to the Recycle Bin', ico: 'trash' }); load();
        } },
        c && { label: 'Show in Folder', icon: 'folder', action: () => api.showCapture(c.file) },
        { label: 'Take a Screenshot Now', icon: 'camera', action: () => api.screenshot().then(load) },
        { label: 'Open Captures Folder', icon: 'folder', action: () => api.showCapture('') },
        { label: 'Refresh', icon: 'refresh', action: () => load() },
      ].filter(Boolean),
    });
  };

  const layer = {
    handle(a) {
      if (zone === 'side') {
        if (a === 'up' || a === 'wheel-up') { if (g > 0) { g--; sel = 0; sfx('move'); render(); } }
        else if (a === 'down' || a === 'wheel-down') { if (g < groups.length - 1) { g++; sel = 0; sfx('move'); render(); } }
        else if (a === 'right' || a === 'accept') { zone = 'grid'; sfx('move'); render(); }
        else if (a === 'triangle') options();
        else if (a === 'back' || a === 'home') close();
        return;
      }
      const list = shown();
      const move = d => { const k = sel + d; if (k >= 0 && k < list.length) { sel = k; sfx('move'); render(); } };
      if (a === 'left') { if (sel % COLS) move(-1); else { zone = 'side'; sfx('move'); render(); } }
      else if (a === 'right') { if (sel % COLS < COLS - 1) move(1); }
      else if (a === 'up' || a === 'wheel-up') move(-COLS);
      else if (a === 'down' || a === 'wheel-down') move(Math.min(COLS, list.length - 1 - sel));
      else if (a === 'accept' && list[sel]) viewer(list, sel, load);
      else if (a === 'triangle') options();
      else if (a === 'back' || a === 'home') close();
    },
  };
  const close = () => {
    if (!open_) return;
    open_ = false;
    ctx.subs.delete(onState);
    removeLayer(layer);
    node.classList.remove('in');
    setTimeout(() => node.remove(), 300);
    sfx('back');
  };
  // new captures show up while the gallery is open
  let lastRec = ctx.state.recording;
  const onState = () => { if (lastRec !== ctx.state.recording) { lastRec = ctx.state.recording; setTimeout(load, 800); } };
  ctx.subs.add(onState);
  side.addEventListener('click', e => { const s = e.target.closest('[data-s]'); if (s) { g = Number(s.dataset.s); sel = 0; render(); } });
  grid.addEventListener('click', e => { const c = e.target.closest('[data-i]'); if (c) { zone = 'grid'; sel = Number(c.dataset.i); render(); viewer(shown(), sel, load); } });
  pushLayer(layer);
  render();
  load();
}

// full screen: a picture, or a clip that plays
function viewer(list, index, reload) {
  let i = index;
  Music.hold(300, 'video');
  const node = el(`<div class="layer vp gl-view"><div class="gl-stage"></div><div class="vp-ui show"><div class="vp-title"></div>
    <div class="vp-hints hints">${hintsHtml([['left', ''], ['right', 'Previous / Next'], ['cross', 'Play / Pause'], ['triangle', 'Options'], ['circle', 'Back']])}</div></div></div>`);
  document.body.appendChild(raise(node));
  const stage = node.querySelector('.gl-stage');
  const show = () => {
    const c = list[i];
    node.querySelector('.vp-title').textContent = `${c.game} · ${new Date(c.time).toLocaleString()}`;
    stage.innerHTML = c.kind === 'screenshot' ? `<img src="${fileUrl(c.file)}" alt="">` : `<video src="${fileUrl(c.file)}" autoplay controls></video>`;
    const v = stage.querySelector('video');
    if (v) v.volume = ctx.settings.muteAll ? 0 : (ctx.settings.masterVolume ?? 1);
  };
  const layer = {
    handle(a) {
      const v = stage.querySelector('video');
      if (a === 'left' || a === 'l1') { if (i > 0) { i--; sfx('move'); show(); } }
      else if (a === 'right' || a === 'r1') { if (i < list.length - 1) { i++; sfx('move'); show(); } }
      else if (a === 'accept' && v) { v.paused ? v.play() : v.pause(); }
      else if (a === 'triangle') {
        const c = list[i];
        openOptions({ title: 'Capture', items: [
          { label: 'Delete', icon: 'trash', action: async () => { if (await confirmDialog('Delete Capture', 'Move it to the Recycle Bin?', 'Delete')) { await api.deleteCapture(c.file); close(); reload(); } } },
          { label: 'Show in Folder', icon: 'folder', action: () => api.showCapture(c.file) },
        ] });
      } else if (a === 'back' || a === 'home') close();
    },
  };
  const close = () => { const v = stage.querySelector('video'); if (v) v.pause(); removeLayer(layer); node.remove(); Music.release('video'); sfx('back'); };
  pushLayer(layer);
  show();
}
export { fmtTime };
