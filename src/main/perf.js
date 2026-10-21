// How strong is this PC? Decides what "Automatic" performance mode means: older PCs (few cores, little
// memory, no GPU compositing) get the Light mode, and a hard disk (HDD) makes PC4 write and scan less.
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

function hardware(app) {
  const cores = os.cpus().length;
  const ramGB = Math.round(os.totalmem() / 1073741824);
  let gpu = 'unknown';
  try { gpu = app.getGPUFeatureStatus().gpu_compositing || 'unknown'; } catch {}
  const reasons = [];
  if (cores <= 4) reasons.push(`${cores} CPU threads`);
  if (ramGB <= 8) reasons.push(`${ramGB} GB memory`);
  if (!/^enabled/.test(gpu) && gpu !== 'unknown') reasons.push('no graphics acceleration');
  return { cores, ramGB, gpu, weak: reasons.length > 0, reasons };
}

// "SSD" | "HDD" | null for the drive PC4 keeps its data on (PowerShell's storage cmdlets; no admin needed)
function diskType(dir) {
  const letter = path.parse(dir).root.replace(/[:\\/]/g, '');
  if (!/^[a-z]$/i.test(letter)) return Promise.resolve(null);
  const cmd = `$d = Get-Partition -DriveLetter ${letter} -ErrorAction SilentlyContinue | Get-Disk -ErrorAction SilentlyContinue; if ($d) { (Get-PhysicalDisk -ErrorAction SilentlyContinue | Where-Object DeviceId -eq $d.Number | Select-Object -First 1).MediaType }`;
  return new Promise(resolve => {
    const c = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout: 20000 }, (err, out) => {
      const t = String(out || '').trim().toUpperCase();
      resolve(err ? null : t.includes('HDD') ? 'HDD' : t.includes('SSD') ? 'SSD' : null);
    });
    if (c.stdin) c.stdin.end();
  });
}

module.exports = { hardware, diskType };
