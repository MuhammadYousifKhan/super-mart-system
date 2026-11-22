// Classifies upload errors so the sync queue can decide what to do: retry, ask the user to sign
// in again, or set the change aside because the database will never accept it as it is.
import { serializeError, type SerializedError } from '@/lib/logger';

export type SyncErrorClass =
  | 'network' // no connection, DNS, server briefly down
  | 'timeout' // the request took too long
  | 'auth' // expired or revoked login
  | 'rls' // the database refuses this user (row level security)
  | 'conflict' // duplicate key
  | 'fk' // a referenced row does not exist
  | 'schema' // table, column or function missing: the database setup is out of date
  | 'validation' // the data itself is rejected (null, wrong type, too long)
  | 'unknown';

export interface ClassifiedSyncError {
  kind: SyncErrorClass;
  /** Short text for the UI. */
  message: string;
  detail: SerializedError;
}

const AUTH_TEXT = /jwt|invalid refresh token|refresh token not found|not authenticated|auth session missing|invalid claim/i;
const TIMEOUT_TEXT = /timed out|timeout|aborterror|the operation was aborted|signal is aborted/i;
const NETWORK_TEXT = /failed to fetch|fetch failed|networkerror|network request failed|load failed|err_|enotfound|econn|dns/i;

/** Decides the class from status/code first, and falls back to the message text. */
export function classifySyncError(error: unknown, online = typeof navigator === 'undefined' ? true : navigator.onLine): ClassifiedSyncError {
  const detail = serializeError(error);
  const text = `${detail.name ?? ''} ${detail.message} ${detail.details ?? ''}`;
  const code = detail.code ?? '';
  const status = detail.status;

  const make = (kind: SyncErrorClass): ClassifiedSyncError => ({ kind, message: detail.message, detail });

  if (code === '42501' || status === 403) return make('rls');
  if (status === 401 || AUTH_TEXT.test(text)) return make('auth');
  if (code === '23503') return make('fk');
  if (code === '23505') return make('conflict');
  if (['23502', '23514', '22P02', '22001', '22003', '22007', '22008'].includes(code)) return make('validation');
  if (
    ['42P01', '42703', '42883', '42P10', 'PGRST202', 'PGRST204', 'PGRST205'].includes(code) ||
    /could not find the function|schema cache/i.test(text)
  ) {
    return make('schema');
  }
  if (!online) return make('network');
  if (TIMEOUT_TEXT.test(text)) return make('timeout');
  if (NETWORK_TEXT.test(text) || (status !== undefined && [0, 502, 503, 504].includes(status))) return make('network');
  return make('unknown');
}

/** Connection problems: retried for ever, never parked. */
export const isConnectionProblem = (kind: SyncErrorClass) => kind === 'network' || kind === 'timeout';

/** Errors retrying cannot fix: parked straight away with a clear message. */
export const isPermanentProblem = (kind: SyncErrorClass) => kind === 'rls' || kind === 'schema';

/** A message the cashier or owner can act on. */
export function friendlySyncMessage(c: ClassifiedSyncError): string {
  switch (c.kind) {
    case 'auth':
      return 'Signed out. Sign in again to upload the waiting changes.';
    case 'rls':
      return 'The database refused this change (permissions). Ask support to check the database setup.';
    case 'schema':
      return 'The database setup is out of date. Run MULTI_PC_SETUP.sql in Supabase, then press Sync now.';
    case 'network':
      return 'No internet connection. Retrying automatically.';
    case 'timeout':
      return 'The server is slow to answer. Retrying automatically.';
    default:
      return c.message;
  }
}

/** Waiting time before the next try: 2 s, 4 s, 8 s ... capped at 60 s, with up to 25% jitter. */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(60000, 2000 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (1 + random() * 0.25));
}

/** Splits a list into pieces of at most `size` (used so one huge upload cannot time out as a whole). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error('chunk size must be at least 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
