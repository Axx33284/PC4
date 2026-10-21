// Finds installed games from Steam, Epic Games and GOG Galaxy.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function run(cmd, args) {
  return new Promise(resolve => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : stdout));
  });
}

async function regValue(key, name) {
  const out = await run('reg', ['query', key, '/v', name]);
  const m = out.match(new RegExp(`${name}\\s+REG_\\w+\\s+(.*)`));
  return m ? m[1].trim() : null;
}

// ---------- VDF (Valve KeyValues) ----------
function parseVdf(text) {
  const root = {};
  const stack = [root];
  let key = null;
  const re = /"((?:\\.|[^"\\])*)"|([{}])/g;
  let m;
  while ((m = re.exec(text))) {
    const cur = stack[stack.length - 1];
    if (m[2] === '{') {
      const obj = {};
      cur[key] = obj;
      stack.push(obj);
      key = null;
    } else if (m[2] === '}') {
      stack.pop();
      key = null;
    } else {
      const s = m[1].replace(/\\\\/g, '\\');
      if (key === null) key = s;
      else { cur[key] = s; key = null; }
    }
  }
  return root;
}

// ---------- Steam ----------
const STEAM_SKIP = new Set(['228980', '1070560', '1391110', '1628350', '1493710', '2180100', '1826330', '1887720']);
const STEAM_SKIP_NAME = /redistributable|steam linux runtime|proton|steamworks|dedicated server|soundtrack/i;

async function steamPath() {
  const p = (await regValue('HKCU\\Software\\Valve\\Steam', 'SteamPath'))
    || (await regValue('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'));
  const candidates = [p, 'C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'].filter(Boolean);
  return candidates.map(c => path.normalize(c)).find(c => fs.existsSync(c)) || null;
}

async function scanSteam() {
  const root = await steamPath();
  if (!root) return { found: false, games: [] };
  const libs = new Set([root]);
  try {
    const vdf = parseVdf(fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8'));
    const lf = vdf.libraryfolders || vdf.LibraryFolders || {};
    for (const v of Object.values(lf)) {
      if (typeof v === 'object' && v.path) libs.add(path.normalize(v.path));
      else if (typeof v === 'string' && /[\\/]/.test(v)) libs.add(path.normalize(v));
    }
  } catch {}
  const games = [];
  for (const lib of libs) {
    const appsDir = path.join(lib, 'steamapps');
    let files = [];
    try { files = fs.readdirSync(appsDir).filter(f => /^appmanifest_\d+\.acf$/.test(f)); } catch { continue; }
    for (const f of files) {
      try {
        const st = parseVdf(fs.readFileSync(path.join(appsDir, f), 'utf8')).AppState;
        if (!st || STEAM_SKIP.has(st.appid) || STEAM_SKIP_NAME.test(st.name || '')) continue;
        games.push({
          source: 'steam',
          sourceId: st.appid,
          name: (st.name || `Steam App ${st.appid}`).trim(),
          installDir: path.join(appsDir, 'common', st.installdir || ''),
          installed: true,
          launch: { type: 'url', target: `steam://rungameid/${st.appid}`, args: '', workingDir: '' },
          meta: { steamAppId: Number(st.appid) },
        });
      } catch {}
    }
  }
  return { found: true, games };
}

// ---------- Epic Games ----------
async function scanEpic() {
  const dir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  if (!fs.existsSync(dir)) return { found: false, games: [] };
  const games = [];
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.item'))) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const cats = m.AppCategories || [];
      if (cats.length && !cats.includes('games')) continue;
      if (m.bIsIncompleteInstall) continue;
      // DLC manifests point at their parent game
      if (m.MainGameAppName && m.MainGameAppName !== m.AppName) continue;
      games.push({
        source: 'epic',
        sourceId: m.AppName,
        name: m.DisplayName,
        installDir: m.InstallLocation || '',
        installed: true,
        launch: {
          type: 'url',
          target: `com.epicgames.launcher://apps/${encodeURIComponent(`${m.CatalogNamespace}:${m.CatalogItemId}:${m.AppName}`)}?action=launch&silent=true`,
          args: '', workingDir: '',
        },
        meta: {},
      });
    } catch {}
  }
  return { found: true, games };
}

// ---------- GOG Galaxy ----------
async function scanGog() {
  const out = await run('reg', ['query', 'HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games', '/s']);
  if (!out.trim()) return { found: false, games: [] };
  const games = [];
  for (const block of out.split(/\r?\n(?=HKEY_)/)) {
    const val = name => { const m = block.match(new RegExp(`^\\s+${name}\\s+REG_\\w+\\s+(.*)$`, 'mi')); return m ? m[1].trim() : ''; };
    const id = val('gameID');
    const exe = val('exe');
    if (!id || !exe) continue;
    if (val('dependsOn')) continue; // DLCs
    games.push({
      source: 'gog',
      sourceId: id,
      name: val('gameName') || val('GAMENAME') || `GOG ${id}`,
      installDir: val('path'),
      installed: fs.existsSync(exe),
      launch: { type: 'exe', target: exe, args: val('launchParam'), workingDir: val('workingDir') || path.dirname(exe) },
      meta: {},
    });
  }
  return { found: true, games };
}

const SCANNERS = { steam: scanSteam, epic: scanEpic, gog: scanGog };

module.exports = { SCANNERS, parseVdf };
