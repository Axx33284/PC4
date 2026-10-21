// Records the screen and the PC's sound (the game in front) until PC4 says stop.
// Chunks go to the main process every second, so a long clip never sits in memory.
(async () => {
  const q = new URLSearchParams(location.search);
  const w = Number(q.get('w')) || 1920, h = Number(q.get('h')) || 1080;
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60, width: { ideal: w }, height: { ideal: h } }, audio: true });
    // MP4 (H.264, hardware encoded on most PCs) plays everywhere; WebM is the fallback
    const types = ['video/mp4;codecs=avc1.640033,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mimeType = types.find(t => MediaRecorder.isTypeSupported(t));
    const bits = Math.round(Math.min(40, 16 * (w * h) / (1920 * 1080)) * 1e6);
    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bits, audioBitsPerSecond: 192000 });
    window.recorder.format(mimeType.startsWith('video/mp4') ? 'mp4' : 'webm');
    let pending = Promise.resolve();
    rec.ondataavailable = e => { if (e.data && e.data.size) pending = pending.then(() => e.data.arrayBuffer()).then(b => window.recorder.chunk(b)); };
    rec.onstop = () => { stream.getTracks().forEach(t => t.stop()); pending.then(() => window.recorder.done()); };
    window.recorder.onStop(() => { if (rec.state !== 'inactive') rec.stop(); else window.recorder.done(); });
    rec.start(1000);
  } catch (e) {
    window.recorder.error(e.message || String(e));
  }
})();
