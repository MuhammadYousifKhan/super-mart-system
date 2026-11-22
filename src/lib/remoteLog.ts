// Optional central error reporting (see section 5b of MULTI_PC_SETUP.sql).
//
// Sends warn/error log lines to the public.app_logs table so sync problems can be seen from the
// Supabase dashboard. Rules: metadata only (never sale data, passwords or tokens), at most 50 rows
// per hour per PC, best effort. It is deliberately NOT part of the upload queue, so a failing log
// upload can never hold up a sale. If the table is missing the app stops trying for the session.
import { supabase } from '@/lib/supabase';
import { logger, setRemoteSink, type LogEntry } from '@/lib/logger';
import { classifySyncError, isConnectionProblem } from '@/lib/syncErrors';

const MAX_PER_HOUR = 50;
const FLUSH_MS = 60_000;
const MAX_BUFFER = 100;
const HOUR_MS = 60 * 60 * 1000;

interface Row {
  logged_at: string;
  pc: string | null;
  app_version: string | null;
  user_email: string | null;
  level: 'warn' | 'error';
  category: string;
  message: string;
  data: Record<string, unknown> | null;
}

// Only these keys are ever sent, and only as short plain values.
const SAFE_KEYS = ['kind', 'type', 'attempt', 'ms', 'waiting', 'opId', 'status', 'code', 'reason', 'found', 'required', 'rows', 'scope'];

function safeData(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object') return null;
  const src = data as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of SAFE_KEYS) {
    const v = src[key];
    if (typeof v === 'string') out[key] = v.slice(0, 80);
    else if (typeof v === 'number' || typeof v === 'boolean') out[key] = v;
  }
  // The error's code and message identify the problem; details and hints may quote row values, so they stay local.
  const err = src.error as Record<string, unknown> | undefined;
  if (err && typeof err === 'object') {
    out.error = {
      code: typeof err.code === 'string' ? err.code.slice(0, 20) : undefined,
      status: typeof err.status === 'number' ? err.status : undefined,
      message: typeof err.message === 'string' ? err.message.slice(0, 200) : undefined,
    };
  }
  return Object.keys(out).length > 0 ? out : null;
}

let buffer: Row[] = [];
let windowStart = 0;
let acceptedInWindow = 0;
let droppedInWindow = 0;
let disabled = false;

/** Accepts a line for upload unless the hourly limit is used up. Exported for tests. */
export function acceptRemoteEntry(entry: Pick<LogEntry, 'level' | 'cat'>, now = Date.now()): boolean {
  if (disabled || (entry.level !== 'warn' && entry.level !== 'error') || entry.cat === 'perf') return false;
  if (now - windowStart > HOUR_MS) {
    windowStart = now;
    acceptedInWindow = 0;
    droppedInWindow = 0;
  }
  if (acceptedInWindow >= MAX_PER_HOUR) {
    droppedInWindow += 1;
    return false;
  }
  acceptedInWindow += 1;
  return true;
}

async function flush() {
  if (disabled || buffer.length === 0) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  const batch = buffer.splice(0, MAX_PER_HOUR);
  try {
    const { error } = await supabase.from('app_logs').insert(batch);
    if (error) throw error;
  } catch (err) {
    const c = classifySyncError(err);
    if (isConnectionProblem(c.kind) || c.kind === 'auth') {
      buffer = [...batch, ...buffer].slice(-MAX_BUFFER); // try again next time
    } else {
      // Table missing or not allowed: stop for this session. (debug level, so it is never sent back.)
      disabled = true;
      logger.debug('cloud', 'Central error log not available, not sending', { kind: c.kind, code: c.detail.code });
    }
  }
}

/** Starts sending warn/error lines. Returns a function that stops it (on sign-out). */
export function startRemoteLogging(userEmail: string | undefined, appVersion: string): () => void {
  disabled = false;
  const pc = typeof navigator !== 'undefined' ? navigator.platform || 'pc' : 'pc';
  setRemoteSink((entry) => {
    if (!acceptRemoteEntry(entry)) return;
    buffer.push({
      logged_at: entry.ts,
      pc: pc.slice(0, 120),
      app_version: appVersion.slice(0, 40),
      user_email: userEmail?.slice(0, 200) ?? null,
      level: entry.level as 'warn' | 'error',
      category: entry.cat,
      message: entry.msg.slice(0, 600),
      data: safeData(entry.data),
    });
    if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER);
  });
  const timer = setInterval(() => void flush(), FLUSH_MS);
  return () => {
    clearInterval(timer);
    setRemoteSink(null);
    void flush();
  };
}

/** For tests. */
export function __resetRemoteLogForTests() {
  buffer = [];
  windowStart = 0;
  acceptedInWindow = 0;
  droppedInWindow = 0;
  disabled = false;
}
export const __remoteDropped = () => droppedInWindow;
