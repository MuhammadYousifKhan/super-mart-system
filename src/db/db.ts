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
  }
}

export const db = new POSDatabase();

export async function saveArrayToDexie(tableName: keyof POSDatabase, data: any[]) {
  try {
    const table = db[tableName] as Table<any, any>;
    if (!table) return;
    await db.transaction('rw', table, async () => {
      await table.clear();
      await table.bulkPut(data);
    });
  } catch (err) {
    console.error(`Failed to save array to Dexie table ${String(tableName)}:`, err);
  }
}

export async function loadArrayFromDexie(tableName: keyof POSDatabase): Promise<any[]> {
  try {
    const table = db[tableName] as Table<any, any>;
    if (!table) return [];
    return await table.toArray();
  } catch (err) {
    console.error(`Failed to load array from Dexie table ${String(tableName)}:`, err);
    return [];
  }
}

export async function saveSettingsToDexie(settings: StoreSettings) {
  try {
    await db.settings.clear();
    await db.settings.put(settings);
  } catch (err) {
    console.error('Failed to save settings to Dexie:', err);
  }
}

export async function loadSettingsFromDexie(): Promise<StoreSettings | null> {
  try {
    const all = await db.settings.toArray();
    return all.length > 0 ? all[0] : null;
  } catch (err) {
    console.error('Failed to load settings from Dexie:', err);
    return null;
  }
}
