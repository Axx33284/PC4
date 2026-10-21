// Startup: logo + startup sound, a fade through black, then the "Who's using this controller?" screen.
import { ctx, el, pushLayer, removeLayer, glyph } from './core.js';
import { sfx, soundDuration } from './sound.js';
import { esc, avatarUrl } from '../common/util.js';

const wait = ms => new Promise(r => setTimeout(r, ms));

// The PC4 wordmark, drawn in the same thin rounded style as the app icon (vector, so it is sharp at any size).
// Every letter is one continuous stroke with the same weight and rounded corners.
export const WORDMARK = `<svg class="wordmark" viewBox="150 445 940 215" fill="none" stroke="currentColor" stroke-width="20" stroke-linejoin="round">
  <path d="M172 475H410A35 35 0 0 1 410 545H232A40 40 0 0 0 192 585V640"/>
  <path d="M742 475H553A40 40 0 0 0 513 515V588A40 40 0 0 0 553 628H707"/>
  <path d="M1000 640V495A18 18 0 0 0 973 480L790 585A15 15 0 0 0 798 613H1068"/>
</svg>`;

// Light ribbons like the ones on the icon, drawn across the screen under the logo.
const WAVES = `<svg class="boot-waves" viewBox="0 0 1920 420" preserveAspectRatio="none" fill="none">
  <defs>
    <linearGradient id="bw1" x1="0" x2="1"><stop offset="0" stop-color="#1d6bff" stop-opacity="0"/><stop offset=".45" stop-color="#4fb4ff"/><stop offset=".7" stop-color="#9fe2ff"/><stop offset="1" stop-color="#1d6bff" stop-opacity="0"/></linearGradient>
    <linearGradient id="bw2" x1="0" x2="1"><stop offset="0" stop-color="#1d6bff" stop-opacity="0"/><stop offset=".6" stop-color="#3a8dff"/><stop offset="1" stop-color="#1d6bff" stop-opacity="0"/></linearGradient>
    <filter id="bglow" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <g filter="url(#bglow)">
    <path class="w w1" pathLength="1" d="M0 120 C 420 250, 900 260, 1250 190 S 1760 60, 1920 20" stroke="url(#bw1)" stroke-width="3"/>
    <path class="w w2" pathLength="1" d="M0 250 C 500 190, 1000 150, 1420 180 S 1800 230, 1920 210" stroke="url(#bw1)" stroke-width="2"/>
    <path class="w w3" pathLength="1" d="M0 330 C 600 300, 1100 190, 1500 140 S 1840 110, 1920 100" stroke="url(#bw2)" stroke-width="1.6"/>
  </g>
</svg>`;

// Shows the logo until the startup sound has (almost) finished and `ready` has resolved, fades it to black,
// and returns reveal(): fades the black away to show whatever is underneath.
export async function bootLogo(ready = Promise.resolve()) {
  const node = el(`<div class="boot"><div class="boot-stage"><div class="boot-logo">${WORDMARK}</div>${WAVES}</div></div>`);
  document.body.appendChild(node);
  await wait(300);
  node.classList.add('in');
  sfx('boot');
  const len = soundDuration('boot');
  const minHold = len ? Math.min(8000, Math.max(3200, len * 1000 - 1500)) : 3400;
  await Promise.all([wait(minHold), Promise.race([ready, wait(12000)])]);
  node.classList.add('logo-out');   // logo + waves fade away...
  await wait(1100);
  await wait(450);                  // ...a beat of pure black...
  return {
    reveal: async () => {           // ...then the start screen fades up out of the black
      node.classList.add('out');
      await wait(1400);
      node.remove();
    },
  };
}

export function login() {
  return new Promise(resolve => {
    const s = ctx.settings;
    const av = avatarUrl(ctx.state);
    const node = el(`<div class="login">
      <div class="q">Who's using this controller?</div>
      <div class="user focus-ring"><div class="avatar">${av ? `<img src="${av}">` : esc((s.profileName || 'P')[0].toUpperCase())}</div><div class="nm">${esc(s.profileName)}</div></div>
      <div class="press">${glyph('cross')} Continue <span style="width:3rem"></span> ${glyph('options')} Change Name / Avatar</div></div>`);
    document.getElementById('app').appendChild(node);
    const done = () => {
      removeLayer(layer);
      sfx('login');
      node.classList.add('out');
      setTimeout(() => node.remove(), 800);
      resolve();
    };
    const layer = {
      handle(a) {
        if (a === 'accept' || a === 'home') done();
        else if (a === 'options') import('./actions.js').then(m => m.profileOptions());
      },
    };
    // name/avatar changes show right away on this screen
    const refresh = () => {
      if (!node.isConnected) { ctx.subs.delete(refresh); return; }
      const av2 = avatarUrl(ctx.state);
      node.querySelector('.avatar').innerHTML = av2 ? `<img src="${av2}">` : esc((ctx.settings.profileName || 'P')[0].toUpperCase());
      node.querySelector('.nm').textContent = ctx.settings.profileName;
    };
    ctx.subs.add(refresh);
    node.addEventListener('click', done);
    pushLayer(layer);
  });
}
