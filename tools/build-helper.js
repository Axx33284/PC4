// Compiles the controller helper (src/helper/Pc4Pad.cs) for the installer, so a fresh install doesn't need to
// build it on the player's PC (the C# compiler that ships with Windows). The version stamp is the same source hash
// emulator.js checks: a PC4 whose helper source differs from the shipped exe still compiles its own.
// Run by `npm run dist` (predist). Output: build/helper/pc4pad.exe + pc4wake.exe + pc4pad.version
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src', 'helper', 'Pc4Pad.cs');
const out = path.join(root, 'build', 'helper');
const win = process.env.WINDIR || 'C:\\Windows';
const csc = [path.join(win, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), path.join(win, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')].find(f => fs.existsSync(f));
if (!csc) { console.error('build-helper: the .NET Framework 4 C# compiler was not found'); process.exit(1); }

const code = fs.readFileSync(src, 'utf8');
const hash = crypto.createHash('sha1').update(code).digest('hex').slice(0, 12);
fs.mkdirSync(out, { recursive: true });
execFileSync(csc, ['-nologo', '-optimize+', '-target:exe', `-out:${path.join(out, 'pc4pad.exe')}`, src], { stdio: 'inherit' });
// the same helper without a console window: "Press PS to Start PC4" runs it from the Windows sign-in
execFileSync(csc, ['-nologo', '-optimize+', '-target:winexe', `-out:${path.join(out, 'pc4wake.exe')}`, src], { stdio: 'inherit' });
fs.writeFileSync(path.join(out, 'pc4pad.version'), hash);
console.log(`build-helper: pc4pad.exe ${hash}`);
