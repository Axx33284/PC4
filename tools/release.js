// One command for a new PC4 release: bumps the version, builds the installer and publishes it on GitHub, where
// installed copies of PC4 find it (src/main/updater.js reads latest.yml from the newest release).
//
//   npm run release                      1.2.0 -> 1.2.1
//   npm run release -- minor             1.2.0 -> 1.3.0
//   npm run release -- major             1.2.0 -> 2.0.0
//   npm run release -- 1.4.2             that exact version
//   npm run release -- patch --notes "Fixed the controller test on Bluetooth"
//   npm run release -- --dry-run         shows what it would do, changes nothing
//
// Needs: a clean git working tree on main, the GitHub CLI signed in (gh auth login), the sounds/ folder (it ships
// inside the installer). Steps: version in package.json + package-lock.json -> helper exes -> installer ->
// commit + tag vX.Y.Z -> push -> GitHub release with the installer, its blockmap and latest.yml.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const notesAt = args.indexOf('--notes');
const notes = notesAt >= 0 ? args[notesAt + 1] : null;
const bump = args.find((a, i) => !a.startsWith('--') && (notesAt < 0 || i !== notesAt + 1)) || 'patch';

const run = (cmd, cmdArgs, opts = {}) => {
  console.log(`> ${cmd} ${cmdArgs.join(' ')}`);
  if (dry && !opts.always) return '';
  return execFileSync(cmd, cmdArgs, { cwd: root, stdio: opts.capture ? 'pipe' : 'inherit', encoding: 'utf8', shell: process.platform === 'win32' && cmd === 'npx' });
};
const out = (cmd, cmdArgs) => execFileSync(cmd, cmdArgs, { cwd: root, encoding: 'utf8' }).trim();
const fail = msg => { console.error(`release: ${msg}`); process.exit(1); };

// ---- checks ----
if (out('git', ['status', '--porcelain'])) fail('commit or stash your changes first (git status is not clean)');
if (out('git', ['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main') fail('switch to the main branch first');
try { out('gh', ['auth', 'status']); } catch { fail('sign in to GitHub first: gh auth login'); }
if (!fs.existsSync(path.join(root, 'sounds'))) fail('the sounds/ folder is missing (it ships inside the installer)');

// ---- the new version ----
const pkgFile = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
const [ma, mi, pa] = pkg.version.split('.').map(Number);
const version = /^\d+\.\d+\.\d+$/.test(bump) ? bump
  : bump === 'major' ? `${ma + 1}.0.0` : bump === 'minor' ? `${ma}.${mi + 1}.0` : bump === 'patch' ? `${ma}.${mi}.${pa + 1}` : fail(`unknown version "${bump}"`);
const tag = `v${version}`;
if (out('git', ['tag', '--list', tag])) fail(`${tag} already exists`);
const publish = (pkg.build.publish || [])[0] || {};
const repo = `${publish.owner}/${publish.repo}`;
console.log(`\nPC4 ${pkg.version} -> ${version}  (github.com/${repo})${dry ? '  [dry run]' : ''}\n`);

if (!dry) {
  pkg.version = version;
  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
  const lockFile = path.join(root, 'package-lock.json');
  if (fs.existsSync(lockFile)) {
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    lock.version = version;
    if (lock.packages && lock.packages['']) lock.packages[''].version = version;
    fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n');
  }
}

// ---- build ----
run('node', ['tools/build-helper.js']);
run('npx', ['electron-builder', '--win', '--publish', 'never']);
const exe = `dist/PC4-Setup-${version}.exe`;
const files = [exe, `${exe}.blockmap`, 'dist/latest.yml'];
if (!dry) for (const f of files) if (!fs.existsSync(path.join(root, f))) fail(`the build did not make ${f}`);

// ---- commit, tag, push, publish ----
run('git', ['add', 'package.json', 'package-lock.json', 'build/helper']);
run('git', ['commit', '-m', `Release ${tag}`]);
run('git', ['tag', tag]);
run('git', ['push', 'origin', 'main', tag]);
const body = `${notes ? `${notes}\n\n` : ''}**Download \`PC4-Setup-${version}.exe\` below and run it.** PC4 1.2.0 and later update themselves to this version.`;
run('gh', ['release', 'create', tag, ...files, '--repo', repo, '--title', `PC4 ${version}`, '--notes', body]);
console.log(dry ? '\nDry run: nothing was changed.' : `\nPublished: https://github.com/${repo}/releases/tag/${tag}`);
