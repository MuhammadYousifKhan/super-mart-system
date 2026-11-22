// App-wide logger.
//
// In the desktop app, entries are batched and sent to the main process, which appends them to
// %APPDATA%\modern-pos-system\logs\pos-YYYY-MM-DD.log (see electron/logger.cjs). In a browser
// build they go to an IndexedDB table (capped). The last 500 entries are always kept in memory
// for Settings > Diagnostics. Secrets are redacted before anything is stored.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogCategory = 'sync' | 'auth' | 'db' | 'cloud' | 'pos' | 'print' | 'perf' | 'ui' | 'app';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  cat: LogCategory;
  msg: string;
  data?: unknown;
  user?: string;
}

const RING_SIZE = 500;
const FLUSH_MS = 1000;
const MAX_BROWSER_ROWS = 5000;
const MAX_STRING = 4000;

const SECRET_KEY = /pass(word)?|token|apikey|api_key|authorization|service_role|secret/i;
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g;

/** Removes secrets and shortens long text. Safe to call on any value. */
export function redact(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    const text = value.replace(JWT, '[redacted-jwt]');
    return text.length > MAX_STRING ? `${text.slice(0, MAX_STRING)}...[cut]` : text;
  }
  if (typeof value !== 'object') return value;
  if (depth > 5) return '[deep]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY.test(key) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

export interface SerializedError {
  name?: string;
  message: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
  stack?: string;
}

/** Keeps what is needed to diagnose a rejection (Supabase/PostgREST code, details, hint, status). */
export function serializeError(err: unknown): SerializedError {
  if (err == null) return { message: 'Unknown error' };
  if (typeof err === 'string') return { message: err };
  if (typeof err !== 'object') return { message: String(err) };
  const e = err as Record<string, unknown>;
  const out: SerializedError = {
    message: typeof e.message === 'string' ? e.message : safeStringify(err),
  };
  if (typeof e.name === 'string') out.name = e.name;
  if (typeof e.code === 'string' || typeof e.code === 'number') out.code = String(e.code);
  if (typeof e.details === 'string') out.details = e.details;
  if (typeof e.hint === 'string') out.hint = e.hint;
  if (typeof e.status === 'number') out.status = e.status;
  if (typeof e.stack === 'string') out.stack = e.stack.split('\n').slice(0, 6).join('\n');
  return out;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

// Optional second destination for warn/error lines (see src/lib/remoteLog.ts).
let remoteSink: ((entry: LogEntry) => void) | null = null;
export function setRemoteSink(sink: ((entry: LogEntry) => void) | null) {
  remoteSink = sink;
}

const ring: LogEntry[] = [];
let pending: LogEntry[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let currentUser: string | undefined;
const listeners = new Set<() => void>();

const isDev = typeof import.meta !== 'undefined' && !!(import.meta as { env?: { DEV?: boolean } }).env?.DEV;

async function writeToBrowserStore(entries: LogEntry[]) {
  try {
    const { db } = await import('@/db/db');
    await db.logs.bulkAdd(entries.map((e) => ({ ...e, data: e.data === undefined ? undefined : safeStringify(e.data) })));
    const count = await db.logs.count();
    if (count > MAX_BROWSER_ROWS) {
      const excess = count - MAX_BROWSER_ROWS;
      const oldest = await db.logs.orderBy('id').limit(excess).primaryKeys();
      await db.logs.bulkDelete(oldest);
    }
  } catch {
    // Logging must never break the app.
  }
}

function flush() {
  timer = null;
  if (pending.length === 0) return;
  const batch = pending;
  pending = [];
  try {
    if (typeof window !== 'undefined' && window.posLog) {
      window.posLog.write(batch);
    } else {
      void writeToBrowserStore(batch);
    }
  } catch {
    // ignore
  }
}

function write(level: LogLevel, cat: LogCategory, msg: string, data?: unknown) {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    cat,
    msg,
    ...(data === undefined ? {} : { data: redact(data) }),
    ...(currentUser ? { user: currentUser } : {}),
  };
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();
  listeners.forEach((l) => l());

  if (isDev) {
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(`[${cat}] ${msg}`, entry.data ?? '');
  }

  // Debug lines are for the in-memory view only, to keep the files small.
  if (level === 'debug') return;
  if (remoteSink && (level === 'warn' || level === 'error')) {
    try {
      remoteSink(entry);
    } catch {
      // Remote reporting must never break logging.
    }
  }
  pending.push(entry);
  if (level === 'error') {
    flush();
  } else if (!timer) {
    timer = setTimeout(flush, FLUSH_MS);
  }
}

export const logger = {
  debug: (cat: LogCategory, msg: string, data?: unknown) => write('debug', cat, msg, data),
  info: (cat: LogCategory, msg: string, data?: unknown) => write('info', cat, msg, data),
  warn: (cat: LogCategory, msg: string, data?: unknown) => write('warn', cat, msg, data),
  error: (cat: LogCategory, msg: string, data?: unknown) => write('error', cat, msg, data),
  /** Who is signed in, recorded on every later entry. */
  setUser: (user: string | undefined) => {
    currentUser = user;
  },
  /** The last 500 entries (newest last), for the Diagnostics screen. */
  recent: (): readonly LogEntry[] => ring,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Sends anything still buffered right now (before a reload or export). */
  flush,
};

let handlersInstalled = false;

/** Logs uncaught errors and unhandled promise rejections. Call once at startup. */
export function installGlobalErrorHandlers() {
  if (handlersInstalled || typeof window === 'undefined') return;
  handlersInstalled = true;
  window.addEventListener('error', (event) => {
    write('error', 'ui', 'window error', {
      message: event.message,
      source: event.filename,
      line: event.lineno,
      col: event.colno,
      error: serializeError(event.error),
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    write('error', 'ui', 'unhandled promise rejection', serializeError(event.reason));
  });
  window.addEventListener('beforeunload', flush);
}
