// Controller Test in Console Mode: the shared tester (common/padtester.js) on a full-screen layer.
// The tester reads the pad itself, so PC4's usual handler only lets the keyboard's Esc leave.
import { ctx, api, el, pushLayer, removeLayer, padIcon } from './core.js';
import { sfx } from './sound.js';
import { mountPadTester } from '../common/padtester.js';
import { toast, raise } from './ui.js';

let open_ = false;

export function openPadTest() {
  if (open_) return;
  open_ = true;
  sfx('accept');
  const node = el('<div class="layer pt-layer"><div class="pt-host"></div></div>');
  document.body.appendChild(raise(node));
  const tester = mountPadTester(node.querySelector('.pt-host'), {
    settings: ctx.settings,
    api,
    glyph: padIcon,
    hint: `Hold ${padIcon('circle')} or ${padIcon('home')} to leave`,
    holdToLeave: true,
    onLeave: () => close(),
    notify: ({ title, body }) => toast({ title, body, ico: 'gamepad', duration: 2200 }),
    battery: () => ((ctx.state.emulator && ctx.state.emulator.pads) || [])[0],
  });
  const layer = { handle(a, info) { if (info && info.source === 'key' && (a === 'back' || a === 'home')) close(); } };
  const close = () => {
    if (!open_) return;
    open_ = false;
    tester.destroy();
    removeLayer(layer);
    node.classList.add('out');
    setTimeout(() => node.remove(), 250);
    sfx('back');
  };
  pushLayer(layer);
}
