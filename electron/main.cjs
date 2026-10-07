const { app, BrowserWindow, shell, Menu, ipcMain } = require('electron');
const path = require('path');
const { printRaw } = require('./printer.cjs');

// Only one copy of the POS may run at a time (two copies would fight over the local database).
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow = null;

const isDev = !app.isPackaged && !!process.env.ELECTRON_DEV_URL;

function isHttpUrl(url) {
  return /^https?:\/\//i.test(url);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0f1a',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Receipts/reports print through window.open('') + document.write, so blank
  // popups stay inside the app. Real web links (e.g. WhatsApp share) open in
  // the user's browser instead of inside the POS.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // The app window must never navigate away from the app itself.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const appUrl = mainWindow.webContents.getURL();
    if (url !== appUrl && !url.startsWith(appUrl.split('#')[0])) {
      event.preventDefault();
      if (isHttpUrl(url)) shell.openExternal(url);
    }
  });

  if (isDev) {
    mainWindow.loadURL(process.env.ELECTRON_DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Direct receipt printing: only the main POS window may call these.
function isFromMainWindow(event) {
  return !!mainWindow && event.sender === mainWindow.webContents;
}

ipcMain.handle('printer:list', async (event) => {
  if (!isFromMainWindow(event)) throw new Error('Not allowed');
  const printers = await mainWindow.webContents.getPrintersAsync();
  return printers.map((p) => ({ name: p.name, isDefault: !!p.isDefault }));
});

ipcMain.handle('printer:print', async (event, printerName, bytes) => {
  if (!isFromMainWindow(event)) throw new Error('Not allowed');
  const printers = await mainWindow.webContents.getPrintersAsync();
  if (!printers.some((p) => p.name === printerName)) {
    throw new Error(`Printer "${printerName}" is not installed`);
  }
  await printRaw(printerName, bytes);
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => app.quit());
