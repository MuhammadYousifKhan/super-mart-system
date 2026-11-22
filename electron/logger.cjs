// Persistent log files for the desktop app. No dependencies.
//
// Files: <userData>/logs/pos-YYYY-MM-DD.log, one JSON object per line. Kept for 30 days, and a
// file that passes 10 MB rolls over to pos-YYYY-MM-DD-2.log, -3.log, ...
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const RETENTION_DAYS = 30;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FLUSH_INTERVAL_MS = 1000;
const MAX_ENTRIES_PER_WRITE = 500;
const MAX_STRING = 4000;

const sessionId = crypto.randomBytes(4).toString('hex');
let logsDir = null;
let appInfo = { app: 'unknown', arch: process.arch, pc: os.hostname() };
let buffer = [];
let flushTimer = null;
let flushing = Promise.resolve();

const SECRET_KEY = /pass(word)?|token|apikey|api_key|authorization|service_role|secret/i;
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g;

function redact(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'string') {
    const text = value.replace(JWT, '[redacted-jwt]');
    return text.length > MAX_STRING ? `${text.slice(0, MAX_STRING)}...[cut]` : text;
  }
  if (typeof value !== 'object') return value;
  if (depth > 5) return '[deep]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = SECRET_KEY.test(key) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

function dayStamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function listLogFiles() {
  if (!logsDir) return [];
  try {
    return fs
      .readdirSync(logsDir)
      .filter((name) => /^pos-\d{4}-\d{2}-\d{2}(-\d+)?\.log$/.test(name))
      .map((name) => {
        const full = path.join(logsDir, name);
        return { name, full, mtime: fs.statSync(full).mtimeMs, size: fs.statSync(full).size };
      });
  } catch {
    return [];
  }
}

/** Deletes logs older than the retention window. */
function pruneOldLogs() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const file of listLogFiles()) {
    if (file.mtime < cutoff) {
      try {
        fs.unlinkSync(file.full);
      } catch {
        // A file in use is simply tried again next start.
      }
    }
  }
}

/** The file today's entries go to (rolls to -2, -3 ... when a file is full). */
function currentFile() {
  const base = `pos-${dayStamp()}`;
  let n = 1;
  for (;;) {
    const name = n === 1 ? `${base}.log` : `${base}-${n}.log`;
    const full = path.join(logsDir, name);
    let size = 0;
    try {
      size = fs.statSync(full).size;
    } catch {
      return full;
    }
    if (size < MAX_FILE_BYTES) return full;
    n += 1;
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
  if (flushTimer.unref) flushTimer.unref();
}

function flush() {
  if (!logsDir || buffer.length === 0) return flushing;
  const lines = buffer.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
  buffer = [];
  flushing = flushing
    .then(() => fs.promises.appendFile(currentFile(), lines, 'utf8'))
    .catch(() => {
      // Logging must never break the app.
    });
  return flushing;
}

function flushSync() {
  if (!logsDir || buffer.length === 0) return;
  try {
    const lines = buffer.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
    buffer = [];
    fs.appendFileSync(currentFile(), lines, 'utf8');
  } catch {
    // ignore
  }
}

function log(level, cat, msg, data, extra) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    cat,
    msg: redact(String(msg)),
    ...(data === undefined ? {} : { data: redact(data) }),
    ...appInfo,
    session: sessionId,
    src: 'main',
    ...(extra || {}),
  };
  buffer.push(entry);
  if (level === 'error') void flush();
  else scheduleFlush();
}

/** Entries sent from the renderer (src/lib/logger.ts). Validated and redacted again here. */
function writeFromRenderer(entries) {
  if (!Array.isArray(entries)) return;
  for (const raw of entries.slice(0, MAX_ENTRIES_PER_WRITE)) {
    if (!raw || typeof raw !== 'object') continue;
    const level = ['debug', 'info', 'warn', 'error'].includes(raw.level) ? raw.level : 'info';
    const entry = {
      ts: typeof raw.ts === 'string' ? raw.ts.slice(0, 40) : new Date().toISOString(),
      level,
      cat: String(raw.cat || 'ui').slice(0, 30),
      msg: redact(String(raw.msg ?? '')),
      ...(raw.data === undefined ? {} : { data: redact(raw.data) }),
      ...appInfo,
      session: sessionId,
      src: 'renderer',
      ...(typeof raw.user === 'string' ? { user: raw.user.slice(0, 120) } : {}),
    };
    buffer.push(entry);
  }
  scheduleFlush();
}

function init(app) {
  logsDir = path.join(app.getPath('userData'), 'logs');
  try {
    fs.mkdirSync(logsDir, { recursive: true });
  } catch {
    logsDir = null;
    return;
  }
  appInfo = { app: app.getVersion(), arch: process.arch, pc: os.hostname() };
  pruneOldLogs();

  let freeGb = null;
  try {
    const stats = fs.statfsSync(logsDir);
    freeGb = Math.round(((stats.bavail * stats.bsize) / 1024 ** 3) * 10) / 10;
  } catch {
    // statfs is not available everywhere
  }
  log('info', 'app', 'Application started', {
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    windows: os.release(),
    arch: process.arch,
    freeDiskGb: freeGb,
    dataPath: app.getPath('userData'),
  });
}

/** Hooks for crashes and hangs in the main process. */
function installProcessHandlers(app) {
  process.on('uncaughtException', (err) => {
    log('error', 'app', 'uncaughtException', { name: err?.name, message: err?.message, stack: err?.stack });
    flushSync();
  });
  process.on('unhandledRejection', (reason) => {
    log('error', 'app', 'unhandledRejection', {
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
  app.on('render-process-gone', (_event, _webContents, details) => {
    log('error', 'app', 'render-process-gone', { reason: details.reason, exitCode: details.exitCode });
    flushSync();
  });
  app.on('child-process-gone', (_event, details) => {
    log('error', 'app', 'child-process-gone', { type: details.type, reason: details.reason, exitCode: details.exitCode });
  });
  app.on('before-quit', () => {
    log('info', 'app', 'Application closing');
    flushSync();
  });
}

/** Logs "UI frozen" periods for a window. */
function watchWindow(webContents) {
  let frozenSince = 0;
  webContents.on('unresponsive', () => {
    frozenSince = Date.now();
    log('error', 'ui', 'UI frozen (window not responding)');
  });
  webContents.on('responsive', () => {
    if (frozenSince) {
      log('warn', 'ui', 'UI responding again', { frozenMs: Date.now() - frozenSince });
      frozenSince = 0;
    }
  });
  webContents.on('did-fail-load', (_e, code, description, url) => {
    log('error', 'ui', 'Page failed to load', { code, description, url });
  });
}

function getLogsDir() {
  return logsDir;
}

/**
 * Copies the last 7 days of logs plus the renderer's diagnostics.json into a folder on the
 * Desktop, zips it with Windows' built-in tar.exe when available. Returns the path made.
 */
async function exportBundle(app, diagnostics) {
  if (!logsDir) throw new Error('Logging is not available');
  await flush();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const desktop = app.getPath('desktop');
  const folderName = `POS-diagnostics-${stamp}`;
  const folder = path.join(desktop, folderName);
  await fs.promises.mkdir(folder, { recursive: true });

  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const file of listLogFiles()) {
    if (file.mtime >= cutoff) await fs.promises.copyFile(file.full, path.join(folder, file.name));
  }
  const info = {
    exportedAt: new Date().toISOString(),
    ...appInfo,
    electron: process.versions.electron,
    windows: os.release(),
    ...(redact(diagnostics) || {}),
  };
  await fs.promises.writeFile(path.join(folder, 'diagnostics.json'), JSON.stringify(info, null, 2), 'utf8');

  const zipPath = `${folder}.zip`;
  const zipped = await new Promise((resolve) => {
    execFile('tar', ['-a', '-c', '-f', zipPath, '-C', desktop, folderName], { windowsHide: true }, (err) => resolve(!err));
  });
  if (zipped) {
    await fs.promises.rm(folder, { recursive: true, force: true });
    return zipPath;
  }
  return folder;
}

module.exports = { init, log, flush, flushSync, writeFromRenderer, installProcessHandlers, watchWindow, getLogsDir, exportBundle };
