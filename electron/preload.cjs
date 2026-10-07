const { contextBridge, ipcRenderer } = require('electron');

// The only thing the web app can ask the desktop shell to do about printing:
// list installed printers, and send finished ESC/POS bytes to one of them.
contextBridge.exposeInMainWorld('posPrinter', {
  list: () => ipcRenderer.invoke('printer:list'),
  print: (printerName, bytes) => ipcRenderer.invoke('printer:print', printerName, bytes),
});
