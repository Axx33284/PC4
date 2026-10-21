// Game theme songs, like the music a PS4 game plays on the home screen.
// Songs can be picked by hand, or found automatically with yt-dlp when the user has it installed
// (winget install yt-dlp). PC4 never downloads programs itself.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function which(cmd) {
  return new Promise(resolve => execFile('where', [cmd], { windowsHide: true }, (err, out) => resolve(err ? null : out.split(/\r?\n/)[0].trim() || null)));
}

let cached;
async function findYtDlp(configured) {
  if (configured && fs.existsSync(configured)) return configured;
  if (cached !== undefined) return cached;
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    path.join(local, 'Microsoft', 'WinGet', 'Links', 'yt-dlp.exe'),
    path.join(process.env.USERPROFILE || '', 'scoop', 'shims', 'yt-dlp.exe'),
    'C:\\ProgramData\\chocolatey\\bin\\yt-dlp.exe',
  ];
  cached = candidates.find(c => fs.existsSync(c)) || wingetPackage() || (await which('yt-dlp')) || null;
  return cached;
}

// winget often installs portable apps into ...\WinGet\Packages\<id>_<source>\ and only adds that
// folder to the user PATH, which a running app can't see until it restarts
function wingetPackage() {
  const roots = [
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'WinGet', 'Packages'),
  ];
  for (const root of roots) {
    let dirs = [];
    try { dirs = fs.readdirSync(root).filter(d => /^yt-dlp\.yt-dlp/i.test(d)); } catch { continue; }
    for (const d of dirs) {
      const exe = path.join(root, d, 'yt-dlp.exe');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null;
}

function resetYtDlpCache() { cached = undefined; }

// Downloads the best-matching theme song (45 s – 8 min) into dir. Resolves to the file path.
function downloadThemeSong(ytdlp, gameName, dir) {
  return new Promise((resolve, reject) => {
    const base = `music-${Date.now()}`;
    const args = [
      `ytsearch6:${gameName} main theme soundtrack`,
      '-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio',
      '--match-filter', 'duration > 45 & duration < 480',
      '--max-downloads', '1',
      '--no-playlist', '--no-progress', '--quiet', '--no-warnings',
      '--max-filesize', '25M',
      '-o', path.join(dir, `${base}.%(ext)s`),
    ];
    execFile(ytdlp, args, { windowsHide: true, timeout: 180000 }, err => {
      const f = fs.readdirSync(dir).find(x => x.startsWith(base) && !/\.(part|ytdl)$/.test(x));
      if (f) resolve(path.join(dir, f));
      else reject(new Error(err && err.killed ? 'Timed out' : 'No theme song found'));
    });
  });
}

// Downloads the audio of one video the user picked or pasted (YouTube and other sites yt-dlp knows).
function downloadSongUrl(ytdlp, url, dir) {
  return new Promise((resolve, reject) => {
    const base = `music-${Date.now()}`;
    const args = [
      url,
      '-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio',
      '--match-filter', 'duration < 1800',
      '--no-playlist', '--no-progress', '--quiet', '--no-warnings',
      '--max-filesize', '60M',
      '-o', path.join(dir, `${base}.%(ext)s`),
    ];
    execFile(ytdlp, args, { windowsHide: true, timeout: 240000 }, (err, _out, stderr) => {
      const f = fs.readdirSync(dir).find(x => x.startsWith(base) && !/\.(part|ytdl)$/.test(x));
      if (f) return resolve(path.join(dir, f));
      const msg = String(stderr || (err && err.message) || '');
      reject(new Error(err && err.killed ? 'Timed out'
        : /unsupported url|is not a valid url/i.test(msg) ? "That link isn't a video PC4 can use"
        : /private|unavailable|removed/i.test(msg) ? 'That video is unavailable'
        : /HTTP Error 4\d\d|Unable to download webpage|Unable to extract/i.test(msg) ? 'Nothing PC4 can play was found at that link'
        : /does not pass filter/i.test(msg) ? 'Videos longer than 30 minutes are skipped'
        : (msg.match(/ERROR: (?:\[\w+\] )?(?:\S+: )?([^\r\n]{1,140})/) || [])[1] || 'The song could not be downloaded'));
    });
  });
}

// YouTube search without downloading anything: title, channel, length and a thumbnail per result
function searchSongs(ytdlp, query, count = 16) {
  return new Promise((resolve, reject) => {
    execFile(ytdlp, [`ytsearch${count}:${query}`, '--flat-playlist', '-J', '--no-warnings'],
      { windowsHide: true, timeout: 60000, maxBuffer: 32 * 1024 * 1024 }, (err, out) => {
        if (err) return reject(new Error(err.killed ? 'Timed out' : 'Search failed'));
        try {
          const data = JSON.parse(out);
          resolve((data.entries || []).filter(e => e && e.id && e.duration).map(e => ({
            id: e.id,
            title: e.title || '',
            channel: e.channel || e.uploader || '',
            duration: Math.round(e.duration),
            url: e.url || `https://www.youtube.com/watch?v=${e.id}`,
            thumb: `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`,
          })));
        } catch { reject(new Error('Search failed')); }
      });
  });
}

// a direct audio stream, so a result can be heard before it's downloaded
function streamUrl(ytdlp, url) {
  return new Promise((resolve, reject) => {
    execFile(ytdlp, ['-f', 'bestaudio[ext=m4a]/bestaudio', '-g', '--no-playlist', '--no-warnings', url],
      { windowsHide: true, timeout: 45000 }, (err, out) => {
        const u = String(out || '').split(/\r?\n/).find(l => /^https?:/.test(l));
        if (u) resolve(u); else reject(new Error(err && err.killed ? 'Timed out' : 'Preview not available'));
      });
  });
}

// ---------------- Music (Quick Menu / Media Player) ----------------
// YouTube Music's own song search: official tracks instead of random uploads
function musicSearch(ytdlp, query, count = 20) {
  return new Promise((resolve, reject) => {
    const url = `https://music.youtube.com/search?q=${encodeURIComponent(query)}#songs`;
    execFile(ytdlp, [url, '--flat-playlist', '-J', '--no-warnings', '--playlist-end', String(count)],
      { windowsHide: true, timeout: 45000, maxBuffer: 32 * 1024 * 1024 }, (err, out) => {
        if (err) return reject(new Error(err.killed ? 'Timed out' : 'Search failed'));
        try {
          const data = JSON.parse(out);
          resolve((data.entries || []).filter(e => e && e.id).map(e => ({
            id: e.id, title: e.title || '', artist: (e.artists && e.artists[0]) || e.channel || '',
            url: `https://music.youtube.com/watch?v=${e.id}`, thumb: `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
          })));
        } catch { reject(new Error('Search failed')); }
      });
  });
}

// what's needed to play a song: the audio stream plus artist, title, length and cover art
function resolveSong(ytdlp, url) {
  return new Promise((resolve, reject) => {
    execFile(ytdlp, ['-f', 'bestaudio[ext=m4a]/bestaudio', '--no-playlist', '--no-warnings',
      '--print', '%(artist,uploader)s\t%(track,title)s\t%(duration)s\t%(thumbnail)s', '--print', 'urls', url],
      { windowsHide: true, timeout: 45000 }, (err, out) => {
        const lines = String(out || '').split(/\r?\n/).filter(Boolean);
        const stream = lines.find(l => /^https?:\/\/.*googlevideo|^https?:\/\//.test(l) && !l.includes('\t'));
        const meta = (lines.find(l => l.includes('\t')) || '').split('\t');
        if (!stream) return reject(new Error(err && err.killed ? 'Timed out' : 'This song is not available'));
        resolve({ stream, artist: meta[0] && meta[0] !== 'NA' ? meta[0] : '', title: meta[1] || '', duration: Number(meta[2]) || 0, cover: /^https?:/.test(meta[3] || '') ? meta[3] : null });
      });
  });
}

module.exports = { findYtDlp, resetYtDlpCache, downloadThemeSong, downloadSongUrl, searchSongs, streamUrl, musicSearch, resolveSong };
