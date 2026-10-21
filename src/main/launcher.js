// Starts games and tracks how long they run by watching for processes inside the install folder.
// Games that need administrator rights (their manifest, or "Run as administrator" in the exe's
// Compatibility tab) can't be started with a plain spawn: PC4 asks Windows once, then keeps a
// scheduled task per game (Task Scheduler "run with highest privileges") so later starts skip the prompt.
const { spawn, execFile } = require('child_process');
const { shell, app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { EventEmitter } = require('events');

const POLL_MS = 2000;             // how often a running game's processes are checked
const GIVE_UP_MS = 3 * 60 * 1000; // stop waiting for a game that never appeared
const FRONT_MS = 1000;            // how often to look for an elevated game's first window
const TASK_DIR = '\\PC4\\';

// Small native helpers, compiled once inside the PowerShell host:
// - Path(): Get-Process can't read the path of an elevated process (it opens it for full access);
//   QueryFullProcessImageName only needs limited access, so admin games are seen too.
// - Alive(): which of the given folders have a process running from them (one short line back, not every path).
// - Front() / FrontWindow(): bring a window forward from the background (Task Scheduler starts games behind PC4,
//   and the Quick Menu overlay hands the screen back to the game).
// - Priority(): PC4's own processes step back while a game runs (below normal, or Windows 11 efficiency mode).
const PS_TYPES_CS = String.raw`
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class Pc4Proc {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int a, bool i, int pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, int f, StringBuilder s, ref int n);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll")] static extern bool SetPriorityClass(IntPtr h, uint c);
  [DllImport("kernel32.dll")] static extern bool SetProcessInformation(IntPtr h, int cls, ref PowerThrottling info, int size);
  [DllImport("psapi.dll")] static extern bool EnumProcesses([Out] int[] ids, int size, out int needed);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint c);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool on);
  [StructLayout(LayoutKind.Sequential)] struct PowerThrottling { public uint Version, ControlMask, StateMask; }

  public static string Path(int pid) {
    IntPtr h = OpenProcess(0x1000, false, pid);
    if (h == IntPtr.Zero) return null;
    try { var sb = new StringBuilder(1024); int n = sb.Capacity; return QueryFullProcessImageName(h, 0, sb, ref n) ? sb.ToString(0, n) : null; }
    finally { CloseHandle(h); }
  }
  public static string Alive(string[] dirs) {
    var ids = new int[4096]; int needed;
    if (!EnumProcesses(ids, ids.Length * 4, out needed)) return "";
    var on = new bool[dirs.Length];
    for (int i = 0; i < needed / 4; i++) {
      string p = Path(ids[i]);
      if (p == null) continue;
      p = p.ToLowerInvariant();
      for (int d = 0; d < dirs.Length; d++) if (!on[d] && p.StartsWith(dirs[d])) on[d] = true;
    }
    var sb = new StringBuilder();
    foreach (var b in on) sb.Append(b ? '1' : '0');
    return sb.ToString();
  }
  public static long Foreground() { return GetForegroundWindow().ToInt64(); }
  public static bool FrontWindow(long hwnd) {
    IntPtr found = new IntPtr(hwnd);
    if (found == IntPtr.Zero) return false;
    if (IsIconic(found)) ShowWindow(found, 9);
    if (GetForegroundWindow() == found) return true;
    uint x, fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out x), me = GetCurrentThreadId();
    bool att = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
    try { BringWindowToTop(found); SetForegroundWindow(found); }
    finally { if (att) AttachThreadInput(me, fgThread, false); }
    return GetForegroundWindow() == found;
  }
  public static bool Front(string dir) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (!IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero) return true;
      string p = Path((int)pid);
      if (p != null && p.ToLowerInvariant().StartsWith(dir)) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return FrontWindow(found.ToInt64());
  }
  // level 0 = normal, 1 = below normal, 2 = efficiency mode (idle priority + EcoQoS, like Task Manager's)
  public static void Priority(int[] pids, int level) {
    foreach (int pid in pids) {
      IntPtr h = OpenProcess(0x0200, false, pid);
      if (h == IntPtr.Zero) continue;
      try {
        SetPriorityClass(h, level == 2 ? 0x40u : level == 1 ? 0x4000u : 0x20u);
        var t = new PowerThrottling { Version = 1, ControlMask = 1, StateMask = level == 2 ? 1u : 0u };
        SetProcessInformation(h, 4, ref t, Marshal.SizeOf(t));
      } finally { CloseHandle(h); }
    }
  }
}
`;
// sent as one line: PowerShell reading commands from stdin mishandles multi-line strings
const PS_TYPES = `if (-not ('Pc4Proc' -as [type])) { Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(PS_TYPES_CS).toString('base64')}'))) }`;

// ends every process running from the game's folder
const killCmd = dir => `Get-Process | Where-Object { $_.Path -and $_.Path.ToLower().StartsWith('${(dir + '\\').replace(/'/g, "''")}') } | Stop-Process -Force`;

const psq = s => `'${String(s).replace(/'/g, "''")}'`; // PowerShell single-quoted literal

function execPs(cmd) {
  return new Promise(resolve => {
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true }, (err, out) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(out || '') }));
    if (child.stdin) child.stdin.end();
  });
}

function splitArgs(s) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(s || ''))) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

// Why a game ended before it really started, from its exit code (NTSTATUS values)
function exitReason(code) {
  const c = code >>> 0;
  const hex = '0x' + c.toString(16).toUpperCase().padStart(8, '0');
  const known = {
    0xC0000906: 'Windows Security stopped it: a file of the game was detected as a virus or unwanted software and blocked or quarantined. Check Windows Security › Protection history.',
    0xC0000135: 'A DLL the game needs is missing (often the Visual C++ Redistributable or DirectX, or a file removed by antivirus).',
    0xC000007B: 'The game could not load its files: a 32-bit / 64-bit DLL mix-up or a damaged DLL (reinstalling the Visual C++ Redistributables usually fixes it).',
    0xC0000142: 'A DLL of the game failed to start.',
    0xC0000005: 'The game crashed while starting.',
    0xC0000409: 'The game crashed while starting.',
    0xC0000374: 'The game crashed while starting.',
    0x800700C1: 'The program is not a valid Windows application.',
  };
  return `${known[c] || 'The game closed right after starting.'} (exit code ${hex})`;
}

// One long-lived PowerShell answers the process checks; starting a new one every few seconds would cost far
// more CPU than the checks themselves. Commands queue up; the host closes itself after a quiet minute.
class PsHost {
  constructor() { this.proc = null; this.buf = ''; this.pending = null; this.seq = 0; this.chain = Promise.resolve(); this.idle = null; }

  start() {
    this.proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'], { windowsHide: true });
    try { os.setPriority(this.proc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', d => {
      this.buf += d;
      if (this.pending && this.buf.includes(this.pending.marker)) {
        const out = this.buf.slice(0, this.buf.indexOf(this.pending.marker));
        this.buf = '';
        const p = this.pending;
        this.pending = null;
        clearTimeout(p.timer);
        p.resolve(out);
      }
    });
    const proc = this.proc;
    proc.on('exit', () => {
      if (this.proc === proc) this.proc = null;
      if (this.pending) { this.pending.resolve(null); this.pending = null; }
    });
    proc.stdin.on('error', () => {});
    proc.stdin.write(`${PS_TYPES}\n`);
  }

  // queued: every caller gets its answer (null when the command failed or timed out)
  run(cmd, timeoutMs = 8000) {
    const job = this.chain.then(() => this.exec(cmd, timeoutMs));
    this.chain = job.catch(() => null);
    return job;
  }

  exec(cmd, timeoutMs) {
    clearTimeout(this.idle);
    if (!this.proc) this.start();
    return new Promise(resolve => {
      const marker = `__PC4_DONE_${++this.seq}__`;
      this.pending = {
        marker,
        resolve: out => { this.idle = setTimeout(() => this.stop(), 60000); resolve(out); },
        timer: setTimeout(() => { const p = this.pending; this.pending = null; this.stop(); if (p) p.resolve(null); }, timeoutMs),
      };
      this.buf = '';
      this.proc.stdin.write(`${cmd}; Write-Output '${marker}'\n`);
    });
  }

  stop() {
    clearTimeout(this.idle);
    if (this.proc) { try { this.proc.kill(); } catch {} this.proc = null; }
  }
}

const ps = new PsHost();

async function processPaths() {
  const out = await ps.run('Get-Process | ForEach-Object { [Pc4Proc]::Path($_.Id) } | Where-Object { $_ }');
  return out === null ? null : out.split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(Boolean);
}

// which of these folders have a process running from them: [true, false, …] (null if the check failed)
async function aliveDirs(dirs) {
  if (!dirs.length) return [];
  const out = await ps.run(`[Pc4Proc]::Alive(@(${dirs.map(d => psq(d + '\\')).join(',')}))`);
  const m = out && /([01]+)/.exec(out);
  return m && m[1].length === dirs.length ? [...m[1]].map(c => c === '1') : null;
}


// ---- games that need administrator rights ----

// one task per game and launch setup: a changed exe / arguments / folder gets a new task
function taskName(game) {
  const l = game.launch || {};
  const sig = crypto.createHash('sha1').update([l.target, l.args || '', l.workingDir || ''].join('|').toLowerCase()).digest('hex').slice(0, 8);
  return `${String(game.id).replace(/[^\w.-]/g, '_')}-${sig}`;
}

const runTask = name => new Promise(resolve => {
  execFile('schtasks.exe', ['/run', '/tn', TASK_DIR + name], { windowsHide: true }, err => resolve(!err));
});

// Runs a PowerShell script elevated (Windows shows its admin prompt). 1223 = the prompt was declined.
async function elevated(script) {
  const enc = Buffer.from(script, 'utf16le').toString('base64');
  const r = await execPs(`try { $p = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${enc}'; exit $p.ExitCode } catch { exit 1223 }`);
  return r.code;
}

// 'ask' mode: the admin prompt every time, nothing is left behind
async function launchWithPrompt(l) {
  const r = await execPs(`try { Start-Process -FilePath ${psq(l.target)} -WorkingDirectory ${psq(l.workingDir || path.dirname(l.target))}${l.args ? ` -ArgumentList ${psq(l.args)}` : ''} -Verb RunAs; exit 0 } catch { exit 1223 }`);
  return r.code;
}

// 'once' mode: the first start asks for admin rights and registers the game's tasks (start + close);
// every later start just runs the task, with no prompt
// ---- the assistant: an elevated helper that lets the Quick Menu take the screen from an administrator game ----
// Windows doesn't let a normal program take the foreground from an elevated one (and PC4 can't attach to its
// input), so while such a game runs a tiny elevated PowerShell (its own scheduled task, registered with the game's
// in the same admin prompt) waits on a file: "front <window>" brings that window forward. That's all it can do.
// Its script lives inside the task itself, which only an administrator can change.
const ASSIST = 'assist';
const ASSIST_CS = String.raw`
using System; using System.Runtime.InteropServices;
public static class Pc4Assist {
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool on);
  public static bool Front(long hwnd) {
    IntPtr w = new IntPtr(hwnd);
    if (w == IntPtr.Zero) return false;
    if (IsIconic(w)) ShowWindow(w, 9);
    uint x, fg = GetWindowThreadProcessId(GetForegroundWindow(), out x), me = GetCurrentThreadId();
    bool att = fg != 0 && fg != me && AttachThreadInput(me, fg, true);
    try { BringWindowToTop(w); SetForegroundWindow(w); } finally { if (att) AttachThreadInput(me, fg, false); }
    return GetForegroundWindow() == w;
  }
}
`;
const assistFile = () => path.join(app.getPath('userData'), 'pc4-assist.txt');
function assistScript(file) {
  return `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(ASSIST_CS).toString('base64')}')))
$f = ${psq(file)}
$w = New-Object IO.FileSystemWatcher (Split-Path $f), (Split-Path $f -Leaf)
# queued events: a change that comes while a command runs isn't missed (WaitForChanged only sees what happens while it waits)
foreach ($k in 'Changed', 'Created', 'Deleted', 'Renamed') { $null = Register-ObjectEvent $w $k }
$w.EnableRaisingEvents = $true
$last = ''
while (Test-Path $f) {
  $c = ''; try { $c = [IO.File]::ReadAllText($f) } catch {}
  if ($c -match 'quit') { break }
  if ($c -ne $last) { $last = $c; if ($c -match 'front (\\d+)') { [Pc4Assist]::Front([long]$matches[1]) | Out-Null } }
  if (((Get-Date).ToUniversalTime() - (Get-Item $f).LastWriteTimeUtc).TotalMinutes -gt 10) { break } # PC4 is gone
  $null = Wait-Event -Timeout 30
  Get-Event | Remove-Event
}
`;
}
// PowerShell lines (inside an elevated script) that register the assistant task; $pr = the principal
const registerAssist = () => `$as = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ${psq(`-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${Buffer.from(assistScript(assistFile()), 'utf16le').toString('base64')}`)}
$ast = New-ScheduledTaskSettingsSet -Priority 4 -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskPath '${TASK_DIR}' -TaskName '${ASSIST}' -Action $as -Principal $pr -Settings $ast -Description 'PC4: lets the Quick Menu come up over games running as administrator' -Force | Out-Null`;

const taskExists = name => new Promise(resolve => {
  execFile('schtasks.exe', ['/query', '/tn', TASK_DIR + name], { windowsHide: true }, err => resolve(!err));
});

let assistOn = false, assistKeep = null, assistSeq = 0;
const assistWrite = text => { try { fs.writeFileSync(assistFile(), text); return true; } catch { return false; } };
const assist = {
  get on() { return assistOn; },
  // the file first: the assistant quits when it's missing
  prepare() { assistWrite(`idle ${Date.now()}`); },
  async start() {
    this.prepare();
    if (assistOn) return true;
    assistOn = await runTask(ASSIST);
    clearInterval(assistKeep);
    if (assistOn) assistKeep = setInterval(() => assistWrite(`idle ${Date.now()}`), 3 * 60 * 1000);
    return assistOn;
  },
  front(hwnd) { return assistOn && assistWrite(`front ${Math.round(hwnd)} ${++assistSeq}`); },
  stop() {
    if (!assistOn) return;
    assistOn = false;
    clearInterval(assistKeep);
    try { fs.unlinkSync(assistFile()); } catch {}
  },
};

async function launchWithTask(game, dir) {
  const l = game.launch;
  const name = taskName(game);
  const [haveGame, haveAssist] = await Promise.all([taskExists(name), taskExists(ASSIST)]);
  if (haveGame && haveAssist) {
    await assist.start();
    if (await runTask(name)) return 0;
  }
  assist.prepare();
  const cwd = l.workingDir || path.dirname(l.target);
  const kill = dir ? killCmd(dir) : '';
  const script = `
$ErrorActionPreference = 'Stop'
$me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($me.Substring($me.LastIndexOf([char]92) + 1) -ne ${psq(os.userInfo().username)}) {
  # admin rights came from another account: start the game once, don't leave a task running as that account
  Start-Process -FilePath ${psq(l.target)} -WorkingDirectory ${psq(cwd)}${l.args ? ` -ArgumentList ${psq(l.args)}` : ''}
  exit 0
}
$pr = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Highest
${registerAssist()}
Start-ScheduledTask -TaskPath '${TASK_DIR}' -TaskName '${ASSIST}'
# priority 4 = normal (the Task Scheduler default of 7 would run the game below normal)
$st = New-ScheduledTaskSettingsSet -Priority 4 -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
Get-ScheduledTask -TaskPath '${TASK_DIR}' -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -like ${psq(name.replace(/-[0-9a-f]{8}$/, '') + '-*')} } | Unregister-ScheduledTask -Confirm:$false
$a = New-ScheduledTaskAction -Execute ${psq(l.target)} -WorkingDirectory ${psq(cwd)}${l.args ? ` -Argument ${psq(l.args)}` : ''}
Register-ScheduledTask -TaskPath '${TASK_DIR}' -TaskName ${psq(name)} -Action $a -Principal $pr -Settings $st -Description ${psq(`PC4: starts ${game.name} as administrator`)} -Force | Out-Null
${kill ? `$k = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ${psq(`-NoProfile -NonInteractive -WindowStyle Hidden -Command "${kill}"`)}
Register-ScheduledTask -TaskPath '${TASK_DIR}' -TaskName ${psq(name + '-close')} -Action $k -Principal $pr -Settings $st -Description ${psq(`PC4: closes ${game.name}`)} -Force | Out-Null` : ''}
Start-ScheduledTask -TaskPath '${TASK_DIR}' -TaskName ${psq(name)}
`;
  const code = await elevated(script);
  if (code === 0 && await taskExists(ASSIST)) await assist.start(); // started by the script: just mark it running
  return code;
}

// Self-updating programs move to a new folder with every update: Roblox lives in Versions\version-<hash>\,
// Discord-style apps in app-<x.y.z>\. The old copy starts the updater, closes, and the new copy opens from the new
// folder. PC4 starts the newest copy right away and watches the folder that holds all the versions, or it would
// think the game closed after an update (and, for example, turn the Secure Connection off under Roblox).
const VERSIONED = /^(version-|app-)[\w.-]+$/i;
const versionsRoot = dir => (dir && VERSIONED.test(path.basename(dir)) ? path.dirname(dir) : null);
// the newest installed copy of the same program (or the target itself)
function newestCopy(target) {
  const root = versionsRoot(path.dirname(target));
  if (!root) return target;
  const exe = path.basename(target);
  let best = null, bestT = -1;
  try {
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory() || !VERSIONED.test(d.name)) continue;
      const f = path.join(root, d.name, exe);
      try { const t = fs.statSync(f).mtimeMs; if (t > bestT) { bestT = t; best = f; } } catch {}
    }
  } catch {}
  return best || target;
}

function watchDir(game) {
  const l = game.launch || {};
  let dir = game.installDir || (l.type === 'exe' && l.target ? path.dirname(l.target) : '');
  if (!dir) return '';
  dir = path.normalize(dir).replace(/[\\/]+$/, '');
  dir = (versionsRoot(dir) || dir).toLowerCase();
  // never watch a whole drive or the Windows folder
  if (/^[a-z]:$/.test(dir) || dir.startsWith(process.env.SystemRoot ? process.env.SystemRoot.toLowerCase() : 'c:\\windows')) return '';
  return dir;
}

class Launcher extends EventEmitter {
  constructor() {
    super();
    this.running = new Map();
    this.timer = null;
    module.exports.instance = this;
  }

  isRunning(id) { return this.running.has(id); }
  runningIds() { return [...this.running.keys()]; }

  // opts.admin: 'once' (ask once per game, then a scheduled task) | 'ask' (the admin prompt every time)
  async launch(game, opts = {}) {
    if (this.running.has(game.id)) return { ok: true, already: true };
    // a self-updating program that has moved on: start the new copy (main.js saves where it is now: r.moved)
    let moved = null;
    if (game.launch && game.launch.type === 'exe' && game.launch.target) {
      const now = newestCopy(game.launch.target);
      if (now !== game.launch.target) {
        const oldDir = path.dirname(game.launch.target), newDir = path.dirname(now);
        const same = d => d && path.normalize(d).replace(/[\\/]+$/, '').toLowerCase() === oldDir.toLowerCase();
        moved = {
          launch: { ...game.launch, target: now, workingDir: same(game.launch.workingDir) ? newDir : game.launch.workingDir },
          installDir: same(game.installDir) ? newDir : game.installDir,
        };
        game = { ...game, ...moved };
      }
    }
    const l = game.launch || {};
    if (!l.target) return { ok: false, error: 'This game has no launch target. Edit it and pick an .exe or URL.' };
    if (l.type !== 'url' && !fs.existsSync(l.target)) {
      return { ok: false, error: `The game's program wasn't found:
${l.target}

It may have been moved or uninstalled. Edit the game in Desktop Mode to pick its new location.` };
    }
    let child = null, admin = false;
    const dir = watchDir(game);
    try {
      if (l.type === 'url') {
        await shell.openExternal(l.target);
      } else {
        const ext = path.extname(l.target).toLowerCase();
        if (ext !== '.exe') {
          const err = await shell.openPath(l.target);
          if (err) return { ok: false, error: err };
        } else {
          child = spawn(l.target, splitArgs(l.args), {
            cwd: l.workingDir || path.dirname(l.target),
            detached: true,
            stdio: 'ignore',
          });
          const ok = await new Promise(resolve => {
            child.once('spawn', () => resolve(true));
            child.once('error', e => {
              // EACCES = Windows' ERROR_ELEVATION_REQUIRED: the game wants administrator rights
              if (e.code !== 'EACCES') return resolve(e);
              admin = true;
              resolve(false);
            });
          });
          if (ok instanceof Error) throw ok;
          if (admin) {
            child = null;
            const code = opts.admin === 'ask' ? await launchWithPrompt(l) : await launchWithTask(game, dir);
            if (code === 1223) return { ok: false, error: `${game.name} needs administrator rights, and the Windows permission prompt was declined.\n\nStart it again and choose Yes to let it run.` };
            if (code !== 0) return { ok: false, error: `${game.name} needs administrator rights, but Windows couldn't start it that way (error ${code}).` };
          } else {
            child.unref();
          }
        }
      }
    } catch (e) {
      return { ok: false, error: e.message };
    }
    const entry = {
      id: game.id, name: game.name, start: Date.now(), dir, seen: false, misses: 0, lastSeen: 0,
      childAlive: !!child, childExit: 0, childCode: null, admin, task: admin && opts.admin !== 'ask' ? taskName(game) : null, taskDone: 0,
    };
    if (child) child.on('exit', code => { entry.childAlive = false; entry.childExit = Date.now(); entry.childCode = code; this.poll(); });
    this.running.set(game.id, entry);
    this.emit('started', game.id);
    if (!this.timer) this.timer = setInterval(() => this.poll(), POLL_MS);
    if (admin && dir) this.bringForward(entry);
    return { ok: true, admin, moved };
  }

  // An elevated game wasn't started by PC4 itself, so Windows opens its window behind PC4.
  // Hand it the foreground as soon as its first window shows up.
  bringForward(entry) {
    const t0 = Date.now();
    const tick = async () => {
      if (!this.running.has(entry.id) || Date.now() - t0 > GIVE_UP_MS) return;
      const out = await ps.run(`[Pc4Proc]::Front(${psq(entry.dir + '\\')})`);
      if (out && /True/.test(out)) return;
      setTimeout(tick, FRONT_MS);
    };
    setTimeout(tick, FRONT_MS);
  }

  // the admin game's task: 'running', or the code it ended with
  async taskResult(e) {
    const out = await ps.run(`$t = Get-ScheduledTask -TaskPath '${TASK_DIR}' -TaskName ${psq(e.task)} -ErrorAction SilentlyContinue; if ($t) { '' + $t.State + '|' + ($t | Get-ScheduledTaskInfo).LastTaskResult }`, 15000);
    const m = out && /(\w+)\|(-?\d+)/.exec(out);
    if (!m) return null;
    return m[1] === 'Running' ? 'running' : Number(m[2]);
  }

  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const list = [...this.running.values()];
      // games PC4 started itself and that are still running need no process scan: their exit is reported directly
      if (list.every(e => e.childAlive)) {
        const now = Date.now();
        for (const e of list) { e.seen = true; e.misses = 0; e.lastSeen = now; }
        return;
      }
      const dirs = [...new Set(list.filter(e => e.dir).map(e => e.dir))];
      const alive = await aliveDirs(dirs);
      if (!alive) return;
      const isAlive = e => e.childAlive || (!!e.dir && alive[dirs.indexOf(e.dir)]);
      const now = Date.now();
      for (const e of list) {
        if (!this.running.has(e.id)) continue;
        if (isAlive(e)) {
          e.seen = true; e.misses = 0; e.lastSeen = now;
          continue;
        }
        if (e.seen) {
          // gone for two checks in a row (~4 s): the game has closed
          if (++e.misses >= 2) this.finish(e, e.lastSeen);
          continue;
        }
        // never seen running: did it end right away?
        if (e.childExit && now - e.childExit > 3000) {
          if (e.childCode) { this.finish(e, e.childExit, exitReason(e.childCode)); continue; }
          // exited cleanly: maybe a launcher that hands over to another program; wait a little longer
          if (now - e.childExit > 45000) { this.finish(e, e.childExit, 'The game closed right after starting.'); continue; }
        }
        if (e.task && now - e.start > 3000) {
          const r = await this.taskResult(e);
          if (r !== null && r !== 'running') {
            if (!e.taskDone) e.taskDone = now;
            else if (r !== 0 && r !== 267009 && now - e.taskDone > 2500) { this.finish(e, e.taskDone, exitReason(r)); continue; }
            else if (now - e.taskDone > 45000) { this.finish(e, e.taskDone, 'The game closed right after starting.'); continue; }
          }
        }
        if (now - e.start > GIVE_UP_MS) this.finish(e, e.childExit || e.start); // we could not see the game's process
      }
    } finally {
      this.polling = false;
    }
  }

  // failed: why the game never really ran (no play time is counted then)
  finish(e, endTs, failed = null) {
    if (!this.running.delete(e.id)) return;
    const seconds = failed ? 0 : Math.max(0, Math.round((endTs - e.start) / 1000));
    this.emit('stopped', e.id, seconds, failed);
    if (!this.running.size) { clearInterval(this.timer); this.timer = null; }
    if (![...this.running.values()].some(x => x.task)) assist.stop();
  }

  // "Close Game": ends every process running from the game's folder
  async close(game) {
    const e = this.running.get(game.id);
    const dir = (e && e.dir) || watchDir(game);
    if (!dir) return { ok: false, error: 'PC4 does not know where this game is installed.' };
    await execPs(killCmd(dir));
    // a game running as administrator can only be ended with admin rights: its close task has them
    if (e && e.task) await runTask(e.task + '-close');
    else if (e && e.admin) await elevated(killCmd(dir));
    if (e) { e.seen = true; e.lastSeen = Date.now(); e.childAlive = false; e.misses = 1; this.poll(); }
    return { ok: true };
  }
}

module.exports = Launcher;
module.exports.processPaths = processPaths;
module.exports.stopPs = () => { ps.stop(); assist.stop(); };
// the running game needs the elevated assistant to be brought forward / to give the screen away
module.exports.adminGameRunning = () => [...(module.exports.instance ? module.exports.instance.running.values() : [])].some(e => e.admin);
module.exports.assistFront = hwnd => assist.front(hwnd);
module.exports._test = { assistScript, registerAssist, assistFile }; // for the dev tests
// used by the main process while a game runs (Quick Menu overlay, PC4 stepping back)
module.exports.foregroundWindow = async () => { const out = await ps.run('[Pc4Proc]::Foreground()'); const m = out && /(\d+)/.exec(out); return m ? Number(m[1]) : 0; };
module.exports.frontWindow = async hwnd => /True/.test((await ps.run(`[Pc4Proc]::FrontWindow(${Math.round(hwnd) || 0})`)) || '');
module.exports.setPriority = (pids, level) => (pids.length ? ps.run(`[Pc4Proc]::Priority(@(${pids.map(Number).join(',')}), ${level})`) : Promise.resolve(''));
