const { contextBridge, ipcRenderer } = require('electron');

let apiPort = null;
const portArg = process.argv.find((arg) => typeof arg === 'string' && arg.startsWith('--api-port='));
if (portArg) {
  apiPort = portArg.split('=')[1];
}

const apiBaseUrl = apiPort ? `http://127.0.0.1:${apiPort}` : 'http://127.0.0.1:3001';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  apiBaseUrl,
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  isFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
  onFullScreenChange: (callback) => {
    const handler = (_event, val) => callback(val);
    ipcRenderer.on('window:fullscreen-change', handler);
    return () => ipcRenderer.removeListener('window:fullscreen-change', handler);
  },
});
