// Tests electron/logger.cjs against a temporary folder (no Electron needed).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const logger = require('../../electron/logger.cjs');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-logger-'));
const logsDir = path.join(userData, 'logs');
fs.mkdirSync(logsDir, { recursive: true });

// An old file that must be pruned, and a recent one that must stay.
const old = path.join(logsDir, 'pos-2020-01-01.log');
const recent = path.join(logsDir, 'pos-2099-01-01.log');
fs.writeFileSync(old, 'x\n');
fs.writeFileSync(recent, 'y\n');
const longAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
fs.utimesSync(old, longAgo, longAgo);

logger.init({ getPath: () => userData, getVersion: () => '9.9.9' });
assert.ok(!fs.existsSync(old), 'file older than 30 days is deleted');
assert.ok(fs.existsSync(recent), 'recent file is kept');

const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdEFGH1234';
logger.writeFromRenderer([
  { level: 'error', cat: 'sync', msg: `failed ${jwt}`, data: { password: 'hunter2', access_token: jwt, code: '42501' }, ts: new Date().toISOString() },
  { level: 'bogus', cat: 'x'.repeat(100), msg: 'weird level is coerced' },
  null,
  'not an object',
]);
logger.writeFromRenderer('not an array'); // ignored, must not throw
logger.log('warn', 'ui', 'UI frozen');
logger.flushSync();

const files = fs.readdirSync(logsDir).filter((f) => /^pos-\d{4}-\d{2}-\d{2}\.log$/.test(f) && f !== 'pos-2099-01-01.log');
assert.equal(files.length, 1, 'today has one log file');
const text = fs.readFileSync(path.join(logsDir, files[0]), 'utf8');
const lines = text.trim().split('\n').map((l) => JSON.parse(l)); // every line is valid JSON

assert.ok(!text.includes('eyJ'), 'no JWT on disk');
assert.ok(!text.includes('hunter2'), 'no password on disk');
assert.ok(lines.some((l) => l.msg === 'Application started' && l.app === '9.9.9'), 'startup line with version');
const failed = lines.find((l) => l.cat === 'sync');
assert.equal(failed.level, 'error');
assert.equal(failed.data.code, '42501', 'useful fields survive redaction');
assert.equal(failed.data.password, '[redacted]');
assert.equal(failed.src, 'renderer');
const weird = lines.find((l) => l.msg === 'weird level is coerced');
assert.equal(weird.level, 'info');
assert.equal(weird.cat.length, 30);
assert.ok(lines.every((l) => l.session && l.pc && l.arch), 'every line carries session, pc and arch');

fs.rmSync(userData, { recursive: true, force: true });
console.log('  ok  electron logger: pruning, valid JSON lines, redaction, input validation');
