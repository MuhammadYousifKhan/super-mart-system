const { contextBridge, ipcRenderer } = require('electron');

// The only thing the web app can ask the desktop shell to do about printing:
// list installed printers, and send finished ESC/POS bytes to one of them.
contextBridge.exposeInMainWorld('posPrinter', {
  list: () => ipcRenderer.invoke('printer:list'),
  print: (printerName, bytes) => ipcRenderer.invoke('printer:print', printerName, bytes),
});

// Log files on this PC: the renderer sends batched entries; the main process writes them.
contextBridge.exposeInMainWorld('posLog', {
  write: (entries) => ipcRenderer.send('log:write', entries),
  openFolder: () => ipcRenderer.invoke('log:openFolder'),
  exportBundle: (diagnostics) => ipcRenderer.invoke('log:exportBundle', diagnostics),
});
