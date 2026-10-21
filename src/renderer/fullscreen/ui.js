// Console-mode building blocks: options side menu, dialogs, notifications, on-screen keyboard.
import { ctx, el, pushLayer, removeLayer, hintsHtml, padText } from './core.js';
import { esc, icon } from '../common/util.js';
import { sfx } from './sound.js';

const overlayRoot = () => document.getElementById('overlays');

// Whatever opens last sits on top: menus, keyboards and dialogs over the Quick Menu and the full-screen apps
let zTop = 100;
export function raise(node) { node.style.zIndex = String(++zTop); return node; }

function mountLayer(node) {
  raise(node);
  overlayRoot().appendChild(node);
  requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('open')));
}

function unmountLayer(node) {
  node.classList.remove('open');
  setTimeout(() => node.remove(), 350);
}

// keeps the selected row in view inside a clipped list
// Keeps the selected row inside a list that moves by transform, with room around its focus frame; a section
// title right above the row comes along, and the first / last rows snap to the very top / bottom.
export function scrollIntoList(inner, rowEl, viewH, pad = 0) {
  if (!rowEl) return;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
  pad = Math.max(pad, rem * 2.4);
  const cur = -(parseFloat(inner.dataset.off || '0'));
  const prev = rowEl.previousElementSibling;
  const head = prev && prev.classList && (prev.classList.contains('set-section') || prev.classList.contains('qm-sec')) ? prev : null;
  const top = (head || rowEl).offsetTop;
  const bottom = rowEl.offsetTop + rowEl.offsetHeight;
  const first = !(head || rowEl).previousElementSibling;
  const last = !rowEl.nextElementSibling;
  const max = Math.max(0, inner.scrollHeight - viewH + pad);
  let off = cur;
  if (first) off = 0;
  else if (top - pad < off) off = Math.max(0, top - pad);
  else if (bottom + pad > off + viewH) off = bottom + pad - viewH;
  if (last) off = Math.min(max, Math.max(off, bottom + pad - viewH));
  inner.dataset.off = String(-off);
  inner.style.transform = `translateY(${-off}px)`;
}

// Picks the nearest element in a direction (d-pad navigation for free-form layouts)
export function spatialMove(items, cur, dir) {
  const a = cur.getBoundingClientRect();
  const ac = { x: a.left + a.width / 2, y: a.top + a.height / 2 };
  let best = null;
  let bestScore = Infinity;
  for (const n of items) {
    if (n === cur) continue;
    const b = n.getBoundingClientRect();
    if (!b.width) continue;
    const bc = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    let main;
    let cross;
    if (dir === 'left') { if (b.right > a.left + 2) continue; main = ac.x - bc.x; cross = Math.abs(bc.y - ac.y); }
    else if (dir === 'right') { if (b.left < a.right - 2) continue; main = bc.x - ac.x; cross = Math.abs(bc.y - ac.y); }
    else if (dir === 'up') { if (b.bottom > a.top + 2) continue; main = ac.y - bc.y; cross = Math.abs(bc.x - ac.x); }
    else { if (b.top < a.bottom - 2) continue; main = bc.y - ac.y; cross = Math.abs(bc.x - ac.x); }
    const score = main + cross * 2.2;
    if (score < bestScore) { bestScore = score; best = n; }
  }
  return best;
}

// ---------------- options side menu ----------------
export function openOptions({ title = '', items, onClose }) {
  const node = el(`<div class="layer"><div class="opt-shade"></div><div class="opt-panel">
    ${title ? `<div class="opt-title">${esc(title)}</div>` : ''}
    <div class="opt-list"><div class="inner"></div></div></div></div>`);
  const inner = node.querySelector('.inner');
  const list = node.querySelector('.opt-list');
  let sel = Math.max(0, items.findIndex(i => !i.disabled));
  const render = () => {
    inner.innerHTML = items.map((it, i) => `<div class="opt-item ${i === sel ? 'sel focus-ring' : ''} ${it.disabled ? 'disabled' : ''}" data-i="${i}">
      ${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}</span>${it.value ? `<span class="val">${esc(it.value)}</span>` : ''}</div>`).join('');
    scrollIntoList(inner, inner.children[sel], list.clientHeight, 20);
  };
  const close = (silent) => {
    removeLayer(layer);
    unmountLayer(node);
    if (!silent) sfx('back');
    if (onClose) onClose();
  };
  const activate = () => {
    const it = items[sel];
    if (!it || it.disabled) { sfx('bump'); return; }
    sfx('accept');
    removeLayer(layer);
    unmountLayer(node);
    if (it.action) it.action();
  };
  const move = d => {
    let n = sel;
    do { n += d; } while (items[n] && items[n].disabled);
    if (!items[n]) { sfx('bump'); return; }
    sel = n; sfx('move'); render();
  };
  const layer = {
    handle(a) {
      if (a === 'up' || a === 'wheel-up') move(-1);
      else if (a === 'down' || a === 'wheel-down') move(1);
      else if (a === 'accept') activate();
      else if (a === 'back' || a === 'options') close();
    },
  };
  node.querySelector('.opt-shade').addEventListener('click', () => close());
  inner.addEventListener('click', e => {
    const row = e.target.closest('[data-i]');
    if (!row) return;
    sel = Number(row.dataset.i);
    activate();
  });
  mountLayer(node);
  render();
  sfx('options');
  pushLayer(layer);
  return { close };
}

// ---------------- dialog ----------------
export function showDialog({ title = '', message = '', buttons = [{ label: 'OK', value: true }], cancelValue = null, error = false }) {
  return new Promise(resolve => {
    const node = el(`<div class="layer"><div class="dlg-shade"></div><div class="dlg">
      ${title ? `<h2>${esc(title)}</h2>` : ''}<div class="msg">${esc(message)}</div><div class="btns"></div></div></div>`);
    const btns = node.querySelector('.btns');
    let sel = 0;
    const render = () => {
      btns.innerHTML = buttons.map((b, i) => `<div class="btn ${i === sel ? 'sel focus-ring' : ''}" data-i="${i}">${esc(b.label)}</div>`).join('');
    };
    const finish = v => {
      removeLayer(layer);
      unmountLayer(node);
      resolve(v);
    };
    const layer = {
      handle(a) {
        if (a === 'up' || a === 'left') { if (sel > 0) { sel--; sfx('move'); render(); } else sfx('bump'); }
        else if (a === 'down' || a === 'right') { if (sel < buttons.length - 1) { sel++; sfx('move'); render(); } else sfx('bump'); }
        else if (a === 'accept') { sfx('accept'); finish(buttons[sel].value); }
        else if (a === 'back') { sfx('back'); finish(cancelValue); }
      },
    };
    btns.addEventListener('click', e => {
      const b = e.target.closest('[data-i]');
      if (b) { sfx('accept'); finish(buttons[Number(b.dataset.i)].value); }
    });
    mountLayer(node);
    render();
    sfx(error ? 'error' : 'options');
    pushLayer(layer);
  });
}

// "Press a key": the next key (or key combination, for shortcuts that work during games) is the answer.
// Every key counts, Esc included, so it gives up by itself after a few seconds (or with ○ on the controller).
// read(e) -> a value to finish with, undefined to keep waiting (Ctrl held on its own…), or false: not usable.
export function keyCapture({ title, message, read, seconds = 6 }) {
  return new Promise(resolve => {
    const node = el(`<div class="layer"><div class="dlg-shade"></div><div class="dlg key-capture">
      <h2>${esc(title)}</h2><div class="msg">${esc(message)}</div>
      <div class="kc-live"><span class="kcap kc-wait">…</span></div>
      <div class="kc-time"><i></i></div></div></div>`);
    const live = node.querySelector('.kc-live');
    const bar = node.querySelector('.kc-time i');
    let timer = 0, done = false;
    const finish = v => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (ctx.input) ctx.input.capture = null;
      removeLayer(layer);
      unmountLayer(node);
      resolve(v);
    };
    const restart = () => {
      clearTimeout(timer);
      bar.style.transition = 'none'; bar.style.width = '100%';
      requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.transition = `width ${seconds}s linear`; bar.style.width = '0%'; }));
      timer = setTimeout(() => { sfx('back'); finish(null); }, seconds * 1000);
    };
    const layer = { handle(a, info) { if (a === 'back' && (!info || info.source !== 'key')) { sfx('back'); finish(null); } } };
    ctx.input.capture = e => {
      e.preventDefault();
      if (e.repeat) return;
      const v = read(e);
      if (v === undefined) { live.innerHTML = `<span class="kcap">${esc(e.key === 'Control' ? 'Ctrl' : e.key === 'Meta' ? 'Win' : e.key)}</span><span class="kcap kc-wait">…</span>`; restart(); return; }
      if (v === false) { sfx('error'); live.innerHTML = "<span class=\"kc-no\">Those keys can't be used (they type a character or belong to PC4)</span>"; restart(); return; }
      sfx('accept');
      finish(v);
    };
    mountLayer(node);
    sfx('options');
    pushLayer(layer);
    restart();
  });
}

export function confirmDialog(title, message, okLabel = 'OK') {
  return showDialog({ title, message, buttons: [{ label: okLabel, value: true }, { label: 'Cancel', value: false }], cancelValue: false });
}

// ---------------- notifications (top-left, like the PS4) ----------------
const toastMap = new Map();

function toastRoot() {
  let r = document.querySelector('.toasts');
  if (!r) { r = el('<div class="toasts"></div>'); document.body.appendChild(r); }
  return r;
}

export function toast({ id, title, body = '', ico = 'bell', img = null, progress = null, duration = 5200, sound = true, error = false }) {
  if (error) sfx('error');
  let t = id && toastMap.get(id);
  const fresh = !t;
  if (!t) {
    t = { node: el('<div class="toast"></div>') };
    toastRoot().appendChild(t.node);
    if (id) toastMap.set(id, t);
    requestAnimationFrame(() => requestAnimationFrame(() => t.node.classList.add('show')));
    if (sound) sfx('toast');
  }
  t.node.innerHTML = `<div class="t-ico">${img ? `<img src="${esc(img)}">` : icon(ico)}</div>
    <div style="flex:1;min-width:0"><div class="t-title">${esc(title)}</div>${body ? `<div class="t-body">${esc(body)}</div>` : ''}
    ${progress != null ? `<div class="t-prog"><i style="width:${Math.round(progress * 100)}%"></i></div>` : ''}</div>`;
  clearTimeout(t.timer);
  if (duration) t.timer = setTimeout(() => dismissToast(t, id), duration);
  return fresh;
}

function dismissToast(t, id) {
  t.node.classList.remove('show');
  setTimeout(() => t.node.remove(), 400);
  if (id) toastMap.delete(id);
}

// ---------------- on-screen keyboard (PS4 layout) ----------------
// Letters, symbols (L2+triangle) and accents (L3) pages; each key spans `w` of 10 columns.
const PAGES = {
  abc: ['1234567890', 'qwertyuiop', "asdfghjkl'", 'zxcvbnm,.?'],
  sym: ['1234567890', '!@#$%^&*()', '-_=+[]{};:', '"/\\|<>~`´§'],
  acc: ['àáâäãåæçèé', 'êëìíîïñòóô', 'öõøùúûüýÿß', '¡¿€£¥©®™°…'],
};
const FN_ROWS = [
  [{ k: 'shift', w: 1, tag: ['l2'] }, { k: 'sym', w: 1, tag: ['l2', 'triangle'] }, { k: 'acc', w: 1, tag: ['l3'] }, { k: 'space', w: 4, tag: ['triangle'] }, { k: null, w: 1 }, { k: 'del', w: 2, tag: ['square'] }],
  [{ k: 'down', w: 1 }, { k: 'up', w: 1 }, { k: 'left', w: 1, tag: ['l1'] }, { k: 'right', w: 1, tag: ['r1'] }, { k: null, w: 1 }, { k: 'clear', w: 1 }, { k: 'pad', w: 1, tag: ['r3'] }, { k: null, w: 1 }, { k: 'done', w: 2, tag: ['r2'] }],
];
const TAG_CLASS = { triangle: 'tri', square: 'sq' };

export function textInput({ title = 'Enter text', value = '', password = false } = {}) {
  return new Promise(resolve => {
    const node = el(`<div class="layer osk-layer"><div class="dlg-shade"></div><div class="osk">
      <div class="osk-title">${esc(title)}</div>
      <label class="osk-field">${icon('search')}<input type="${password ? 'password' : 'text'}" spellcheck="false" autocomplete="off"></label>
      <div class="osk-suggest"></div>
      <div class="osk-keys"></div>
      <div class="osk-typing hints">${hintsHtml([['cross', 'Done'], ['circle', 'Cancel']])}</div>
    </div></div>`);
    const input = node.querySelector('input');
    const keysEl = node.querySelector('.osk-keys');
    input.value = value;
    let page = 'abc';
    let shift = false;
    let r = 1;
    let col = 0.5; // column centre of the focused key, kept while moving up/down
    let rows = [];

    const build = () => {
      const chars = PAGES[page];
      rows = chars.map(line => [...line].map((ch, i) => ({ k: 'ch', ch, x: i, w: 1 })));
      for (const fr of FN_ROWS) {
        let x = 0;
        rows.push(fr.map(key => { const o = { ...key, x }; x += key.w; return o; }));
      }
    };
    const label = key => {
      if (key.k === 'ch') return esc(shift && page === 'abc' ? key.ch.toUpperCase() : key.ch);
      return {
        shift: `<span class="osk-shift ${shift ? 'on' : ''}">⇧</span>`,
        sym: page === 'sym' ? 'abc' : '@#:',
        acc: page === 'acc' ? 'abc' : 'à',
        space: 'Space', del: '⌫', down: '▼', up: '▲', left: '◀', right: '▶',
        clear: '…', pad: icon('gamepad'), done: 'Done',
      }[key.k] || '';
    };
    const keyAt = () => rows[r].find(k => col >= k.x && col < k.x + k.w) || rows[r][0];
    const render = () => {
      const cur = keyAt();
      keysEl.innerHTML = rows.map((row, ri) => `<div class="osk-row">${row.map(key => {
        const tag = key.tag ? `<i class="osk-tag ${TAG_CLASS[key.tag[key.tag.length - 1]] || ''}">${esc(key.tag.map(padText).join('+'))}</i>` : '';
        const cls = `osk-key k-${key.k || 'blank'} ${key === cur ? 'sel' : ''}`;
        return `<div class="${cls}" style="flex:${key.w}" data-r="${ri}" data-x="${key.x + key.w / 2}">${tag}${label(key)}</div>`;
      }).join('')}</div>`).join('');
    };
    const finish = v => {
      removeLayer(layer);
      unmountLayer(node);
      resolve(v);
    };
    const type = s => {
      const a = input.selectionStart ?? input.value.length;
      const b = input.selectionEnd ?? input.value.length;
      input.value = input.value.slice(0, a) + s + input.value.slice(b);
      input.setSelectionRange(a + s.length, a + s.length);
    };
    const del = () => {
      const a = input.selectionStart ?? input.value.length;
      const b = input.selectionEnd ?? input.value.length;
      if (a !== b) { input.value = input.value.slice(0, a) + input.value.slice(b); input.setSelectionRange(a, a); }
      else if (a > 0) { input.value = input.value.slice(0, a - 1) + input.value.slice(a); input.setSelectionRange(a - 1, a - 1); }
    };
    const caret = d => {
      const p = Math.max(0, Math.min(input.value.length, (input.selectionStart ?? 0) + d));
      input.setSelectionRange(p, p);
    };
    const setPage = p => { page = page === p ? 'abc' : p; build(); r = Math.min(r, rows.length - 1); render(); };
    const press = key => {
      sfx('key');
      switch (key.k) {
        case 'ch': type(shift && page === 'abc' ? key.ch.toUpperCase() : key.ch); if (shift) { shift = false; render(); } break;
        case 'shift': shift = !shift; render(); break;
        case 'sym': setPage('sym'); break;
        case 'acc': setPage('acc'); break;
        case 'space': type(' '); break;
        case 'del': del(); break;
        case 'left': caret(-1); break;
        case 'right': caret(1); break;
        case 'up': node.classList.remove('at-top'); break;
        case 'down': node.classList.add('at-top'); break;
        case 'clear': input.value = ''; break;
        case 'done': sfx('accept'); finish(input.value.trim()); break;
        default: break;
      }
    };
    const moveH = d => {
      const row = rows[r];
      let i = row.indexOf(keyAt());
      do { i += d; } while (row[i] && !row[i].k);
      if (!row[i]) { sfx('bump'); return; }
      col = row[i].x + row[i].w / 2;
      sfx('move');
      render();
    };
    const moveV = d => {
      let nr = r + d;
      while (rows[nr] && !(rows[nr].find(k => col >= k.x && col < k.x + k.w) || {}).k) nr += d;
      if (!rows[nr]) { sfx('bump'); return; }
      r = nr;
      sfx('move');
      render();
    };
    // typing on the real keyboard hides the on-screen one; using the controller brings it back
    const typing = on => node.classList.toggle('typing', on);
    input.addEventListener('keydown', e => { if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') typing(true); });

    const layer = {
      handle(a, info) {
        const fromKeyboard = info && info.source === 'key';
        if (fromKeyboard && a === 'accept' && info.key !== ' ') { sfx('accept'); finish(input.value.trim()); return; }
        if (fromKeyboard && a === 'back') { sfx('back'); finish(null); return; }
        if (!fromKeyboard) typing(false);
        const l2 = ctx.input && ctx.input.isHeld('l2');
        if (a === 'up') moveV(-1);
        else if (a === 'down') moveV(1);
        else if (a === 'left') moveH(-1);
        else if (a === 'right') moveH(1);
        else if (a === 'accept') press(keyAt());
        else if (a === 'triangle' && l2) { sfx('key'); setPage('sym'); }
        else if (a === 'triangle') { sfx('key'); type(' '); }
        else if (a === 'square') { sfx('key'); del(); }
        else if (a === 'l2') { shift = !shift; sfx('key'); render(); }
        else if (a === 'l3') { sfx('key'); setPage('acc'); }
        else if (a === 'l1') caret(-1);
        else if (a === 'r1') caret(1);
        else if (a === 'r2' || a === 'options') { sfx('accept'); finish(input.value.trim()); }
        else if (a === 'back') { sfx('back'); finish(null); }
      },
    };
    keysEl.addEventListener('mousedown', e => e.preventDefault());
    keysEl.addEventListener('click', e => {
      const k = e.target.closest('[data-r]');
      if (!k) return;
      r = Number(k.dataset.r);
      col = Number(k.dataset.x);
      const key = keyAt();
      if (!key.k) return;
      render();
      press(key);
    });
    build();
    render();
    if (ctx.input && ctx.input.mode === 'key') typing(true);
    mountLayer(node);
    pushLayer(layer);
    setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 50);
  });
}

// ---------------- full-screen panel (info, profile, …) ----------------
export function openPanel(html, { handle, onClose } = {}) {
  const node = el(`<div class="layer"><div class="panel-shade"></div><div class="panel-body">${html}</div></div>`);
  const close = (silent) => {
    removeLayer(layer);
    unmountLayer(node);
    if (!silent) sfx('back');
    if (onClose) onClose();
  };
  const layer = {
    handle(a, info) {
      if (handle && handle(a, info) === true) return;
      if (a === 'back') close();
    },
  };
  mountLayer(node);
  pushLayer(layer);
  return { node, close, body: node.querySelector('.panel-body') };
}
