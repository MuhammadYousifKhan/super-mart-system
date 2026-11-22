import Dexie, { Table } from 'dexie';
import {
  Product,
  Category,
  Unit,
  Order,
  OrderItem,
  OrderEditLog,
  StoreSettings,
  Customer,
  CustomerTransaction,
  CustomerReminder,
  Supplier,
  SupplierPurchase,
  SupplierPaymentSchedule,
  HeldCart,
} from '@/types/pos';
import { logger, serializeError } from '@/lib/logger';

export class POSDatabase extends Dexie {
  products!: Table<Product, string>;
  categories!: Table<Category, string>;
  units!: Table<Unit, string>;
  orders!: Table<Order, string>;
  orderItems!: Table<OrderItem, string>;
  orderEditLogs!: Table<OrderEditLog, string>;
  customers!: Table<Customer, string>;
  customerTransactions!: Table<CustomerTransaction, string>;
  customerReminders!: Table<CustomerReminder, string>;
  suppliers!: Table<Supplier, string>;
  supplierPurchases!: Table<SupplierPurchase, string>;
  supplierPaymentSchedules!: Table<SupplierPaymentSchedule, string>;
  settings!: Table<StoreSettings, string>;
  heldCarts!: Table<HeldCart, string>;

  syncQueue!: Table<{
    id: string;
    type: string;
    payload: any;
    createdAt: string;
    retryCount: number;
    lastError?: string;
  }, string>;

  /** Browser-build fallback for src/lib/logger.ts (the desktop app writes log files instead). */
  logs!: Table<{ id?: number; ts: string; level: string; cat: string; msg: string; data?: string; user?: string }, number>;

  constructor() {
    super('SuperMartPOS');

    this.version(2).stores({
      products: 'id, sku, categoryId, unitId',
      categories: 'id',
      units: 'id',
      orders: 'id, createdAt, customerId, status',
      orderItems: 'id, orderId, productId',
      orderEditLogs: 'id, orderId',
      customers: 'id',
      customerTransactions: 'id, customerId, orderId',
      customerReminders: 'id, customerId',
      suppliers: 'id',
      supplierPurchases: 'id, supplierId',
      supplierPaymentSchedules: 'id, supplierId',
      settings: 'storeName',
      heldCarts: 'id',
      syncQueue: 'id, createdAt'
    });

    this.version(3).stores({
      logs: '++id, ts',
    });
  }
}

export const db = new POSDatabase();

// ---------------------------------------------------------------------------
// Saving whole lists used to be clear() + bulkPut(everything) on every change, so every sale
// rewrote the entire sales history. Now only rows whose object changed are written, removed rows
// are deleted, and several changes in a row (a checkout touches ~5 tables) become one write.
// State updates create new objects only for rows that changed, so comparing references is enough.
// ---------------------------------------------------------------------------
const SAVE_DEBOUNCE_MS = 300;

type RowWithId = { id: string };
// What IndexedDB is known to hold for each table (row objects by id). Missing = unknown.
const savedRows = new Map<string, Map<string, unknown>>();
const queuedData = new Map<string, RowWithId[]>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const saveChains = new Map<string, Promise<void>>();

async function writeTable(name: string, data: RowWithId[]) {
  const table = db[name as keyof POSTables] as unknown as Table<RowWithId, string>;
  if (!table) return;
  const known = savedRows.get(name);
  try {
    if (!known) {
      // Nothing known about what is stored: write everything once.
      await db.transaction('rw', table, async () => {
        await table.clear();
        await table.bulkPut(data);
      });
      savedRows.set(name, new Map(data.map((row) => [row.id, row])));
      return;
    }
    const changed = data.filter((row) => known.get(row.id) !== row);
    const keep = new Set(data.map((row) => row.id));
    const removed = [...known.keys()].filter((id) => !keep.has(id));
    if (changed.length === 0 && removed.length === 0) return;
    await db.transaction('rw', table, async () => {
      if (changed.length > 0) await table.bulkPut(changed);
      if (removed.length > 0) await table.bulkDelete(removed);
    });
    for (const row of changed) known.set(row.id, row);
    for (const id of removed) known.delete(id);
  } catch (err) {
    // Unknown state now: the next save rewrites the whole table.
    savedRows.delete(name);
    logger.error('db', `Failed to save table ${name} to IndexedDB`, { rows: data.length, error: serializeError(err) });
  }
}

function runQueuedSave(name: string): Promise<void> {
  saveTimers.delete(name);
  const data = queuedData.get(name);
  queuedData.delete(name);
  if (!data) return saveChains.get(name) ?? Promise.resolve();
  const next = (saveChains.get(name) ?? Promise.resolve()).then(() => writeTable(name, data));
  saveChains.set(name, next);
  return next;
}

type POSTables = Pick<POSDatabase, 'products' | 'categories' | 'units' | 'orders' | 'orderItems' | 'orderEditLogs' | 'customers' | 'customerTransactions' | 'customerReminders' | 'suppliers' | 'supplierPurchases' | 'supplierPaymentSchedules' | 'heldCarts'>;

/** Saves a whole list (only what changed is written, a moment later). */
export function saveArrayToDexie(tableName: keyof POSDatabase, data: any[]): Promise<void> {
  const name = String(tableName);
  queuedData.set(name, data);
  if (!saveTimers.has(name)) {
    saveTimers.set(name, setTimeout(() => void runQueuedSave(name), SAVE_DEBOUNCE_MS));
  }
  return Promise.resolve();
}

/** Writes everything still waiting for its debounce. Used when the window closes or hides. */
export async function flushDexieSaves(): Promise<void> {
  for (const [name, timer] of [...saveTimers]) {
    clearTimeout(timer);
    void runQueuedSave(name);
  }
  await Promise.all([...saveChains.values()]);
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => void flushDexieSaves());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushDexieSaves();
  });
}

export async function loadArrayFromDexie(tableName: keyof POSDatabase): Promise<any[]> {
  try {
    const table = db[tableName] as Table<any, any>;
    if (!table) return [];
    const rows = await table.toArray();
    // What was just read is what is stored, so later saves only write the difference.
    // (The caller's state may sort the array, but keeps these same row objects.)
    savedRows.set(String(tableName), new Map(rows.map((row: RowWithId) => [row.id, row])));
    return rows;
  } catch (err) {
    logger.error('db', `Failed to load table ${String(tableName)} from IndexedDB`, serializeError(err));
    return [];
  }
}

export async function saveSettingsToDexie(settings: StoreSettings) {
  try {
    await db.settings.clear();
    await db.settings.put(settings);
  } catch (err) {
    logger.error('db', 'Failed to save settings to IndexedDB', serializeError(err));
  }
}

export async function loadSettingsFromDexie(): Promise<StoreSettings | null> {
  try {
    const all = await db.settings.toArray();
    return all.length > 0 ? all[0] : null;
  } catch (err) {
    logger.error('db', 'Failed to load settings from IndexedDB', serializeError(err));
    return null;
  }
}
