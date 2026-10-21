// The recorder page's only way out: hand chunks and status to PC4's main process.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('recorder', {
  format: ext => ipcRenderer.send('rec:format', ext),
  chunk: buf => ipcRenderer.send('rec:chunk', buf),
  done: () => ipcRenderer.send('rec:done'),
  error: msg => ipcRenderer.send('rec:error', msg),
  onStop: cb => ipcRenderer.on('rec:stop', () => cb()),
});
