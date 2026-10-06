// Renders build/icon.svg into build/icon.png (512) and a multi-size build/icon.ico.
// Run with Electron so no extra image dependency is needed:  npm run icons
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

async function render(win, size) {
  win.setContentSize(size, size);
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">
    <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}" style="display:block"/>
  </body></html>`;
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage();
  const scaled = img.getSize().width === size ? img : img.resize({ width: size, height: size, quality: 'best' });
  return scaled.toPNG();
}

function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    width: 512,
    height: 512,
    webPreferences: { offscreen: false },
  });
  try {
    const big = await render(win, 512);
    fs.writeFileSync(path.join(root, 'build', 'icon.png'), big);
    const pngs = [];
    for (const size of SIZES) pngs.push({ size, data: await render(win, size) });
    fs.writeFileSync(path.join(root, 'build', 'icon.ico'), buildIco(pngs));
    console.log('Wrote build/icon.png and build/icon.ico (' + SIZES.join(', ') + ')');
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
