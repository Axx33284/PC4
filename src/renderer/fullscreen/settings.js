// PS4-style Settings: a list of rows, with sub pages.
import { ctx, api, el, subscribe, hintsHtml, padIcon } from './core.js';
import { sfx, Music } from './sound.js';
import { esc, icon, padFamily, controllerIcon } from '../common/util.js';
import { THEMES } from './background.js';
import { LIGHT_COLORS, applyLightBar, controllerName } from '../common/lightbar.js';
import { openOptions, showDialog, textInput, toast, scrollIntoList, keyCapture } from './ui.js';
import { KEY_ACTIONS, GLOBAL_ACTIONS, keysFor, isDefault, globalKeyFor, usedBy, keyName, acceleratorName, toAccelerator } from './keys.js';
import { runImport, addExe, exitPC4, switchMode, postNews, warpSwitch, warpInstall, toggleGameWarp } from './actions.js';
import { avatarPicker, renameProfile, installSongFinder } from './editor.js';
import { openPadTest } from './padtest.js';

const basename = p => (p ? p.split(/[\\/]/).pop() : '');
const IMG = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }];
const AUDIO = [{ name: 'Audio', extensions: ['mp3', 'ogg', 'wav', 'm4a', 'flac', 'aac', 'opus', 'webm'] }];

const PAGES = {
  root: () => ({
    title: 'Settings',
    rows: [
      { icon: 'user', label: 'Profile', page: 'profile' },
      { icon: 'palette', label: 'Themes', page: 'themes' },
      { icon: 'volume', label: 'Audio', page: 'sound' },
      { icon: 'grid', label: 'Library', page: 'library' },
      { icon: 'shapes', label: "What's New", page: 'news' },
      { icon: 'gamepad', label: 'Controllers', page: 'controllers' },
      { icon: 'keyboard', label: 'Keyboard', page: 'keyboard' },
      { icon: 'globe', label: 'Network', page: 'network' },
      { icon: 'gear', label: 'System', page: 'system' },
      { icon: 'desktop', label: 'Switch to Desktop Mode', run: () => switchMode('desktop') },
      { icon: 'info', label: 'About PC4', run: async () => {
        const v = await api.version();
        showDialog({ title: `PC4 ${v}`, message: 'A game library for your PC with a console-style home screen.\n\nArtwork and game details come from the Steam store and, if you add a key, SteamGridDB.' });
      } },
    ],
  }),
  profile: s => ({
    title: 'Profile',
    rows: [
      { icon: 'user', label: 'Name', value: s.profileName, run: renameProfile },
      { icon: 'image', label: 'Avatar', desc: 'A picture from your PC or art from your games', value: s.avatar ? 'Custom' : 'Default', run: avatarPicker },
      s.avatar && { icon: 'x', label: 'Remove Avatar', run: () => api.updateSettings({ avatar: null }) },
    ],
  }),
  themes: s => { const p4 = s.uiStyle !== 'ps5'; return {
    title: 'Themes',
    rows: [
      { icon: 'desktop', label: 'Console Style', desc: 'The look, sounds and music of the home screen. Each style has its own sound folder', type: 'choice', key: 'uiStyle', options: [{ value: 'ps4', label: 'PS4' }, { value: 'ps5', label: 'PS5' }] },
      { icon: 'folder', label: p4 ? 'Open PS4 Sound Folder' : 'Open PS5 Sound Folder', run: () => api.openAssetFolder(p4 ? 'sounds4' : 'sounds5') },
      p4 && { icon: 'palette', label: 'Theme', type: 'choice', key: 'theme', options: Object.entries(THEMES).map(([k, t]) => ({ value: k, label: t.name, swatch: t.mid })) },
      p4 && { icon: 'sun', label: 'Theme Changes', desc: 'Off keeps your theme all day', type: 'choice', key: 'themeMode', options: [
        { value: 'fixed', label: 'Off' }, { value: 'time', label: 'With the Time of Day' }, { value: 'game', label: 'From My Last Played Game' },
      ] },
      p4 && { icon: 'refresh', label: 'Animated Waves', type: 'toggle', key: 'waves' },
      p4 && { icon: 'star', label: 'Particles', type: 'toggle', key: 'particles' },
      { icon: 'image', label: 'Game Wallpaper', desc: "The game's art behind the home screen", type: 'choice', key: 'gameWallpaper', options: !p4 ? [{ value: 'hover', label: 'On' }, { value: 'off', label: 'Off' }] : [{ value: 'details', label: 'Only in Game Details' }, { value: 'hover', label: 'When a Game Is Selected' }, { value: 'off', label: 'Off' }] },
      p4 && { icon: 'palette', label: 'Game Colors in Details', desc: "The menu takes on the colours of the game you're looking at", type: 'toggle', key: 'gameColors' },
      { icon: 'grid', label: 'Tile Style', type: 'choice', key: 'tileStyle', options: [{ value: 'auto', label: 'Key Art + Logo' }, { value: 'cover', label: 'Cover Art' }] },
      { icon: 'play', label: 'Launch Animation', desc: 'What you see when a game starts', type: 'choice', key: 'launchStyle', options: [{ value: 'ps4', label: 'PS4 (fade to the game)' }, { value: 'zoom', label: 'Zoom Tile' }] },
      p4 && { icon: 'sort', label: 'Game Details Layout', desc: 'How the cards under a game scroll when you press down', type: 'choice', key: 'hubLayout', options: [{ value: 'vertical', label: 'Vertical' }, { value: 'horizontal', label: 'Horizontal' }] },
      { icon: 'image', label: 'Custom Wallpaper', desc: 'An image, or a video like a recorded dynamic theme', type: 'file', key: 'customBackground', filters: [{ name: 'Images and videos', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'mp4', 'webm', 'mkv', 'mov', 'm4v'] }] },
      s.customBackground && { icon: 'x', label: 'Remove Custom Wallpaper', run: () => api.updateSettings({ customBackground: null }) },
    ],
  }; },
  sound: s => {
    const found = Object.keys((s.uiStyle === 'ps5' ? ctx.state.sounds5 : ctx.state.sounds) || {}).length;
    const tracks = ctx.state.musicTracks || [];
    const niceName = f => basename(f).replace(/\.[^.]+$/, '').replace(/\s*\((HIGH QUALITY|MP3_\d+K)\)/gi, '').trim();
    return {
      title: 'Audio',
      rows: [
        { type: 'section', label: 'Main' },
        { icon: 'volume', label: 'Master Volume', desc: 'Everything PC4 plays', type: 'slider', key: 'masterVolume' },
        { icon: 'x', label: 'Mute All Sound', type: 'toggle', key: 'muteAll' },
        { type: 'section', label: 'Menu Theme' },
        { icon: 'music', label: 'Menu Theme Music', desc: 'Music on the home screen', type: 'toggle', key: 'musicEnabled' },
        { icon: 'music', label: 'Menu Theme', type: 'choice', key: 'music', options: [
          { value: null, label: ctx.state.defaultMusic ? `Default · ${niceName(ctx.state.defaultMusic)}` : 'Default (none found)' },
          ...tracks.filter(t => t !== ctx.state.defaultMusic).map(t => ({ value: t, label: niceName(t) })),
          ...(s.music && !tracks.includes(s.music) ? [{ value: s.music, label: niceName(s.music) }] : []),
          { value: '__browse', label: 'Choose a File…', browse: true },
        ] },
        { icon: 'volume', label: 'Menu Music Volume', type: 'slider', key: 'musicVolume' },
        { icon: 'music', label: 'Intro Music', desc: 'Plays on the startup and user screen', type: 'file', key: 'introMusic', filters: AUDIO, fallback: ctx.state.defaultIntro },
        s.introMusic && { icon: 'x', label: 'Remove Intro Music', run: () => api.updateSettings({ introMusic: null }) },
        { icon: 'folder', label: 'Open Music Folder', desc: 'Music files here show up in the Menu Theme list', run: () => api.openAssetFolder('music') },
        { type: 'section', label: 'Sound Effects' },
        { icon: 'volume', label: 'Sound Effects', desc: 'Navigation, select, back, notifications…', type: 'toggle', key: 'uiSounds' },
        { icon: 'volume', label: 'Sound Effects Volume', type: 'slider', key: 'uiVolume' },
        { icon: 'play', label: 'Play Test Sound', run: () => {} },
        { icon: 'folder', label: 'Sound Pack Folder', desc: `${found} of 12 sounds found · others use the built-in sounds`, type: 'dir', key: 'soundPackDir' },
        { icon: 'folder', label: 'Open Sound Pack Folder', desc: 'navigate, select, back, options, error, notification, trophy, launch, boot, login, shutdown, keyboard', run: () => api.openAssetFolder('sounds') },
        s.soundPackDir && { icon: 'x', label: 'Use Built-in Sound Folder', run: () => api.updateSettings({ soundPackDir: null }) },
        { type: 'section', label: 'Game Theme Songs' },
        { icon: 'music', label: 'Play Theme Songs in Game Details', desc: "A game's own song while you look at its details", type: 'toggle', key: 'gameMusic' },
        { icon: 'volume', label: 'Theme Song Volume', type: 'slider', key: 'gameMusicVolume' },
        { icon: 'search', label: 'Find Theme Songs Automatically', desc: ctx.state.ytdlp ? 'Finds a song the first time you open a game' : 'Install the song finder first', type: 'toggle', key: 'autoThemeSongs' },
        !ctx.state.ytdlp && { icon: 'plus', label: 'Install Song Finder…', desc: 'Lets PC4 find theme songs by itself (yt-dlp, via winget)', run: () => installSongFinder() },
        ctx.state.ytdlp && { icon: 'refresh', label: 'Find Theme Songs for All Games', desc: 'Runs in the background', run: () => { api.findAllThemeSongs(); toast({ title: 'Finding theme songs', body: 'This runs in the background', ico: 'music' }); } },
      ],
    };
  },
  library: () => ({
    title: 'Library',
    rows: [
      { icon: 'refresh', label: 'Scan All Launchers', desc: 'Steam, Epic Games and GOG Galaxy', run: () => runImport() },
      { icon: 'bag', label: 'Scan Steam', run: () => runImport(['steam']) },
      { icon: 'bag', label: 'Scan Epic Games', run: () => runImport(['epic']) },
      { icon: 'bag', label: 'Scan GOG Galaxy', run: () => runImport(['gog']) },
      { icon: 'exe', label: 'Add a Game…', desc: 'Any .exe, shortcut or Steam .url file', run: () => addExe() },
      { icon: 'image', label: 'Refresh All Artwork', desc: 'Downloads missing covers, backgrounds and logos', run: () => { api.refreshAllMetadata(); toast({ title: 'Refreshing artwork', body: 'This runs in the background', ico: 'image' }); } },
      { type: 'section', label: 'Home Screen Apps' },
      { icon: 'store', label: 'Game Store', desc: 'Free games on Epic, Steam deals and top sellers', type: 'toggle', key: 'showStore' },
      { icon: 'play', label: 'YouTube', desc: 'The YouTube TV app, used with your controller', type: 'toggle', key: 'showYouTube' },
      { icon: 'media', label: 'Media Player', desc: 'Videos and music on this PC', type: 'toggle', key: 'showMedia' },
      { icon: 'gallery', label: 'Capture Gallery', desc: 'Your screenshots and clips', type: 'toggle', key: 'showGallery' },
      { type: 'section', label: 'More' },
      { icon: 'keyboard', label: 'SteamGridDB API Key', desc: 'Optional: more artwork choices in Desktop Mode', type: 'text', key: 'sgdbKey', password: true },
    ],
  }),
  controllers: s => {
    const custom = /^#/.test(s.lightBar || '');
    const pad = (navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [])[0];
    const detected = pad ? padFamily(pad.id) : null;
    return {
      title: 'Controllers',
      rows: [
        { icon: 'swap', label: 'Xbox Controller Emulation', desc: 'Play Xbox-only games with your PlayStation controller', page: 'emulation' },
        { type: 'section', label: 'PS Button' },
        { icon: 'power', label: 'Press PS to Start PC4', desc: 'While PC4 is closed (or in Desktop Mode), the PS button opens Console Mode, like turning on a PS4. Starts a small helper when you sign in to Windows', type: 'toggle', key: 'psWake' },
        { icon: 'list', label: 'Hold PS for the Quick Menu', desc: `Music, volume, the game, emulation, battery and captures — also during games. Keyboard: ${keyList('quickmenu', s)}, during games ${acceleratorName(globalKeyFor('quickmenu', s))}`, type: 'toggle', key: 'quickMenu' },
        { icon: 'gamepad', label: 'Controller Passthrough in Games', desc: 'Games get a virtual DUALSHOCK 4, so the Quick Menu can take the controller without leaving the game (needs ViGEmBus and HidHide)', type: 'toggle', key: 'padPassthrough' },
        { icon: 'home', label: 'Press PS to Come Back to PC4', desc: s.emuMode && s.emuMode !== 'off' ? 'While playing. With Xbox emulation the game then gets no Guide button' : 'While playing, like the PS4', type: 'toggle', key: 'psHome' },
        { type: 'section', label: 'Captures (SHARE Button)' },
        { icon: 'camera', label: 'SHARE Button Captures', desc: `Press: screenshot · hold: start / stop recording. Keyboard: ${acceleratorName(globalKeyFor('screenshot', s))} / ${acceleratorName(globalKeyFor('record', s))}`, type: 'toggle', key: 'captureShare' },
        { icon: 'record', label: 'Longest Recording', type: 'choice', key: 'captureMaxMinutes', options: [{ value: 5, label: '5 Minutes' }, { value: 15, label: '15 Minutes' }, { value: 30, label: '30 Minutes' }, { value: 60, label: '1 Hour' }] },
        { icon: 'bell', label: 'Notify Me During Games', desc: 'A quiet Windows notification when a capture is saved', type: 'toggle', key: 'captureNotify' },
        { icon: 'folder', label: 'Captures Folder', type: 'dir', key: 'captureDir', fallback: ctx.state.capturesDir },
        { icon: 'gallery', label: 'Open Capture Gallery', run: async () => (await import('./gallery.js')).openGallery() },
        { type: 'section', label: 'Controller' },
        { icon: 'pulse', label: 'Test Controller', desc: 'Buttons, sticks, drift, triggers, vibration and battery', run: () => openPadTest() },
        { icon: 'gamepad', label: 'Button Icons', desc: 'Which controller buttons PC4 shows in menus', type: 'choice', key: 'padIcons', options: [
          { value: 'auto', label: `Automatic${detected ? ` · ${PAD_NAMES[detected]}` : ''}`, preview: detected || 'auto' },
          { value: 'ps4', label: PAD_NAMES.ps4, preview: 'ps4' },
          { value: 'ps5', label: PAD_NAMES.ps5, preview: 'ps5' },
          { value: 'xbox', label: PAD_NAMES.xbox, preview: 'xbox' },
        ] },
        { type: 'section', label: 'Light Bar' },
        { icon: 'gamepad', label: 'Controller', value: padName === undefined ? 'Checking...' : padName || 'No PS4 controller found', desc: padName ? '' : 'Connect a DUALSHOCK 4 by USB or Bluetooth, then choose this', run: async () => {
          const n = await applyLightBar(ctx.settings, api, { ask: true });
          padName = await controllerName();
          toast({ title: n ? 'Controller found' : 'No controller found', body: padName || 'Connect a DUALSHOCK 4 and try again', ico: 'gamepad', error: !n });
          if (settingsScreen) settingsScreen.render();
        } },
        { icon: 'palette', label: 'Light Bar Color', type: 'choice', key: 'lightBar', options: [
          ...Object.entries(LIGHT_COLORS).map(([k, c]) => ({ value: k, label: c.label, swatch: `rgb(${c.rgb.join(',')})` })),
          ...(custom ? [{ value: s.lightBar, label: `Custom ${s.lightBar.toUpperCase()}`, swatch: s.lightBar }] : []),
        ] },
        { icon: 'edit', label: 'Custom Color', desc: 'Type any colour as #RRGGBB', value: custom ? s.lightBar.toUpperCase() : '', run: async () => {
          const v = await textInput({ title: 'Light bar colour (#RRGGBB)', value: custom ? s.lightBar : '#' });
          if (v === null) return;
          const hex = v.startsWith('#') ? v : `#${v}`;
          if (/^#[0-9a-f]{6}$/i.test(hex)) api.updateSettings({ lightBar: hex.toLowerCase() });
          else showDialog({ title: 'Not a Colour', message: 'Use six hex digits, like #FF0080.', error: true });
        } },
        { icon: 'star', label: 'Light Bar Brightness', type: 'choice', key: 'lightBarBrightness', options: [{ value: 'bright', label: 'Bright' }, { value: 'medium', label: 'Medium' }, { value: 'dim', label: 'Dim' }, { value: 'off', label: 'Off' }] },
      ],
    };
  },
  news: () => ({
    title: "What's New",
    rows: [
      { icon: 'edit', label: 'Post News…', desc: "Write your own post for the What's New feed", run: () => postNews() },
      { icon: 'shapes', label: 'Gaming Industry News', desc: 'Stories from IGN, GameSpot, PC Gamer, Eurogamer and more, plus what\'s trending on Steam', type: 'toggle', key: 'industryNews' },
      { icon: 'sort', label: 'News Sites', desc: 'Choose which sites What\'s New shows', page: 'newsSources' },
      { icon: 'shapes', label: 'Show Game News', desc: 'Official news for the games in your library', type: 'toggle', key: 'showNews' },
      { icon: 'refresh', label: 'Refresh Game News', run: async () => {
        toast({ id: 'news', title: 'Checking for game news…', ico: 'refresh', duration: 0 });
        const items = await api.refreshNews();
        toast({ id: 'news', title: 'Game news updated', body: `${items.length} stor${items.length === 1 ? 'y' : 'ies'} from your games`, ico: 'check', sound: false });
      } },
    ],
  }),
  emulation: s => {
    const e = ctx.state.emulator || {};
    const pads = e.pads || [];
    const status = e.driver === 'missing' ? 'Driver not installed'
      : e.error ? e.error
      : e.running ? (pads.length ? pads.map(p => `${p.kind} (${p.bus}) → Xbox controller ${p.slot}${p.battery >= 0 ? ` · ${p.battery}%${p.charging ? ' charging' : ''}` : ''}`).join(' · ') : 'On · waiting for a PlayStation controller')
      : e.starting ? 'Starting…' : 'Off';
    const hideNote = pads.length && s.emuHide === 'exclusive' && pads.some(p => !p.exclusive)
      ? 'Another program (like Steam or DS4Windows) is using the controller, so games may see it twice. Use HidHide.' : '';
    return {
      title: 'Xbox Controller Emulation',
      rows: [
        { icon: 'gamepad', label: 'Status', value: status, desc: hideNote || 'Games see your PlayStation controller as an Xbox 360 controller', run: () => {} },
        { icon: 'swap', label: 'Xbox Emulation', type: 'toggle', get: st => !!st.emuMode && st.emuMode !== 'off', set: on => api.updateSettings({ emuMode: on ? 'always' : 'off' }) },
        e.driver === 'missing' && { icon: 'download', label: 'Install ViGEmBus Driver…', desc: 'Needed to create the Xbox controller (the same driver DS4Windows uses). Windows will ask for permission.', run: () => installDriver('vigem') },
        { icon: 'pulse', label: 'Test Controller', desc: 'Buttons, sticks, drift, triggers, vibration and battery', run: () => openPadTest() },
        { type: 'section', label: 'Sticks' },
        { icon: 'sort', label: 'Left Stick Deadzone', desc: 'Ignores small movements, stops drift', type: 'slider', key: 'emuDeadzoneL', max: 0.4, step: 0.02 },
        { icon: 'sort', label: 'Right Stick Deadzone', type: 'slider', key: 'emuDeadzoneR', max: 0.4, step: 0.02 },
        { icon: 'sort', label: 'Anti-Deadzone', desc: "Cancels a game's own deadzone so small moves register", type: 'slider', key: 'emuAntiDeadzone', max: 0.4, step: 0.02 },
        { icon: 'refresh', label: 'Response Curve', type: 'choice', key: 'emuCurve', options: [
          { value: 'linear', label: 'Linear' }, { value: 'precise', label: 'Precise (slow near the centre)' }, { value: 'fast', label: 'Fast (quick near the centre)' },
        ] },
        { icon: 'sort', label: 'Invert Left Stick Up/Down', type: 'toggle', key: 'emuInvertLY' },
        { icon: 'sort', label: 'Invert Right Stick Up/Down', type: 'toggle', key: 'emuInvertRY' },
        { type: 'section', label: 'Triggers & Buttons' },
        { icon: 'sort', label: 'Trigger Deadzone', type: 'slider', key: 'emuTriggerDeadzone', max: 0.4, step: 0.02 },
        { icon: 'gamepad', label: 'Touchpad Click', type: 'choice', key: 'emuTouchpad', options: [
          { value: 'back', label: 'Back (View)' }, { value: 'guide', label: 'Guide (Xbox button)' }, { value: 'start', label: 'Start (Menu)' }, { value: 'none', label: 'Nothing' },
        ] },
        { type: 'section', label: 'Vibration & Light Bar' },
        { icon: 'volume', label: 'Vibration Strength', type: 'slider', key: 'emuRumble', step: 0.1 },
        { icon: 'play', label: 'Test Vibration', desc: e.running ? 'Rumbles the controller for a moment' : 'Turn Xbox Emulation on first', run: () => { if (e.running) api.emuRumble(); else toast({ title: 'Xbox Emulation is off', ico: 'gamepad' }); } },
        { icon: 'star', label: 'Light Bar Shows Battery', desc: 'Green when full, red when low', type: 'toggle', key: 'emuBatteryLight' },
        { type: 'section', label: 'Games Seeing Two Controllers' },
        { icon: 'eye', label: 'Hide the PlayStation Controller From Games', type: 'choice', key: 'emuHide', options: [
          { value: 'hidhide', label: e.hidhide ? 'HidHide (best)' : 'HidHide (not installed)' },
          { value: 'exclusive', label: 'Exclusive Access' },
          { value: 'off', label: 'Off (games see both)' },
        ] },
        !e.hidhide && { icon: 'download', label: 'Install HidHide…', desc: 'Hides the real controller from games so they only see the Xbox one', run: () => installDriver('hidhide') },
        { icon: 'restart', label: 'Restart Emulation', run: async () => { await api.emuRestart(); toast({ title: 'Xbox emulation restarted', ico: 'refresh' }); } },
      ],
    };
  },
  keyboard: s => {
    const failed = ctx.state.globalKeyErrors || [];
    return {
      title: 'Keyboard',
      rows: [
        { type: 'section', label: 'Controller Buttons on the Keyboard' },
        ...KEY_ACTIONS.map(a => ({
          glyph: a.glyph, label: a.label, desc: a.desc, html: keycaps(keysFor(a.id, s)) + (isDefault(a.id, s) ? '' : '<span class="kc-mark">Changed</span>'),
          run: () => editKey(a),
        })),
        { type: 'section', label: 'Shortcuts That Also Work During Games' },
        ...GLOBAL_ACTIONS.map(a => {
          const acc = globalKeyFor(a.id, s);
          const off = (a.id === 'screenshot' || a.id === 'record') && s.captureKeys === false;
          return {
            icon: { quickmenu: 'list', home: 'home', screenshot: 'camera', record: 'record' }[a.id], label: a.label,
            desc: failed.includes(a.id) ? 'Another program already uses these keys: choose others' : a.desc,
            html: off || !acc ? '<span>Off</span>' : keycaps(acc.split('+'), true),
            run: () => editGlobal(a),
          };
        }),
        { type: 'section', label: 'More' },
        { icon: 'refresh', label: 'Reset All Keys', desc: 'Back to the keys PC4 came with', run: async () => {
          const ok = await showDialog({ title: 'Reset All Keys', message: 'Every key goes back to how PC4 came.', buttons: [{ label: 'Reset', value: true }, { label: 'Cancel', value: false }], cancelValue: false });
          if (ok) { api.updateSettings({ keyBindings: {}, globalKeys: {} }); toast({ title: 'Keys reset', ico: 'keyboard', sound: false }); }
        } },
      ],
    };
  },
  network: () => {
    const w = ctx.state.warp || {};
    const status = w.busy ? 'Working…' : {
      connected: w.route === 'games' ? 'On · blocked games only' : 'On · all traffic', connecting: 'Connecting…', disconnected: 'Off',
      unregistered: 'Off · set up when you turn it on', missing: 'Cloudflare WARP is not installed', unknown: 'Checking…',
    }[w.status] || `Not responding${w.reason ? ` · ${w.reason}` : ''}`;
    const games = (ctx.state.games || []).filter(g => g.warp);
    return {
      title: 'Network',
      rows: [
        { type: 'section', label: 'Secure Connection · Cloudflare WARP' },
        { icon: 'shieldCheck', label: 'Status', value: status, desc: 'Gets games and sites past blocks from your internet provider, like Roblox in Turkey', run: () => api.warpStatus() },
        w.installed && { icon: 'globe', label: 'Secure Connection', desc: 'On or off right now, for everything on this PC', type: 'toggle', get: () => w.status === 'connected', set: on => warpSwitch(on) },
        !w.installed && { icon: 'download', label: 'Install Cloudflare WARP…', desc: 'Free, from Cloudflare (with winget). Windows asks for permission.', run: () => warpInstall() },
        { icon: 'sort', label: 'What Goes Through It', type: 'choice', key: 'warpRoute', options: [
          { value: 'games', label: 'Only Blocked Games (Fastest)' },
          { value: 'all', label: 'All Internet Traffic' },
        ], desc: 'Blocked games only: the rest of your internet stays at full speed' },
        { icon: 'play', label: 'Games That Turn It On', page: 'warpGames',
          desc: games.length ? games.slice(0, 3).map(g => g.name).join(', ') + (games.length > 3 ? ` and ${games.length - 3} more` : '') : "None yet · also in a game's options menu" },
        { icon: 'power', label: 'Turn It Off When the Game Closes', desc: 'Only when PC4 turned it on for the game', type: 'toggle', key: 'warpAutoOff' },
      ],
    };
  },
  warpGames: () => ({
    title: 'Games That Turn It On',
    rows: (ctx.state.games || []).filter(g => !g.hidden).sort((a, b) => a.name.localeCompare(b.name))
      .map(g => ({ icon: 'play', label: g.name, type: 'toggle', get: () => !!g.warp, set: () => toggleGameWarp(g) })),
  }),
  newsSources: s => ({
    title: 'News Sites',
    rows: (ctx.state.newsSources || []).map(src => ({
      icon: 'shapes', label: src.name, type: 'toggle',
      get: st => (st.newsSources || {})[src.id] !== false,
      set: on => api.updateSettings({ newsSources: { ...(s.newsSources || {}), [src.id]: on } }),
    })),
  }),
  system: () => ({
    title: 'System',
    rows: [
      { icon: 'desktop', label: 'Start PC4 In', type: 'choice', key: 'startupMode', options: [{ value: 'fullscreen', label: 'Console Mode' }, { value: 'desktop', label: 'Desktop Mode' }] },
      { icon: 'play', label: 'Startup Animation', type: 'toggle', key: 'bootAnimation' },
      { icon: 'star', label: 'Performance', desc: perfDesc(), type: 'choice', key: 'performance', options: [
        { value: 'auto', label: `Automatic · ${ctx.state.perf && ctx.state.perf.weak ? 'Light' : 'Best Looking'} on this PC` },
        { value: 'full', label: 'Best Looking' },
        { value: 'light', label: 'Light (older PCs)' },
      ] },
      { icon: 'clock', label: '24-Hour Clock', type: 'toggle', key: 'clock24' },
      { icon: 'play', label: 'Splash Screen When Starting a Game', desc: "How long the game's wallpaper stays up before PC4 steps aside", type: 'choice', key: 'splashSeconds', options: [
        { value: 10, label: '10 Seconds' }, { value: 30, label: '30 Seconds' }, { value: 60, label: '1 Minute' }, { value: 120, label: '2 Minutes' }, { value: 0, label: 'Until the Game Closes' },
      ] },
      { icon: 'shield', label: 'Games That Need Administrator Rights', desc: 'Windows asks for permission before these games start', type: 'choice', key: 'adminGames', options: [
        { value: 'once', label: 'Ask Once per Game' }, { value: 'ask', label: 'Ask Every Time' },
      ] },
      { icon: 'keyboard', label: 'System Font', desc: (ctx.state.fonts || []).length ? `${ctx.state.fonts.length} font file${ctx.state.fonts.length > 1 ? 's' : ''} loaded from assets/fonts` : 'Put your SST font files in assets/fonts to use them', run: () => api.openAssetFolder('fonts') },
      { icon: 'download', label: 'System Software Update', desc: updateDesc(), run: async () => {
        const u = ctx.state.update;
        if (u && u.status === 'ready') { api.installUpdate(); return; }
        if (!u || u.status === 'dev') { toast({ title: 'Updates', body: 'Only the installed PC4 updates itself', ico: 'download' }); return; }
        toast({ title: 'Checking for updates…', ico: 'download', sound: false });
        const r = await api.checkUpdate();
        if (r && r.status === 'latest') toast({ title: 'PC4 is up to date', body: `Version ${await api.version()}`, ico: 'check' });
        else if (r && r.status === 'error') toast({ title: "Couldn't check for updates", body: r.error || '', ico: 'x' });
      } },
      { icon: 'exit', label: 'Exit PC4', run: exitPC4 },
    ],
  }),
};

// the update row's line: what the updater is doing (main.js src/main/updater.js)
function updateDesc() {
  const u = ctx.state.update;
  if (!u || u.status === 'dev') return 'Updates come with the installed PC4';
  if (u.status === 'ready') return `Version ${u.version} is ready: press to restart and install it`;
  if (u.status === 'downloading') return `Downloading version ${u.version || ''} · ${Math.round((u.progress || 0) * 100)}%`;
  if (u.status === 'available') return `Version ${u.version} found, downloading…`;
  if (u.status === 'checking') return 'Checking…';
  if (u.status === 'error') return `Couldn't check: ${u.error || 'no connection'}`;
  return 'PC4 is up to date. Press to check now';
}

// ---------------- Settings › Keyboard ----------------
const keyList = (id, s) => keysFor(id, s).map(keyName).join(' / ') || 'none';
const keycaps = (codes, accel = false) => codes.length
  ? codes.map(c => `<span class="kcap">${esc(accel ? acceleratorName(c) : keyName(c))}</span>`).join(accel ? '<span class="kc-plus">+</span>' : '')
  : '<span>None</span>';
// the controller button a keyboard row stands for
function keyGlyph(g) {
  if (g === 'share') return '<span class="ico key-glyph"><span class="pad-tag">SHARE</span></span>';
  if (['up', 'down', 'left', 'right'].includes(g)) return icon({ up: 'arrowUp', down: 'arrowDown', left: 'arrowLeft', right: 'arrowRight' }[g] || 'gamepad');
  return `<span class="ico key-glyph">${padIcon(g)}</span>`;
}
// these always keep a key: without them the keyboard couldn't find its way back here
const NEEDED = new Set(['accept', 'back', 'up', 'down']);
const NOT_BINDABLE = new Set(['F11', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);

function saveKeys(id, list) {
  const s = ctx.settings;
  const def = (KEY_ACTIONS.find(a => a.id === id) || {}).keys || [];
  const next = { ...(s.keyBindings || {}) };
  if (list.length === def.length && list.every((k, i) => k === def[i])) delete next[id];
  else next[id] = list;
  return next;
}

function editKey(a) {
  const s = ctx.settings;
  const keys = keysFor(a.id, s);
  openOptions({
    title: `${a.label} · ${keys.map(keyName).join(', ') || 'no key'}`,
    items: [
      { label: 'Change Key…', action: () => captureKey(a, false) },
      keys.length < 3 && { label: 'Add Another Key…', action: () => captureKey(a, true) },
      keys.length > 1 && { label: `Keep Only ${keyName(keys[0])}`, action: () => api.updateSettings({ keyBindings: saveKeys(a.id, keys.slice(0, 1)) }) },
      !NEEDED.has(a.id) && keys.length > 0 && { label: 'No Key', action: () => api.updateSettings({ keyBindings: saveKeys(a.id, []) }) },
      !isDefault(a.id, s) && { label: 'Back to Default', action: () => api.updateSettings({ keyBindings: saveKeys(a.id, KEY_ACTIONS.find(x => x.id === a.id).keys) }) },
    ].filter(Boolean),
  });
}

async function captureKey(a, add) {
  const code = await keyCapture({
    title: `${add ? 'Another Key' : 'New Key'} for ${a.label}`,
    message: 'Press the key you want to use.',
    read: e => (NOT_BINDABLE.has(e.code) || !e.code ? false : e.code),
  });
  if (!code) return;
  const s = ctx.settings;
  // a key does one thing: it leaves the button that had it (unless that button would be left with none)
  const others = usedBy(code, s, a.id);
  const stuck = others.find(o => NEEDED.has(o.id) && keysFor(o.id, s).length === 1);
  if (stuck) { showDialog({ title: 'Key Already in Use', message: `${keyName(code)} is the only key for ${stuck.label}. Give ${stuck.label} another key first.`, error: true }); return; }
  const next = { ...(s.keyBindings || {}) };
  const put = (id, list) => {
    const def = KEY_ACTIONS.find(x => x.id === id).keys;
    if (list.length === def.length && list.every((k, i) => k === def[i])) delete next[id];
    else next[id] = list;
  };
  for (const o of others) put(o.id, keysFor(o.id, s).filter(k => k !== code));
  put(a.id, add ? [...keysFor(a.id, s).filter(k => k !== code), code] : [code]);
  await api.updateSettings({ keyBindings: next });
  toast({ title: `${a.label}: ${keyName(code)}`, body: others.length ? `No longer used for ${others.map(o => o.label).join(', ')}` : '', ico: 'keyboard', sound: false });
}

function editGlobal(a) {
  const s = ctx.settings;
  const acc = globalKeyFor(a.id, s);
  const def = GLOBAL_ACTIONS.find(x => x.id === a.id).key;
  const set = v => api.updateSettings({ globalKeys: { ...(s.globalKeys || {}), [a.id]: v }, ...((a.id === 'screenshot' || a.id === 'record') && v ? { captureKeys: true } : {}) });
  openOptions({
    title: `${a.label} · ${acceleratorName(acc)}`,
    items: [
      { label: 'Change Keys…', action: async () => {
        await api.pauseGlobalKeys(true); // PC4's own shortcuts would catch the keys before this screen sees them
        const v = await keyCapture({
          title: `Keys for ${a.label}`,
          message: "Hold Ctrl, Alt or the Windows key and press another key. These keys work in games too, so pick ones your games don't use.",
          read: e => {
            const r = toAccelerator(e);
            if (r === null) return /^(Control|Alt|Shift|Meta)/.test(e.code) ? undefined : false;
            // Ctrl+Alt is AltGr: on many layouts (Turkish Q: AltGr+Q = @) it types a character; taking it would break typing
            const letter = (/^(?:Key|Digit)(\w)$/.exec(e.code) || [])[1];
            if (e.ctrlKey && e.altKey && letter && e.key.length === 1 && e.key.toUpperCase() !== letter) return false;
            return e.ctrlKey || e.altKey || e.metaKey ? r : false;
          },
        });
        await api.pauseGlobalKeys(false);
        if (v) set(v);
      } },
      acc && { label: 'Turn Off', action: () => set('') },
      acc !== def && { label: `Back to Default (${acceleratorName(def)})`, action: () => set(def) },
    ].filter(Boolean),
  });
}

const PAD_NAMES = { ps4: 'PlayStation 4 (DUALSHOCK 4)', ps5: 'PlayStation 5 (DualSense)', xbox: 'Xbox' };
// a small picture of the controller and its face buttons, in that controller's own style
function padPreview(kind) {
  if (kind === 'auto') return '';
  const face = ['cross', 'circle', 'square', 'triangle'].map(b => `<span class="pads-${kind} pp-b">${padIcon(b)}</span>`).join('');
  return `<span class="pad-preview">${controllerIcon(kind)}${face}</span>`;
}

function perfDesc() {
  const p = ctx.state.perf;
  if (!p) return '';
  const hw = `${p.cores} CPU threads · ${p.ramGB} GB memory${p.disk ? ` · ${p.disk}` : ''}`;
  return p.light ? `Light: no blur, calmer background, pauses in the background · ${hw}` : `All effects on · ${hw}`;
}

async function installDriver(which) {
  const name = which === 'hidhide' ? 'HidHide' : 'ViGEmBus';
  const ok = await showDialog({ title: `Install ${name}`, message: `PC4 will install ${name} with Windows Package Manager (winget). Windows asks for permission, and it can take a minute.`, buttons: [{ label: 'Install', value: true }, { label: 'Cancel', value: false }], cancelValue: false });
  if (!ok) return;
  toast({ id: 'drv', title: `Installing ${name}…`, ico: 'download', duration: 0 });
  const r = await api.emuInstall(which);
  toast({ id: 'drv', title: r.ok ? `${name} installed` : 'Install failed', body: r.ok ? (r.restart ? 'Restart the PC to finish' : '') : r.error, ico: r.ok ? 'check' : 'x', sound: false, error: !r.ok });
}

let padName;          // connected controller, filled in when the Controllers page opens
let settingsScreen = null;

export class Settings {
  constructor(root, nav) {
    settingsScreen = this;
    this.nav = nav;
    this.root = el(`<div id="settings" class="screen hidden">
      <div class="page-head">${icon('gear')}<span class="ttl">Settings</span></div>
      <div class="set-wrap"><div class="set-list"></div></div>
      <div class="hints">${hintsHtml([['cross', 'Enter'], ['circle', 'Back']])}</div></div>`);
    root.appendChild(this.root);
    this.listEl = this.root.querySelector('.set-list');
    this.wrap = this.root.querySelector('.set-wrap');
    this.stack = [{ id: 'root', sel: 0 }];
    this.open_ = false;
    this.listEl.addEventListener('click', e => {
      const r = e.target.closest('[data-i]');
      if (!r) return;
      this.top.sel = Number(r.dataset.i);
      this.render();
      this.handle('accept');
    });
    subscribe(() => { if (this.open_) this.render(); });
  }

  get top() { return this.stack[this.stack.length - 1]; }

  page() {
    const p = PAGES[this.top.id](ctx.settings);
    p.rows = p.rows.filter(Boolean);
    return p;
  }

  open(pageId, { alone = false } = {}) {
    this.open_ = true;
    this.stack = alone && pageId ? [{ id: pageId, sel: 0 }] : [{ id: 'root', sel: 0 }];
    if (pageId === 'emulation') api.emuCheck();
    if (pageId && !alone) this.stack.push({ id: pageId, sel: 0 });
    this.render();
    this.root.classList.remove('hidden');
  }

  close() {
    this.open_ = false;
    this.root.classList.add('hidden');
  }

  valueHtml(r, s) {
    if (r.html) return r.html;
    if (r.type === 'toggle') return `<span class="check ${(r.get ? r.get(s) : s[r.key]) ? 'on' : ''}">${icon('check')}</span>`;
    if (r.type === 'slider') {
      const max = r.max ?? 1;
      const v = Math.round((s[r.key] ?? 0) * 100);
      const w = Math.round(((s[r.key] ?? 0) / max) * 100);
      return `<span>${v}%</span><span class="slider"><i style="width:${w}%"></i><b style="left:${w}%"></b></span>`;
    }
    if (r.type === 'choice') {
      const o = r.options.find(x => x.value === s[r.key]) || r.options[0];
      return `${o.swatch ? `<span class="swatch" style="background:${o.swatch}"></span>` : ''}${o.preview ? padPreview(o.preview) : ''}<span>${esc(o.label)}</span>`;
    }
    if (r.type === 'text') return esc(r.password ? (s[r.key] ? '••••••••' : 'Not set') : s[r.key] || '');
    if (r.type === 'file') return esc(basename(s[r.key]) || (r.fallback ? `${basename(r.fallback)} (built-in)` : 'None'));
    if (r.type === 'dir') return esc(basename(s[r.key]) || (r.fallback ? basename(r.fallback) : 'Built-in (assets/sounds)'));
    if (r.value) return esc(r.value);
    if (r.page) return '›';
    return '';
  }

  render() {
    const s = ctx.settings;
    const p = this.page();
    this.top.sel = Math.min(this.top.sel, p.rows.length - 1);
    if (p.rows[this.top.sel] && p.rows[this.top.sel].type === 'section') this.top.sel++;
    this.root.querySelector('.ttl').innerHTML = this.stack.length > 1 ? `<span class="crumb">Settings  ›  </span>${esc(p.title)}` : esc(p.title);
    this.root.querySelector('.page-head .ico').outerHTML = icon(this.top.id === 'emulation' ? 'swap' : 'gear');
    this.listEl.innerHTML = p.rows.map((r, i) => r.type === 'section' ? `<div class="set-section" data-sec="${i}">${esc(r.label)}</div>` : `<div class="set-row ${i === this.top.sel ? 'sel focus-ring' : ''}" data-i="${i}">
      ${r.glyph ? keyGlyph(r.glyph) : icon(r.icon)}<span class="lbl">${esc(r.label)}${r.desc ? `<span class="desc">${esc(r.desc)}</span>` : ''}</span>
      <span class="val">${this.valueHtml(r, s)}</span></div>`).join('');
    scrollIntoList(this.listEl, this.listEl.children[this.top.sel], this.wrap.clientHeight, 10);
  }

  async activate(r) {
    const s = ctx.settings;
    if (r.page) {
      sfx('accept');
      this.stack.push({ id: r.page, sel: 0 });
      this.listEl.dataset.off = '0';
      this.render();
      if (r.page === 'controllers') controllerName().then(n => { padName = n; this.render(); });
      if (r.page === 'emulation') api.emuCheck();
      if (r.page === 'network') api.warpStatus();
      return;
    }
    if (r.label === 'Play Test Sound') { sfx('notification'); return; }
    if (r.run) { sfx('accept'); r.run(); return; }
    if (r.type === 'toggle') { sfx('accept'); if (r.set) await r.set(!r.get(s)); else await api.updateSettings({ [r.key]: !s[r.key] }); return; }
    if (r.type === 'slider') { this.adjust(r, 1, true); return; }
    if (r.type === 'choice') {
      openOptions({
        title: r.label,
        items: r.options.map(o => ({ label: o.label, value: (s[r.key] ?? null) === o.value ? '✓' : '', action: async () => {
          if (o.browse) {
            const f = await api.openFile({ title: r.label, filters: AUDIO });
            if (f) api.updateSettings({ [r.key]: f });
          } else api.updateSettings({ [r.key]: o.value });
        } })),
      });
      return;
    }
    if (r.type === 'text') {
      sfx('accept');
      const v = await textInput({ title: r.label, value: s[r.key] || '', password: r.password });
      if (v !== null) api.updateSettings({ [r.key]: v });
      return;
    }
    if (r.type === 'file' || r.type === 'dir') {
      sfx('accept');
      const f = await api.openFile(r.type === 'dir' ? { title: r.label, properties: ['openDirectory'] } : { title: r.label, filters: r.filters });
      if (f) api.updateSettings({ [r.key]: f });
    }
  }

  adjust(r, d, wrap = false) {
    const s = ctx.settings;
    const max = r.max ?? 1;
    const step = r.step ?? 0.1;
    let v = Math.round(((s[r.key] ?? 0) + Math.sign(d) * step) * 1000) / 1000;
    if (wrap && v > max + 1e-9) v = 0;
    v = Math.max(0, Math.min(max, v));
    if (v === s[r.key]) { sfx('bump'); return; }
    s[r.key] = v; // apply instantly for a responsive slider
    if (/volume/i.test(r.key)) Music.refreshVolume();
    sfx('move');
    this.render();
    api.updateSettings({ [r.key]: v });
  }

  handle(a) {
    const p = this.page();
    const r = p.rows[this.top.sel];
    const step = d => {
      let n = this.top.sel + d;
      while (p.rows[n] && p.rows[n].type === 'section') n += d;
      if (!p.rows[n]) { sfx('bump'); return; }
      this.top.sel = n;
      sfx('move');
      this.render();
    };
    if (a === 'up' || a === 'wheel-up') step(-1);
    else if (a === 'down' || a === 'wheel-down') step(1);
    else if ((a === 'left' || a === 'right') && r && r.type === 'slider') this.adjust(r, a === 'left' ? -1 : 1);
    else if (a === 'right' && r && r.page) this.activate(r);
    else if (a === 'accept' && r) this.activate(r);
    else if (a === 'left' && this.stack.length === 1) sfx('bump');
    else if (a === 'back' || a === 'left') {
      sfx('back');
      if (this.stack.length > 1) { this.stack.pop(); this.listEl.dataset.off = '0'; this.render(); }
      else if (a === 'back') this.nav.closeScreen(this);
    } else if (a === 'home') { sfx('back'); this.nav.closeScreen(this); }
  }
}
