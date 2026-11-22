// Durable storage for the upload queue (changes saved on this PC that are not in the cloud yet).
//
// It used to live in localStorage as one JSON string rewritten on every change, with a ~5 MB limit.
// It now lives in the IndexedDB `syncQueue` table, and only rows that changed are written.
import { db } from '@/db/db';
import { logger, serializeError } from '@/lib/logger';

export const LEGACY_QUEUE_KEY = 'pos_pending_sync_ops_v1';

export interface QueueRow {
  id: string;
  createdAt: string;
  /** Position in the queue; uploads run in this order. */
  seq?: number;
}

let persisted = new Map<string, unknown>();
let ready = false;
let chain: Promise<void> = Promise.resolve();
let queueLength = 0;
let failureHandler: ((error: unknown) => void) | null = null;
/** True while a copy of the queue sits in localStorage because IndexedDB refused a write. */
let fallbackWritten = false;

/** How many changes are waiting (for log lines, without needing the React state). */
export const getQueueLength = () => queueLength;
export const setQueueLength = (n: number) => {
  queueLength = n;
};

/** Called when saving the queue fails, so the app can warn the user. */
export function onQueueSaveFailure(handler: ((error: unknown) => void) | null) {
  failureHandler = handler;
}

/** Orders by `seq`; changes without one (from the old localStorage queue) keep their array order. */
export function orderQueue<T extends QueueRow>(ops: T[]): T[] {
  return ops
    .map((op, index) => ({ op, index }))
    .sort((a, b) => {
      const sa = a.op.seq ?? Number.NEGATIVE_INFINITY;
      const sb = b.op.seq ?? Number.NEGATIVE_INFINITY;
      if (sa !== sb) return sa < sb ? -1 : 1;
      if (a.op.createdAt !== b.op.createdAt) return a.op.createdAt < b.op.createdAt ? -1 : 1;
      return a.index - b.index;
    })
    .map((x) => x.op);
}

/** Reads the old localStorage queue, if any. */
export function readLegacyQueue<T>(): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LEGACY_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/** Reads the queue from IndexedDB and starts tracking it, so later saves only write what changed. */
export async function loadPersistedQueue<T extends QueueRow>(): Promise<T[]> {
  const rows = (await db.syncQueue.toArray()) as unknown as T[];
  persisted = new Map(rows.map((r) => [r.id, r]));
  ready = true;
  return orderQueue(rows);
}

/** Writes the difference between the queue and what is already stored. Never throws. */
export function persistQueue<T extends QueueRow>(ops: readonly T[]): Promise<void> {
  if (!ready) return chain; // the load step writes the merged queue once it finished
  chain = chain
    .then(async () => {
      const toPut = ops.filter((op) => persisted.get(op.id) !== op);
      const keep = new Set(ops.map((op) => op.id));
      const toDelete = [...persisted.keys()].filter((id) => !keep.has(id));
      if (toPut.length === 0 && toDelete.length === 0) return;
      await db.transaction('rw', db.syncQueue, async () => {
        if (toPut.length > 0) await db.syncQueue.bulkPut(toPut as never[]);
        if (toDelete.length > 0) await db.syncQueue.bulkDelete(toDelete);
      });
      for (const op of toPut) persisted.set(op.id, op);
      for (const id of toDelete) persisted.delete(id);
      if (fallbackWritten) {
        // IndexedDB works again and holds everything, so the emergency copy would only be stale.
        try {
          localStorage.removeItem(LEGACY_QUEUE_KEY);
          fallbackWritten = false;
        } catch {
          // ignore
        }
      }
    })
    .catch((error) => {
      logger.error('db', 'Saving the upload queue to IndexedDB failed', {
        rows: ops.length,
        error: serializeError(error),
      });
      // Emergency copy so a failed IndexedDB write cannot lose changes if the app is closed now.
      try {
        localStorage.setItem(LEGACY_QUEUE_KEY, JSON.stringify(ops));
        fallbackWritten = true;
      } catch {
        // storage full as well
      }
      failureHandler?.(error);
    });
  return chain;
}

/**
 * After the merged queue is saved: checks that every change is really stored, and only then
 * deletes the old localStorage copy. Returns true when the old copy was removed.
 */
export async function finishLegacyMigration(expectedIds: readonly string[]): Promise<boolean> {
  await chain;
  if (typeof window === 'undefined' || localStorage.getItem(LEGACY_QUEUE_KEY) === null) return false;
  try {
    const stored = new Set((await db.syncQueue.toCollection().primaryKeys()) as string[]);
    if (!expectedIds.every((id) => stored.has(id))) {
      logger.error('db', 'Queue migration check failed; keeping the old copy', {
        expected: expectedIds.length,
        stored: stored.size,
      });
      return false;
    }
    localStorage.removeItem(LEGACY_QUEUE_KEY);
    logger.info('db', 'Upload queue moved from localStorage to IndexedDB', { changes: expectedIds.length });
    return true;
  } catch (error) {
    logger.error('db', 'Queue migration check failed; keeping the old copy', serializeError(error));
    return false;
  }
}
