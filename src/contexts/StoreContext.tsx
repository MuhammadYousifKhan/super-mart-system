import { todayLocal, nextDueDate, isValidLocalDate, toLocalISODate } from '@/lib/dates';
import React, { useState, useEffect, useRef, useCallback, ReactNode, type Dispatch, type SetStateAction } from 'react';
import {
  Product,
  Category,
  Unit,
  Order,
  OrderItem,
  OrderEditLog,
  StoreSettings,
  CartItem,
  HeldCart,
  PaymentMethod,
  TransferType,
  Customer,
  CustomerTransaction,
  CustomerReminder,
  ReminderFrequency,
  Supplier,
  SupplierPurchase,
  SupplierPaymentSchedule,
  ScheduleFrequency,
} from '@/types/pos';
import { useAuth } from './useAuth';
import { StoreContext } from './StoreContextValue';
import { supabase, getCloudWriteActivity } from '@/lib/supabase';
import {
  fetchCloudSnapshot,
  mapCustomer,
  mapCustomerReminder,
  mapCustomerTransaction,
  mapOrder,
  mapOrderEditLog,
  mapOrderItem,
  mapProduct,
  mapSettings,
  mapSupplier,
  mapSupplierPaymentSchedule,
  mapSupplierPurchase,
  type CloudSnapshot,
} from '@/lib/cloudSnapshot';
import { toast } from 'sonner';
import {
  applyCustomerLedger,
  applySupplierLedger,
  customerPaymentCharges,
  customerTxEffect,
  editedCustomerTransaction,
  editedSupplierPurchase,
  isCreditReversal,
  isValidAmount,
} from '@/lib/ledger';
import { db, saveArrayToDexie, loadArrayFromDexie, saveSettingsToDexie, loadSettingsFromDexie } from '@/db/db';
import { computeEditedOrderTotals } from '@/lib/orderMath';
import {
  billNumber,
  cancelBlockReason,
  computeExchange,
  describeExchange,
  editBlockReason,
  exchangeBlockReason,
  getReturnableLines,
  isExchangeOrder,
  type ExchangeNewItem,
  type ExchangeReturn,
} from '@/lib/exchange';

interface CreateOrderOptions {
  items: CartItem[];
  paymentMethod: PaymentMethod;
  globalDiscount: number;
  globalDiscountType: 'fixed' | 'percentage';
  amountTendered?: number;
  clientName?: string;
  clientPhone?: string;
  transferType?: TransferType;
  transactionId?: string;
  customerId?: string;
}

/** How the difference on an exchange is settled. */
export interface ExchangeSettlement {
  /** credit = the customer's account (Digi Khata). */
  paymentMethod: PaymentMethod;
  /** Cash handed over when the customer pays the difference. */
  amountTendered?: number;
  customerId?: string;
  transferType?: TransferType;
  transactionId?: string;
}

/** A line on a bill being edited. */
export interface BillEditLine {
  /** The bill line this came from, if any (lines of deleted products have no product to match on). */
  sourceItemId?: string;
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  unitPrice: number;
  /** Discount on the whole line. */
  discountAmount: number;
}

export interface StoreContextType {
  // Products (the functions returning boolean say whether the change was made; refusals are shown as a toast)
  products: Product[];
  addProduct: (product: Omit<Product, 'id'>) => boolean;
  updateProduct: (id: string, product: Partial<Product>) => boolean;
  deleteProducts: (ids: string[]) => void;
  adjustProductStock: (productId: string, delta: number, reason?: string, orderId?: string) => Promise<void>;
  getProductBySku: (sku: string) => Product | undefined;

  // Units
  units: Unit[];
  addUnit: (unit: Omit<Unit, 'id'>) => boolean;
  updateUnit: (id: string, unit: Partial<Unit>) => boolean;
  /** Products still using the unit are moved to `replacementId` first; refused when some use it and none is given. */
  deleteUnit: (id: string, replacementId?: string) => boolean;
  getUnitById: (id: string) => Unit | undefined;

  // Categories
  categories: Category[];
  addCategory: (category: Omit<Category, 'id'>) => boolean;
  updateCategory: (id: string, category: Partial<Category>) => boolean;
  /** Products still in the category are moved to `replacementId` first; refused when some are and none is given. */
  deleteCategory: (id: string, replacementId?: string) => boolean;

  // Customers (Digi Khata)
  customers: Customer[];
  customerTransactions: CustomerTransaction[];
  customerReminders: CustomerReminder[];
  addCustomer: (customer: Omit<Customer, 'id' | 'createdAt' | 'totalCredit' | 'totalPaid' | 'balance'>) => void;
  updateCustomer: (id: string, customer: Partial<Customer>) => void;
  deleteCustomer: (id: string) => void;
  getCustomerById: (id: string) => Customer | undefined;
  addCustomerPayment: (customerId: string, amount: number, description: string, paymentMethod: 'cash' | 'card') => boolean;
  /** `date` is YYYY-MM-DD; the entry keeps its time of day. Bill entries only allow the description to change. */
  updateCustomerTransaction: (
    id: string,
    updates: { amount?: number; description?: string; paymentMethod?: 'cash' | 'card'; date?: string }
  ) => boolean;
  /** Refused for entries that belong to a bill. */
  deleteCustomerTransaction: (id: string) => boolean;
  getCustomerTransactions: (customerId: string) => CustomerTransaction[];
  addCustomerReminder: (customerId: string, frequency: ReminderFrequency, nextReminderDate: string, note?: string) => boolean;
  updateCustomerReminder: (id: string, updates: Partial<CustomerReminder>) => boolean;
  deleteCustomerReminder: (id: string) => void;
  getCustomerReminders: (customerId: string) => CustomerReminder[];
  getDueCustomerReminders: () => CustomerReminder[];
  markReminderTriggered: (id: string) => void;

  // Suppliers
  suppliers: Supplier[];
  supplierPurchases: SupplierPurchase[];
  supplierPaymentSchedules: SupplierPaymentSchedule[];
  addSupplier: (supplier: Omit<Supplier, 'id' | 'createdAt' | 'totalPurchased' | 'totalPaid' | 'balance'>) => void;
  updateSupplier: (id: string, updates: Partial<Supplier>) => void;
  deleteSupplier: (id: string) => void;
  getSupplierById: (id: string) => Supplier | undefined;
  /** `amount` is negative for a payment to the supplier. */
  addSupplierPurchase: (purchase: Omit<SupplierPurchase, 'id' | 'createdAt'>) => boolean;
  receiveSupplierStock: (input: {
    productId: string;
    supplierId: string;
    quantity: number;
    unitCost?: number;
    paidAmount?: number;
    purchaseDate?: string;
    invoiceNumber?: string;
    note?: string;
  }) => boolean;
  receiveSupplierStockBatch: (input: {
    supplierId: string;
    items: Array<{
      productId: string;
      quantity: number;
      unitCost?: number;
      expiryDate?: string;
      note?: string;
    }>;
    paidAmount?: number;
    purchaseDate?: string;
    invoiceNumber?: string;
    note?: string;
  }) => boolean;
  getSupplierPurchases: (supplierId: string) => SupplierPurchase[];
  /** `amount` is signed (negative = payment); `purchaseDate` is YYYY-MM-DD; an empty invoice number clears it. */
  updateSupplierPurchase: (
    id: string,
    updates: { amount?: number; description?: string; purchaseDate?: string; invoiceNumber?: string }
  ) => boolean;
  deleteSupplierPurchase: (id: string) => boolean;
  addSupplierPaymentSchedule: (schedule: Omit<SupplierPaymentSchedule, 'id' | 'createdAt' | 'isActive' | 'lastPaidAt'>) => boolean;
  updateSupplierPaymentSchedule: (id: string, updates: Partial<SupplierPaymentSchedule>) => boolean;
  deleteSupplierPaymentSchedule: (id: string) => void;
  getSupplierPaymentSchedules: (supplierId: string) => SupplierPaymentSchedule[];
  getDueSupplierPaymentSchedules: () => SupplierPaymentSchedule[];
  markSupplierSchedulePaid: (id: string) => boolean;

  // Orders
  orders: Order[];
  orderItems: OrderItem[];
  orderEditLogs: OrderEditLog[];
  createOrder: (options: CreateOrderOptions) => Promise<Order>;
  updateOrder: (id: string, updates: Partial<Order>) => Promise<void>;
  /** Saves an edited bill. `orderUpdates.customerId` present but empty removes the customer. Resolves false if refused. */
  updateOrderFull: (id: string, newItems: BillEditLine[], orderUpdates: Partial<Order>) => Promise<boolean>;
  /** Cancels a bill or an exchange and puts everything back. Resolves false if refused. */
  cancelOrder: (id: string, reason?: string) => Promise<boolean>;
  /**
   * Records a return/exchange against a bill as a new order (see Order.originalOrderId).
   * Throws an Error with a message for the cashier when it can't be done.
   */
  createExchange: (
    originalOrderId: string,
    returns: Array<{ itemId: string; quantity: number }>,
    newItems: Array<{ productId: string; quantity: number; unitPrice: number; discountAmount: number }>,
    settlement: ExchangeSettlement
  ) => Promise<Order>;
  getOrderItems: (orderId: string) => OrderItem[];
  getOrderEditLogs: (orderId: string) => OrderEditLog[];
  getCustomerOrders: (customerId: string) => Order[];

  // Settings
  settings: StoreSettings;
  updateSettings: (settings: Partial<StoreSettings>) => void;

  // Cart
  cart: CartItem[];
  addToCart: (product: Product, quantity?: number) => void;
  updateCartItem: (productId: string, updates: Partial<CartItem>) => void;
  removeFromCart: (productId: string) => void;
  clearCart: () => void;
  globalDiscount: number;
  globalDiscountType: 'fixed' | 'percentage';
  setGlobalDiscount: (amount: number, type: 'fixed' | 'percentage') => void;

  // Held carts
  heldCarts: HeldCart[];
  holdCart: (note?: string) => void;
  recallCart: (id: string) => void;
  deleteHeldCart: (id: string) => void;

  // Calculations
  calculateSubtotal: () => number;
  calculateTax: () => number;
  calculateTotal: () => number;
  calculateItemDiscount: (item: CartItem) => number;
  calculateGlobalDiscountAmount: () => number;
  manualSync: () => Promise<void>;
  syncStatus: SyncStatus;
}

export interface SyncStatus {
  online: boolean;
  syncing: boolean;
  /** Changes saved on this device that are not in the cloud yet. */
  pending: number;
  /** Changes the database keeps rejecting; Sync now retries them. */
  failed: number;
  lastError?: string;
  lastSyncedAt: string | null;
  /** The database still needs MULTI_PC_SETUP.sql; changes wait on this device until then. */
  needsDbUpdate: boolean;
  /** Receiving other PCs' changes instantly. */
  live: boolean;
}

type PendingSyncOperationType =
  | 'order_with_items'
  | 'customer_add'
  | 'customer_update'
  | 'customer_delete'
  | 'customer_payment'
  | 'customer_transaction_update'
  | 'customer_transaction_delete'
  | 'customer_credit'
  | 'customer_reminder_add'
  | 'customer_reminder_update'
  | 'customer_reminder_delete'
  | 'supplier_add'
  | 'supplier_update'
  | 'supplier_delete'
  | 'supplier_purchase_add'
  | 'supplier_payment_add'
  | 'supplier_stock_receive'
  | 'supplier_stock_receive_batch'
  | 'supplier_schedule_add'
  | 'supplier_schedule_update'
  | 'supplier_schedule_delete'
  | 'supplier_purchase_update'
  | 'supplier_purchase_delete'
  | 'product_add'
  | 'product_update'
  | 'product_delete'
  | 'db_writes'
  | 'stock_movement';

interface PendingSyncOperation {
  id: string;
  type: PendingSyncOperationType;
  payload: any;
  createdAt: string;
  retryCount: number;
  lastError?: string;
  /** Set aside after repeated database (not connection) errors so it can't block the queue. */
  parked?: boolean;
}

interface SyncResult {
  synced: number;
  failed: number;
  reason?: 'offline' | 'signed-out' | 'unconfigured';
}

const DEFAULT_SETTINGS: StoreSettings = {
  storeName: 'My Store',
  address: '123 Main Street, City',
  phone: '(555) 123-4567',
  taxRate: 10,
  cardFeePercent: 2,
  receiptFooterMessage: 'Thank you for your purchase!',
  allowNegativeStock: false,
};

const PENDING_SYNC_STORAGE_KEY = 'pos_pending_sync_ops_v1';

function loadPendingSyncQueue(): PendingSyncOperation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PENDING_SYNC_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function calculateNextReminderDate(currentDate: string, frequency: ReminderFrequency): string {
  return nextDueDate(currentDate, frequency);
}

function calculateNextScheduleDate(currentDate: string, frequency: ScheduleFrequency): string {
  return nextDueDate(currentDate, frequency);
}

const SAMPLE_UNITS: Unit[] = [
  { id: 'unit-pcs', name: 'Pieces', description: 'Individual pieces' },
  { id: 'unit-pkt', name: 'Packets', description: 'Packets/Packs' },
  { id: 'unit-kg', name: 'Kilograms', description: 'Weight in kilograms' },
  { id: 'unit-ltr', name: 'Liters', description: 'Volume in liters' },
  { id: 'unit-box', name: 'Boxes', description: 'Box/carton' },
  { id: 'unit-dozen', name: 'Dozens', description: 'Set of 12 items' },
  { id: 'unit-gram', name: 'Grams', description: 'Weight in grams' },
  { id: 'unit-ml', name: 'Milliliters', description: 'Volume in milliliters' },
];

const SAMPLE_CATEGORIES: Category[] = [
  { id: 'cat-grocery', name: 'Grocery', description: 'Fresh and packaged grocery items' },
  { id: 'cat-toys-sports', name: 'Toys/Sports', description: 'Toys and sports equipment' },
  { id: 'cat-cleaning', name: 'Cleaning', description: 'Cleaning supplies and products' },
  { id: 'cat-fragrances', name: 'Fragrances', description: 'Perfumes and fragrances' },
  { id: 'cat-cosmetics', name: 'Cosmetics', description: 'Beauty and cosmetic products' },
  { id: 'cat-food', name: 'Food', description: 'Ready-to-eat food and snacks' },
  { id: 'cat-detergents', name: 'Detergents', description: 'Laundry and cleaning detergents' },
  { id: 'cat-frozen', name: 'Frozen Items', description: 'Frozen foods and ice cream' },
];

const SAMPLE_PRODUCTS: Product[] = [
  { id: 'prod-1', sku: 'GROC-001', name: 'Organic Coffee', description: '500g ground coffee', categoryId: 'cat-grocery', unitId: 'unit-pkt', costPrice: 1200, sellingPrice: 2200, stockQuantity: 65, lowStockThreshold: 15, expiryDate: '2026-09-15', barcode: '9780201379624', barcodeEnabled: true },
  { id: 'prod-2', sku: 'GROC-002', name: 'Green Tea Pack', description: '50 tea bags', categoryId: 'cat-grocery', unitId: 'unit-box', costPrice: 600, sellingPrice: 1100, stockQuantity: 3, lowStockThreshold: 10, expiryDate: '2026-12-31', barcode: '9780067234005', barcodeEnabled: true },
  { id: 'prod-3', sku: 'FOOD-001', name: 'Milk 1L', description: 'Fresh milk', categoryId: 'cat-food', unitId: 'unit-ltr', costPrice: 80, sellingPrice: 150, stockQuantity: 25, lowStockThreshold: 5, expiryDate: '2026-04-02', barcode: '5000157101066', barcodeEnabled: true },
  { id: 'prod-4', sku: 'FOOD-002', name: 'Bread', description: 'Whole wheat bread', categoryId: 'cat-food', unitId: 'unit-pcs', costPrice: 60, sellingPrice: 120, stockQuantity: 8, lowStockThreshold: 10, expiryDate: '2026-03-28', barcode: '5000275041222', barcodeEnabled: true },
  { id: 'prod-5', sku: 'FROZEN-001', name: 'Ice Cream', description: 'Vanilla ice cream', categoryId: 'cat-frozen', unitId: 'unit-box', costPrice: 150, sellingPrice: 300, stockQuantity: 12, lowStockThreshold: 5, expiryDate: '2027-01-31', barcode: '0020000028420', barcodeEnabled: true },
  { id: 'prod-6', sku: 'CLEAN-001', name: 'Dish Soap', description: '500ml dish cleaning liquid', categoryId: 'cat-cleaning', unitId: 'unit-ltr', costPrice: 120, sellingPrice: 200, stockQuantity: 35, lowStockThreshold: 8, barcode: '5901362011915', barcodeEnabled: true },
];


// Sales save the product's cost so profit stays correct later. Until the `unit_cost_at_sale`
// column is added in Supabase (see SUPABASE_SETUP.sql), saving without it keeps sales working.
const isMissingCostColumnError = (error: { message?: string } | null | undefined) =>
  !!error?.message && error.message.includes('unit_cost_at_sale');

const withoutCostColumn = <T extends { unit_cost_at_sale?: unknown }>(rows: T[]) =>
  rows.map(({ unit_cost_at_sale: _cost, ...rest }) => rest);

// A bill can mention a product or customer deleted since (on this PC or another one). The database
// clears such links on rows it already has (on delete set null) but rejects new rows carrying them,
// which would hold up every later change. Those bills are saved without the link instead.
const isForeignKeyError = (
  error: { code?: string; message?: string; details?: string } | null | undefined,
  column: string
) => !!error && error.code === '23503' && `${error.message ?? ''} ${error.details ?? ''}`.includes(column);

const orderItemRow = (item: OrderItem) => ({
  id: item.id,
  order_id: item.orderId,
  // Empty (or null from the cloud) once the product no longer exists.
  product_id: item.productId || null,
  product_name: item.productName,
  product_sku: item.productSku,
  quantity: item.quantity,
  unit_price_at_sale: item.unitPriceAtSale,
  unit_cost_at_sale: item.unitCostAtSale ?? null,
  discount_amount: item.discountAmount,
});
type OrderItemRow = ReturnType<typeof orderItemRow>;

async function upsertOrderItemRows(rows: OrderItemRow[]) {
  let { error } = await supabase.from('order_items').upsert(rows, { onConflict: 'id' });
  if (isMissingCostColumnError(error)) {
    ({ error } = await supabase.from('order_items').upsert(withoutCostColumn(rows), { onConflict: 'id' }));
  }
  if (!isForeignKeyError(error, 'product_id')) return error;
  // Lines of products deleted meanwhile keep their own name/SKU copy, just not the link.
  const ids = [...new Set(rows.map((r) => r.product_id).filter((id): id is string => !!id))];
  const { data, error: readError } = await supabase.from('products').select('id').in('id', ids);
  if (readError) return readError;
  const existing = new Set((data || []).map((p: { id: string }) => p.id));
  const unlinked = rows.map((r) => (r.product_id && !existing.has(r.product_id) ? { ...r, product_id: null } : r));
  ({ error } = await supabase.from('order_items').upsert(unlinked, { onConflict: 'id' }));
  if (isMissingCostColumnError(error)) {
    ({ error } = await supabase.from('order_items').upsert(withoutCostColumn(unlinked), { onConflict: 'id' }));
  }
  return error;
}

const orderEditLogRow = (log: OrderEditLog) => ({
  id: log.id,
  order_id: log.orderId,
  edited_by: log.editedBy,
  edited_at: log.editedAt,
  changes_summary: log.changesSummary,
  previous_order: log.previousOrder ?? null,
  previous_items: log.previousItems ?? null,
});

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A plain database write. Used for queued changes that have no dedicated operation type.
 * Inserts are sent as upserts so a retry after a lost response never creates a duplicate.
 */
type DbWrite =
  | { table: string; kind: 'upsert'; rows: Record<string, unknown> | Record<string, unknown>[] }
  | { table: string; kind: 'update'; values: Record<string, unknown>; eq: [string, unknown] }
  | { table: string; kind: 'delete'; eq?: [string, unknown]; in?: [string, unknown[]] };

// Customer and supplier totals are kept by the database from their ledgers (MULTI_PC_SETUP.sql), so
// two PCs can never overwrite each other's figures. The app only shows them; it never uploads them.
const SERVER_MANAGED_COLUMNS: Record<string, string[]> = {
  customers: ['total_credit', 'total_paid', 'balance'],
  suppliers: ['total_purchased', 'total_paid', 'balance'],
};

function withoutServerTotals<T extends Record<string, unknown>>(table: string, values: T): Partial<T> {
  const managed = SERVER_MANAGED_COLUMNS[table];
  if (!managed) return values;
  return Object.fromEntries(Object.entries(values).filter(([key]) => !managed.includes(key))) as Partial<T>;
}

/** Updates a customer/supplier row, leaving out the totals the database maintains. */
async function updateWithoutTotals(table: 'customers' | 'suppliers', values: Record<string, unknown> | undefined, id: string) {
  const rest = withoutServerTotals(table, values || {});
  if (Object.keys(rest).length === 0) return;
  const { error } = await supabase.from(table).update(rest).eq('id', id);
  if (error) throw error;
}

/**
 * A supplier ledger entry as a database row. Description and date are required there, so an entry
 * queued without them (by an older version) still uploads instead of being rejected for ever.
 */
function supplierPurchaseRow(p: SupplierPurchase) {
  return {
    id: p.id,
    supplier_id: p.supplierId,
    description: p.description?.trim() || (p.amount < 0 ? 'Payment to supplier' : 'Purchase'),
    amount: p.amount,
    purchase_date: p.purchaseDate || toLocalISODate(p.createdAt ? new Date(p.createdAt) : new Date()),
    invoice_number: p.invoiceNumber,
    created_at: p.createdAt,
  };
}

/** A stock change, applied by the database exactly once (see apply_stock_movement). */
interface StockMovement {
  id: string;
  productId: string;
  delta: number;
  reason: string;
  orderId?: string;
  createdAt: string;
}

async function applyStockMovement(m: StockMovement) {
  const { error } = await supabase.rpc('apply_stock_movement', {
    p_id: m.id,
    p_product_id: m.productId,
    p_delta: m.delta,
    p_reason: m.reason,
    p_order_id: m.orderId ?? null,
    p_created_at: m.createdAt,
  });
  if (error) throw error;
}

async function runDbWrite(write: DbWrite): Promise<void> {
  const table = supabase.from(write.table);
  let result: { error: { message?: string } | null };
  if (write.kind === 'upsert') {
    result = await table.upsert(write.rows, { onConflict: 'id' });
    if (isMissingCostColumnError(result.error) && Array.isArray(write.rows)) {
      result = await supabase.from(write.table).upsert(withoutCostColumn(write.rows), { onConflict: 'id' });
    }
  } else if (write.kind === 'update') {
    const values = withoutServerTotals(write.table, write.values);
    if (Object.keys(values).length === 0) return;
    result = await table.update(values).eq(write.eq[0], write.eq[1]);
  } else if (write.in) {
    result = await table.delete().in(write.in[0], write.in[1]);
  } else if (write.eq) {
    result = await table.delete().eq(write.eq[0], write.eq[1]);
  } else {
    throw new Error('Refusing to delete without a filter');
  }
  if (result.error) throw result.error;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) return String((error as { message: unknown }).message);
  return 'Unknown sync error';
}

/** Connection problems (and expired logins) are retried for ever; anything else is a database rejection. */
function isTransientSyncError(message: string): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  return /failed to fetch|fetch failed|networkerror|network request failed|load failed|timed out|timeout|abort|err_|enotfound|econn|jwt|401|503|502|504/i.test(
    message
  );
}

const MAX_DATABASE_ERROR_RETRIES = 5;
// How often the background check runs. With live updates working, a full reload from the cloud
// only happens every FULL_REFRESH_WHEN_LIVE_MS as a safety net.
const BACKGROUND_REFRESH_MS = 60000;
const FULL_REFRESH_WHEN_LIVE_MS = 10 * 60000;
// The database version this app needs (see MULTI_PC_SETUP.sql).
const REQUIRED_SCHEMA_VERSION = 3;
// Tables whose changes on other PCs are applied here as they happen.
const LIVE_TABLES = [
  'products', 'orders', 'order_items', 'customers', 'customer_transactions', 'customer_reminders',
  'suppliers', 'supplier_purchases', 'supplier_payment_schedules', 'categories', 'units', 'store_settings',
  'order_edit_logs',
];

interface LiveChange {
  table: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  row: Record<string, unknown>;
  oldRow: Record<string, unknown>;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const [products, setProducts] = useState<Product[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [settings, setSettings] = useState<StoreSettings>(DEFAULT_SETTINGS);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [globalDiscount, setGlobalDiscountState] = useState(0);
  const [globalDiscountType, setGlobalDiscountType] = useState<'fixed' | 'percentage'>('fixed');
  const [heldCarts, setHeldCarts] = useState<HeldCart[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerTransactions, setCustomerTransactions] = useState<CustomerTransaction[]>([]);
  const [customerReminders, setCustomerReminders] = useState<CustomerReminder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierPurchases, setSupplierPurchases] = useState<SupplierPurchase[]>([]);
  const [supplierPaymentSchedules, setSupplierPaymentSchedules] = useState<SupplierPaymentSchedule[]>([]);
  const [orderEditLogs, setOrderEditLogs] = useState<OrderEditLog[]>([]);
  const [pendingSyncOps, setPendingSyncOps] = useState<PendingSyncOperation[]>(() => loadPendingSyncQueue());
  const [loading, setLoading] = useState(true);
  // Local (IndexedDB) copies are only written once the initial load has finished,
  // otherwise the empty startup state would wipe them before they are read.
  const [isHydrated, setIsHydrated] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const pendingSyncTimer = useRef<number | null>(null);
  const signedInRef = useRef(!!user);
  signedInRef.current = !!user;
  // Always the latest products, so stock maths never starts from a stale snapshot.
  const productsRef = useRef<Product[]>([]);
  productsRef.current = products;
  // The ref is the source of truth for the queue (state mirrors it for rendering and saving), so
  // timers and in-flight runs never act on a stale copy.
  const pendingSyncOpsRef = useRef<PendingSyncOperation[]>(pendingSyncOps);
  const updateQueue = useCallback((fn: (ops: PendingSyncOperation[]) => PendingSyncOperation[]) => {
    const next = fn(pendingSyncOpsRef.current);
    pendingSyncOpsRef.current = next;
    setPendingSyncOps(next);
  }, []);
  const processingRef = useRef<Promise<SyncResult> | null>(null);
  const processQueueRef = useRef<() => Promise<SyncResult>>(async () => ({ synced: 0, failed: 0 }));
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [needsDbUpdate, setNeedsDbUpdate] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const isLiveRef = useRef(false);
  const serverReadyRef = useRef(false);
  // Live changes from other PCs that arrived while this PC still had uploads waiting.
  const liveBufferRef = useRef<LiveChange[]>([]);
  const flushLiveBufferRef = useRef<() => void>(() => {});
  const lastFullRefreshRef = useRef(0);

  const scheduleSync = useCallback((delayMs: number) => {
    if (pendingSyncTimer.current !== null) window.clearTimeout(pendingSyncTimer.current);
    pendingSyncTimer.current = window.setTimeout(() => {
      pendingSyncTimer.current = null;
      void processQueueRef.current();
    }, delayMs);
  }, []);

  // Every cloud write goes through this queue, in order. The change is already shown and saved on
  // this device; the queue uploads it in the background straight away and keeps retrying while
  // the internet is down. (Writing directly could let an older queued change land after a newer one.)
  const enqueuePendingSync = useCallback(
    (type: PendingSyncOperationType, payload: any) => {
      updateQueue((ops) => [
        ...ops,
        { id: generateId(), type, payload, createdAt: new Date().toISOString(), retryCount: 0 },
      ]);
      scheduleSync(0);
    },
    [updateQueue, scheduleSync]
  );

  const executePendingSyncOperation = useCallback(async (op: PendingSyncOperation) => {
    switch (op.type) {
      case 'order_with_items': {
        // A new bill, an exchange, or an edited bill (the whole bill again, plus the lines it no longer has).
        const payload = op.payload as { order: Order; orderItems: OrderItem[]; removeItemIds?: string[] };
        const { order, orderItems, removeItemIds } = payload;
        const orderRow = {
          id: order.id,
          created_at: order.createdAt,
          cashier_id: order.cashierId,
          cashier_name: order.cashierName,
          subtotal: order.subtotal,
          tax_amount: order.taxAmount,
          discount_amount: order.discountAmount,
          total_amount: order.totalAmount,
          card_fee_amount: order.cardFeeAmount ?? 0,
          card_fee_rate: order.cardFeeRate ?? 0,
          payment_method: order.paymentMethod,
          status: order.status,
          // Sent as null when empty, so a value cleared on an edited bill is cleared in the cloud too.
          amount_tendered: order.amountTendered ?? null,
          change_given: order.changeGiven ?? null,
          client_name: order.clientName ?? null,
          client_phone: order.clientPhone ?? null,
          transfer_type: order.transferType ?? null,
          transaction_id: order.transactionId ?? null,
          customer_id: order.customerId || null,
          original_order_id: order.originalOrderId ?? null,
        };
        let { error: orderError } = await supabase.from('orders').upsert(orderRow, { onConflict: 'id' });
        if (isForeignKeyError(orderError, 'customer_id')) {
          // The customer was deleted meanwhile: keep the sale, without the link.
          ({ error: orderError } = await supabase.from('orders').upsert({ ...orderRow, customer_id: null }, { onConflict: 'id' }));
        }
        if (orderError) throw orderError;

        // New lines are written before old ones are removed, so a failure never leaves the bill empty.
        const itemsError = await upsertOrderItemRows(orderItems.map(orderItemRow));
        if (itemsError) throw itemsError;

        if (removeItemIds && removeItemIds.length > 0) {
          const { error } = await supabase.from('order_items').delete().in('id', removeItemIds);
          if (error) throw error;
        }
        return;
      }

      case 'product_add': {
        // omitStock: the opening stock is a separate stock movement, so a retried upsert can never
        // reset stock that other PCs have changed since.
        const payload = op.payload as { newProduct: Product; omitStock?: boolean };
        const p = payload.newProduct;
        const { error } = await supabase.from('products').upsert(
          {
            ...(payload.omitStock ? {} : { stock_quantity: p.stockQuantity }),
            id: p.id,
            sku: p.sku,
            name: p.name,
            description: p.description,
            category_id: p.categoryId,
            unit_id: p.unitId,
            cost_price: p.costPrice,
            selling_price: p.sellingPrice,
            low_stock_threshold: p.lowStockThreshold,
            expiry_date: p.expiryDate || null,
            barcode: p.barcode || null,
            barcode_enabled: p.barcodeEnabled || false,
          },
          { onConflict: 'id' }
        );
        if (error) throw error;
        return;
      }

      case 'product_update': {
        const payload = op.payload as { id: string; dbUpdates: Record<string, unknown> };
        const { error } = await supabase
          .from('products')
          .update(payload.dbUpdates)
          .eq('id', payload.id);
        if (error) throw error;
        return;
      }

      case 'product_delete': {
        const payload = op.payload as { ids: string[] };
        const { error } = await supabase
          .from('products')
          .delete()
          .in('id', payload.ids);
        if (error) throw error;
        return;
      }

      case 'customer_add': {
        const payload = op.payload as { customer: Customer };
        const c = payload.customer;
        const { error } = await supabase
          .from('customers')
          .upsert(
            {
              id: c.id,
              name: c.name,
              phone: c.phone,
              address: c.address,
              nic: c.nic,
              created_at: c.createdAt,
            },
            { onConflict: 'id' }
          );
        if (error) throw error;
        return;
      }

      case 'customer_update': {
        const payload = op.payload as { id: string; dbUpdates: Record<string, unknown> };
        await updateWithoutTotals('customers', payload.dbUpdates, payload.id);
        return;
      }

      case 'customer_delete': {
        const payload = op.payload as { id: string };
        const { error } = await supabase
          .from('customers')
          .delete()
          .eq('id', payload.id);
        if (error) throw error;
        return;
      }

      // The customer's totals follow from the ledger entry in the database. (Older queued entries
      // also carry totals; those are ignored.)
      case 'customer_payment':
      case 'customer_credit': {
        const payload = op.payload as { transaction: CustomerTransaction };
        const t = payload.transaction;
        const { error } = await supabase.from('customer_transactions').upsert(
          {
            id: t.id,
            customer_id: t.customerId,
            order_id: t.orderId,
            type: t.type,
            amount: t.amount,
            payment_method: t.paymentMethod,
            card_fee_rate: t.cardFeeRate,
            card_fee_amount: t.cardFeeAmount,
            total_charged: t.totalCharged,
            description: t.description,
            created_at: t.createdAt,
          },
          { onConflict: 'id' }
        );
        if (error) throw error;
        return;
      }

      case 'customer_reminder_add': {
        const payload = op.payload as { reminder: CustomerReminder };
        const r = payload.reminder;
        const { error } = await supabase.from('customer_reminders').upsert(
          {
            id: r.id,
            customer_id: r.customerId,
            frequency: r.frequency,
            next_reminder_date: r.nextReminderDate,
            is_active: r.isActive,
            note: r.note,
            created_at: r.createdAt,
            last_triggered_at: r.lastTriggeredAt,
          },
          { onConflict: 'id' }
        );
        if (error) throw error;
        return;
      }

      case 'customer_reminder_update': {
        const payload = op.payload as { id: string; dbUpdates: Record<string, unknown> };
        const { error } = await supabase
          .from('customer_reminders')
          .update(payload.dbUpdates)
          .eq('id', payload.id);
        if (error) throw error;
        return;
      }

      case 'customer_reminder_delete': {
        const payload = op.payload as { id: string };
        const { error } = await supabase
          .from('customer_reminders')
          .delete()
          .eq('id', payload.id);
        if (error) throw error;
        return;
      }

      case 'supplier_add': {
        const payload = op.payload as { supplier: Supplier };
        const s = payload.supplier;
        const { error } = await supabase.from('suppliers').upsert(
          {
            id: s.id,
            name: s.name,
            phone: s.phone,
            address: s.address,
            contact_person: s.contactPerson,
            notes: s.notes,
            created_at: s.createdAt,
          },
          { onConflict: 'id' }
        );
        if (error) throw error;
        return;
      }

      case 'supplier_update': {
        const payload = op.payload as { id: string; dbUpdates: Record<string, unknown> };
        await updateWithoutTotals('suppliers', payload.dbUpdates, payload.id);
        return;
      }

      case 'supplier_delete': {
        const payload = op.payload as { id: string };
        const { error } = await supabase
          .from('suppliers')
          .delete()
          .eq('id', payload.id);
        if (error) throw error;
        return;
      }

      // The supplier's totals follow from the ledger entry in the database. (Older queued entries
      // also carry totals; those are ignored.)
      case 'supplier_purchase_add':
      case 'supplier_payment_add': {
        const payload = op.payload as { purchase: SupplierPurchase };
        const { error } = await supabase
          .from('supplier_purchases')
          .upsert(supplierPurchaseRow(payload.purchase), { onConflict: 'id' });
        if (error) throw error;
        return;
      }

      case 'supplier_stock_receive': {
        const payload = op.payload as {
          productId: string;
          newStockQuantity: number;
          purchase: SupplierPurchase;
          supplierId: string;
          newTotalPurchased: number;
          newTotalPaid: number;
          newBalance: number;
        };

        const [productResult, purchaseResult] = await Promise.all([
          supabase
            .from('products')
            .update({ stock_quantity: payload.newStockQuantity })
            .eq('id', payload.productId),
          supabase.from('supplier_purchases').upsert(
            {
              id: payload.purchase.id,
              supplier_id: payload.purchase.supplierId,
              description: payload.purchase.description,
              amount: payload.purchase.amount,
              purchase_date: payload.purchase.purchaseDate,
              invoice_number: payload.purchase.invoiceNumber,
              created_at: payload.purchase.createdAt,
            },
            { onConflict: 'id' }
          ),
        ]);

        if (productResult.error || purchaseResult.error) {
          throw productResult.error || purchaseResult.error;
        }
        return;
      }

      case 'supplier_stock_receive_batch': {
        const payload = op.payload as {
          productUpdates?: Array<{ productId: string; newStockQuantity: number; newCostPrice: number }>;
          productUpserts?: Product[];
          /** Newer entries: received stock arrives as movements and product rows carry no stock figure. */
          stockMovements?: StockMovement[];
          purchases: SupplierPurchase[];
        };
        const viaMovements = Array.isArray(payload.stockMovements);

        // Products first: a new batch row must exist before stock is added to it.
        if (payload.productUpserts && payload.productUpserts.length > 0) {
          const { error } = await supabase.from('products').upsert(
            payload.productUpserts.map((p) => ({
              ...(viaMovements ? {} : { stock_quantity: p.stockQuantity }),
              id: p.id,
              sku: p.sku,
              name: p.name,
              description: p.description,
              category_id: p.categoryId,
              unit_id: p.unitId,
              cost_price: p.costPrice,
              selling_price: p.sellingPrice,
              low_stock_threshold: p.lowStockThreshold,
              expiry_date: p.expiryDate || null,
              barcode: p.barcode || null,
              barcode_enabled: p.barcodeEnabled,
            })),
            { onConflict: 'id' }
          );
          if (error) throw error;
        } else if (payload.productUpdates && payload.productUpdates.length > 0) {
          for (const item of payload.productUpdates) {
            const { error } = await supabase
              .from('products')
              .update({ stock_quantity: item.newStockQuantity, cost_price: item.newCostPrice })
              .eq('id', item.productId);
            if (error) throw error;
          }
        }
        for (const movement of payload.stockMovements || []) await applyStockMovement(movement);

        // The supplier's totals follow from these ledger entries in the database.
        const { error } = await supabase
          .from('supplier_purchases')
          .upsert(payload.purchases.map(supplierPurchaseRow), { onConflict: 'id' });
        if (error) throw error;
        return;
      }

      case 'supplier_schedule_add': {
        const payload = op.payload as { schedule: SupplierPaymentSchedule };
        const s = payload.schedule;
        const { error } = await supabase.from('supplier_payment_schedules').upsert(
          {
            id: s.id,
            supplier_id: s.supplierId,
            frequency: s.frequency,
            next_payment_date: s.nextPaymentDate,
            amount: s.amount,
            is_active: s.isActive,
            note: s.note,
            created_at: s.createdAt,
            last_paid_at: s.lastPaidAt,
          },
          { onConflict: 'id' }
        );
        if (error) throw error;
        return;
      }

      case 'supplier_schedule_update': {
        const payload = op.payload as { id: string; dbUpdates: Record<string, unknown> };
        const { error } = await supabase
          .from('supplier_payment_schedules')
          .update(payload.dbUpdates)
          .eq('id', payload.id);
        if (error) throw error;
        return;
      }

      case 'supplier_schedule_delete': {
        const payload = op.payload as { id: string };
        const { error } = await supabase
          .from('supplier_payment_schedules')
          .delete()
          .eq('id', payload.id);
        if (error) throw error;
        return;
      }

      case 'customer_transaction_update': {
        const payload = op.payload as {
          id: string;
          dbUpdates?: Record<string, unknown>;
          updates?: { amount?: number; description?: string };
          customerId?: string;
          customerUpdates?: Record<string, unknown>;
        };
        // `updates` is the payload shape written by older app versions.
        const txUpdates: Record<string, unknown> = payload.dbUpdates ?? {};
        if (!payload.dbUpdates && payload.updates) {
          if (payload.updates.amount !== undefined) txUpdates.amount = payload.updates.amount;
          if (payload.updates.description !== undefined) txUpdates.description = payload.updates.description;
        }

        // The customer's totals follow from the edited entry in the database.
        if (Object.keys(txUpdates).length > 0) {
          const { error } = await supabase.from('customer_transactions').update(txUpdates).eq('id', payload.id);
          if (error) throw error;
        }
        return;
      }

      case 'customer_transaction_delete': {
        const payload = op.payload as {
          id: string;
          customerId?: string;
          customerUpdates?: Record<string, unknown>;
        };
        // The customer's totals follow from the removed entry in the database.
        const { error } = await supabase.from('customer_transactions').delete().eq('id', payload.id);
        if (error) throw error;
        return;
      }

      case 'supplier_purchase_update': {
        const payload = op.payload as {
          id: string;
          dbUpdates?: Record<string, unknown>;
          updates?: { amount?: number; description?: string };
          supplierId?: string;
          supplierUpdates?: Record<string, unknown>;
        };
        const purchaseUpdates: Record<string, unknown> = { ...(payload.dbUpdates ?? {}) };
        if (!payload.dbUpdates && payload.updates) {
          if (payload.updates.amount !== undefined) purchaseUpdates.amount = payload.updates.amount;
          if (payload.updates.description !== undefined) purchaseUpdates.description = payload.updates.description;
        }
        // Description and date are required in the database: an empty one would be rejected for ever.
        if ('description' in purchaseUpdates && !String(purchaseUpdates.description ?? '').trim()) delete purchaseUpdates.description;
        if ('purchase_date' in purchaseUpdates && !purchaseUpdates.purchase_date) delete purchaseUpdates.purchase_date;

        // The supplier's totals follow from the edited entry in the database.
        if (Object.keys(purchaseUpdates).length > 0) {
          const { error } = await supabase.from('supplier_purchases').update(purchaseUpdates).eq('id', payload.id);
          if (error) throw error;
        }
        return;
      }

      case 'supplier_purchase_delete': {
        const payload = op.payload as {
          id: string;
          supplierId?: string;
          supplierUpdates?: Record<string, unknown>;
        };
        // The supplier's totals follow from the removed entry in the database.
        const { error } = await supabase.from('supplier_purchases').delete().eq('id', payload.id);
        if (error) throw error;
        return;
      }

      case 'stock_movement': {
        await applyStockMovement((op.payload as { movement: StockMovement }).movement);
        return;
      }

      case 'db_writes': {
        const payload = op.payload as { writes: DbWrite[] };
        // In order: e.g. new bill lines are written before the old ones are removed.
        for (const write of payload.writes) await runDbWrite(write);
        return;
      }

      default:
        // Never report an operation we cannot run as synced: keep it queued with a visible error.
        throw new Error(`Unknown sync operation: ${String((op as { type: string }).type)}`);
    }
  }, []);

  /**
   * Uploads wait until the database has the multi-PC update: stock and balances are applied by
   * the database itself. Until then changes stay safely queued on this device.
   */
  const checkServerReady = useCallback(async (): Promise<'ready' | 'needs-update' | 'unreachable'> => {
    if (serverReadyRef.current) return 'ready';
    const { data, error } = await supabase.rpc('pos_schema_version');
    if (error) {
      if (isTransientSyncError(errorText(error))) return 'unreachable';
      setNeedsDbUpdate(true);
      return 'needs-update';
    }
    if (Number(data) < REQUIRED_SCHEMA_VERSION) {
      setNeedsDbUpdate(true);
      return 'needs-update';
    }
    serverReadyRef.current = true;
    setNeedsDbUpdate(false);
    return 'ready';
  }, []);

  const processPendingSyncQueue = useCallback((): Promise<SyncResult> => {
    if (!import.meta.env.VITE_SUPABASE_URL) {
      return Promise.resolve({ synced: 0, failed: 0, reason: 'unconfigured' });
    }
    if (!user) {
      // RLS only allows signed-in users to write.
      return Promise.resolve({ synced: 0, failed: 0, reason: 'signed-out' });
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return Promise.resolve({ synced: 0, failed: pendingSyncOpsRef.current.length, reason: 'offline' });
    }
    // Join a run that is already in progress so callers can wait for it instead of skipping.
    if (processingRef.current) return processingRef.current;

    const run = async (): Promise<SyncResult> => {
      const snapshot = pendingSyncOpsRef.current.filter((op) => !op.parked);
      if (snapshot.length === 0) return { synced: 0, failed: 0 };
      setIsSyncing(true);

      const server = await checkServerReady();
      if (server !== 'ready') {
        scheduleSync(server === 'unreachable' ? 15000 : 60000);
        return { synced: 0, failed: snapshot.length };
      }

      const succeeded = new Set<string>();
      const failures = new Map<string, Pick<PendingSyncOperation, 'retryCount' | 'lastError' | 'parked'>>();
      let blockedBy: PendingSyncOperation | null = null;

      for (const op of snapshot) {
        try {
          await executePendingSyncOperation(op);
          succeeded.add(op.id);
        } catch (error) {
          const message = errorText(error);
          const retryCount = op.retryCount + 1;
          const parked = !isTransientSyncError(message) && retryCount >= MAX_DATABASE_ERROR_RETRIES;
          failures.set(op.id, { retryCount, lastError: message, parked });
          if (!parked) {
            // Keep changes in order: stop so nothing newer overtakes this one (e.g. an older
            // stock figure landing after a newer one).
            blockedBy = { ...op, retryCount };
            break;
          }
        }
      }

      updateQueue((ops) =>
        ops
          .filter((op) => !succeeded.has(op.id))
          .map((op) => {
            const failure = failures.get(op.id);
            return failure ? { ...op, ...failure } : op;
          })
      );

      if (succeeded.size > 0) {
        setLastSyncedAt(new Date().toISOString());
        // Only mention it when changes had been waiting (e.g. the internet just came back);
        // normal saves upload silently.
        const waited = snapshot.some((op) => succeeded.has(op.id) && Date.now() - Date.parse(op.createdAt) > 30000);
        if (waited) toast.success(`Back online: ${succeeded.size} saved change${succeeded.size === 1 ? '' : 's'} uploaded to the cloud.`);
      }

      const remaining = pendingSyncOpsRef.current.filter((op) => !op.parked).length;
      if (remaining > 0) {
        // Retry with a growing delay when blocked; carry straight on with changes queued meanwhile.
        scheduleSync(blockedBy ? Math.min(60000, 5000 * blockedBy.retryCount) : 0);
      } else {
        // Everything is uploaded: now apply what other PCs changed meanwhile.
        flushLiveBufferRef.current();
      }

      return { synced: succeeded.size, failed: remaining };
    };

    const promise = run().finally(() => {
      processingRef.current = null;
      setIsSyncing(false);
    });
    processingRef.current = promise;
    return promise;
  }, [executePendingSyncOperation, user, updateQueue, scheduleSync, checkServerReady]);
  processQueueRef.current = processPendingSyncQueue;

  // Latest data, so the background refresh can tell whether anything changed on this device meanwhile.
  const dataRef = useRef({
    products, units, categories, orders, orderItems, settings, customers, customerTransactions,
    customerReminders, suppliers, supplierPurchases, supplierPaymentSchedules, orderEditLogs,
  });
  dataRef.current = {
    products, units, categories, orders, orderItems, settings, customers, customerTransactions,
    customerReminders, suppliers, supplierPurchases, supplierPaymentSchedules, orderEditLogs,
  };
  const cloudLoadInProgressRef = useRef(false);
  // Bill history entries found only on this PC that were queued for upload this session.
  const editLogsQueuedRef = useRef(new Set<string>());

  /** Replaces local data with the cloud copy, table by table, skipping tables that did not change. */
  const applyCloudSnapshot = useCallback((snap: CloudSnapshot) => {
    const current = dataRef.current;
    const changed = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
    if (changed(current.categories, snap.categories)) setCategories(snap.categories);
    // Missing optional tables keep the local copy.
    if (snap.units && changed(current.units, snap.units)) setUnits(snap.units);
    if (changed(current.products, snap.products)) setProducts(snap.products);
    if (changed(current.orders, snap.orders)) setOrders(snap.orders);
    if (changed(current.orderItems, snap.orderItems)) setOrderItems(snap.orderItems);
    if (snap.settings) {
      const next = { ...snap.settings, cardFeePercent: snap.settings.cardFeePercent ?? DEFAULT_SETTINGS.cardFeePercent };
      if (changed(current.settings, next)) setSettings(next);
    }
    if (changed(current.customers, snap.customers)) setCustomers(snap.customers);
    if (changed(current.customerTransactions, snap.customerTransactions)) setCustomerTransactions(snap.customerTransactions);
    if (snap.customerReminders && changed(current.customerReminders, snap.customerReminders)) setCustomerReminders(snap.customerReminders);
    if (snap.suppliers && changed(current.suppliers, snap.suppliers)) setSuppliers(snap.suppliers);
    if (snap.supplierPurchases && changed(current.supplierPurchases, snap.supplierPurchases)) setSupplierPurchases(snap.supplierPurchases);
    if (snap.supplierPaymentSchedules && changed(current.supplierPaymentSchedules, snap.supplierPaymentSchedules)) {
      setSupplierPaymentSchedules(snap.supplierPaymentSchedules);
    }
    // Bill history is only ever added to, so entries kept only on this PC (saved before the cloud
    // kept them, or still waiting to upload) are merged in rather than dropped, and uploaded once.
    if (snap.orderEditLogs) {
      const cloudLogs = snap.orderEditLogs;
      const cloudIds = new Set(cloudLogs.map((l) => l.id));
      const localOnly = current.orderEditLogs.filter((l) => !cloudIds.has(l.id));
      setOrderEditLogs((prev) => {
        const merged = [...cloudLogs, ...prev.filter((l) => !cloudIds.has(l.id))].sort(
          (a, b) => Date.parse(a.editedAt) - Date.parse(b.editedAt)
        );
        return changed(prev, merged) ? merged : prev;
      });
      const toUpload = localOnly.filter((l) => !editLogsQueuedRef.current.has(l.id));
      if (toUpload.length > 0) {
        toUpload.forEach((l) => editLogsQueuedRef.current.add(l.id));
        enqueuePendingSync('db_writes', {
          writes: [{ table: 'order_edit_logs', kind: 'upsert', rows: toUpload.map(orderEditLogRow) }],
        });
      }
    }
  }, [enqueuePendingSync]);

  /**
   * Whether a cloud copy fetched since `startedAt` can replace local data without losing anything:
   * every local change is uploaded, no upload is running or started meanwhile, and nothing was
   * changed on this device while it was being fetched.
   */
  const isSafeToApplyCloudCopy = useCallback((startedAt: number, before: typeof dataRef.current) => {
    const { writesInFlight, lastWriteStartedAt } = getCloudWriteActivity();
    const now = dataRef.current;
    return (
      pendingSyncOpsRef.current.every((op) => op.parked) &&
      !processingRef.current &&
      writesInFlight === 0 &&
      lastWriteStartedAt < startedAt &&
      (Object.keys(before) as Array<keyof typeof before>).every((key) => before[key] === now[key])
    );
  }, []);

  /** Brings in changes made on other devices, in the background. Returns true if the cloud copy was applied. */
  const refreshFromCloud = useCallback(async (): Promise<boolean> => {
    if (!import.meta.env.VITE_SUPABASE_URL || !signedInRef.current || cloudLoadInProgressRef.current) return false;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
    const startedAt = Date.now();
    const before = dataRef.current;
    if (!isSafeToApplyCloudCopy(startedAt - 1, before)) return false;
    cloudLoadInProgressRef.current = true;
    try {
      const snapshot = await fetchCloudSnapshot();
      if (!signedInRef.current || !isSafeToApplyCloudCopy(startedAt, before)) return false;
      applyCloudSnapshot(snapshot);
      liveBufferRef.current = [];
      lastFullRefreshRef.current = Date.now();
      setLastSyncedAt(new Date().toISOString());
      return true;
    } catch (error) {
      console.warn('Background refresh failed:', errorText(error));
      return false;
    } finally {
      cloudLoadInProgressRef.current = false;
    }
  }, [applyCloudSnapshot, isSafeToApplyCloudCopy]);
  const refreshFromCloudRef = useRef(refreshFromCloud);
  refreshFromCloudRef.current = refreshFromCloud;

  /** Applies one row changed on another PC (or the echo of this PC's own upload). */
  const applyLiveChange = useCallback((change: LiveChange) => {
    const isDelete = change.eventType === 'DELETE';
    const id = (isDelete ? change.oldRow : change.row)?.id as string | undefined;
    if (id === undefined || id === null) return;

    function upsert<T extends { id: string }>(setter: Dispatch<SetStateAction<T[]>>, mapped: T | null, newestFirst = false) {
      setter((prev) => {
        const index = prev.findIndex((item) => item.id === id);
        if (!mapped) return index === -1 ? prev : prev.filter((item) => item.id !== id);
        if (index === -1) return newestFirst ? [mapped, ...prev] : [...prev, mapped];
        if (JSON.stringify(prev[index]) === JSON.stringify(mapped)) return prev;
        const next = prev.slice();
        next[index] = mapped;
        return next;
      });
    }

    const row = change.row;
    switch (change.table) {
      case 'products':
        upsert(setProducts, isDelete ? null : mapProduct(row));
        break;
      case 'orders':
        upsert(setOrders, isDelete ? null : mapOrder(row), true);
        break;
      case 'order_items':
        upsert(setOrderItems, isDelete ? null : mapOrderItem(row));
        break;
      case 'order_edit_logs':
        upsert(setOrderEditLogs, isDelete ? null : mapOrderEditLog(row));
        break;
      case 'customers':
        upsert(setCustomers, isDelete ? null : mapCustomer(row), true);
        break;
      case 'customer_transactions':
        upsert(setCustomerTransactions, isDelete ? null : mapCustomerTransaction(row));
        break;
      case 'customer_reminders':
        upsert(setCustomerReminders, isDelete ? null : mapCustomerReminder(row), true);
        break;
      case 'suppliers':
        upsert(setSuppliers, isDelete ? null : mapSupplier(row), true);
        break;
      case 'supplier_purchases':
        upsert(setSupplierPurchases, isDelete ? null : mapSupplierPurchase(row), true);
        break;
      case 'supplier_payment_schedules':
        upsert(setSupplierPaymentSchedules, isDelete ? null : mapSupplierPaymentSchedule(row), true);
        break;
      case 'categories':
        upsert(setCategories, isDelete ? null : (row as unknown as Category));
        break;
      case 'units':
        upsert(setUnits, isDelete ? null : (row as unknown as Unit));
        break;
      case 'store_settings':
        if (!isDelete) {
          const next = mapSettings(row);
          setSettings({ ...next, cardFeePercent: next.cardFeePercent ?? DEFAULT_SETTINGS.cardFeePercent });
        }
        break;
    }
  }, []);

  flushLiveBufferRef.current = () => {
    const buffered = liveBufferRef.current;
    liveBufferRef.current = [];
    buffered.forEach(applyLiveChange);
  };

  // Load data from Supabase
  useEffect(() => {
    const loadUnitsFallback = async (): Promise<Unit[]> => {
      // Units are seeded in the database; sample data is only for local (no Supabase) mode.
      return await loadArrayFromDexie('units');
    };

    // A session that is valid right now (not just stored). Without one the database would
    // answer with empty lists, which must never replace the local copy.
    const getLiveSession = async () => {
      try {
        const result = await Promise.race([
          supabase.auth.getSession(),
          new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('timeout')), 8000)),
        ]);
        return result.error ? null : result.data.session;
      } catch {
        return null;
      }
    };

    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Check if Supabase is configured
        if (!import.meta.env.VITE_SUPABASE_URL) {
          console.warn('Supabase not configured, using local storage fallback');
          await loadFromDexie(true);
          setLoading(false);
          return;
        }

        // Tables require a signed-in user. Before sign-in only the saved store name/logo is
        // loaded, for the login screen.
        if (!user) {
          const localSettings = await loadSettingsFromDexie();
          if (localSettings) setSettings({ ...DEFAULT_SETTINGS, ...localSettings });
          setLoading(false);
          return;
        }

        // Show the saved local copy straight away so the app opens instantly and works offline.
        if (!isHydrated) await loadFromDexie(false);

        // Only talk to the server with a live session; otherwise keep working from the local copy.
        const liveSession = await getLiveSession();
        if (!liveSession) {
          toast.warning('Working offline. Changes are saved on this device and will sync when the connection returns.');
          setLoading(false);
          return;
        }

        // Upload local changes first so the cloud copy below already contains them.
        await checkServerReady();
        await processPendingSyncQueue();

        const startedAt = Date.now();
        const before = dataRef.current;
        cloudLoadInProgressRef.current = true;
        let snapshot: CloudSnapshot;
        try {
          snapshot = await fetchCloudSnapshot();
        } finally {
          cloudLoadInProgressRef.current = false;
        }
        if (isSafeToApplyCloudCopy(startedAt, before)) {
          applyCloudSnapshot(snapshot);
          liveBufferRef.current = [];
          lastFullRefreshRef.current = Date.now();
          setLastSyncedAt(new Date().toISOString());
        } else {
          // Changes on this device are not in the cloud yet (offline, or made just now). Keep the
          // local copy so they don't disappear; the background refresh brings in the cloud copy
          // once they are uploaded.
          window.setTimeout(() => void refreshFromCloudRef.current(), 5000);
        }

        // Held carts are not stored in Supabase, so they always come from the local database.
        // (Bill history was loaded from it above and merged with the cloud copy.)
        setHeldCarts(await loadArrayFromDexie('heldCarts'));
        setIsHydrated(true);
      } catch (error) {
        const rawMessage =
          error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : JSON.stringify(error);
        if (isTransientSyncError(rawMessage)) {
          console.warn('Supabase unreachable, using local storage fallback.');
          toast.warning('Cloud database unreachable. Working from data saved on this device.');
        } else {
          console.error('Error fetching data from Supabase:', error);
          toast.error('Failed to load data from database');
        }
        // Already showing local data: keep it (it may hold changes newer than the saved copy).
        if (!isHydrated) await loadFromDexie(false);
      } finally {
        setLoading(false);
      }
    };

    // Sample products/units/categories are for the no-Supabase demo only. With a database they would
    // reference rows that don't exist there and break every sale that includes them.
    const loadFromDexie = async (allowSamples: boolean) => {
      const dbProducts = await loadArrayFromDexie('products');
      setProducts(dbProducts.length || !allowSamples ? dbProducts : SAMPLE_PRODUCTS);

      const dbUnits = await loadArrayFromDexie('units');
      setUnits(dbUnits.length || !allowSamples ? dbUnits : SAMPLE_UNITS);

      const dbCategories = await loadArrayFromDexie('categories');
      setCategories(dbCategories.length || !allowSamples ? dbCategories : SAMPLE_CATEGORIES);
      
      const dbOrders: Order[] = await loadArrayFromDexie('orders');
      setOrders(dbOrders.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setOrderItems(await loadArrayFromDexie('orderItems'));
      
      const dbSettings = await loadSettingsFromDexie();
      setSettings(dbSettings ? { ...DEFAULT_SETTINGS, ...dbSettings } : DEFAULT_SETTINGS);
      
      setHeldCarts(await loadArrayFromDexie('heldCarts'));
      setCustomers(await loadArrayFromDexie('customers'));
      setCustomerTransactions(await loadArrayFromDexie('customerTransactions'));
      setCustomerReminders(await loadArrayFromDexie('customerReminders'));
      setSuppliers(await loadArrayFromDexie('suppliers'));
      setSupplierPurchases(await loadArrayFromDexie('supplierPurchases'));
      setSupplierPaymentSchedules(await loadArrayFromDexie('supplierPaymentSchedules'));
      setOrderEditLogs(await loadArrayFromDexie('orderEditLogs'));
      setIsHydrated(true);
    };

    fetchData();
  }, [user?.id, refreshKey]);

  const queueSaveFailedRef = useRef(false);
  useEffect(() => {
    try {
      localStorage.setItem(PENDING_SYNC_STORAGE_KEY, JSON.stringify(pendingSyncOps));
      queueSaveFailedRef.current = false;
    } catch {
      // Storage full (only after a very long time offline): keep working, but say so once.
      if (!queueSaveFailedRef.current) {
        queueSaveFailedRef.current = true;
        toast.error('Too many changes waiting to upload. Connect to the internet soon so nothing is lost if the app is closed.');
      }
    }
  }, [pendingSyncOps]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Upload what was saved while offline, then bring in what other devices changed.
      void processPendingSyncQueue().then(() => refreshFromCloudRef.current());
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [processPendingSyncQueue]);

  // Background sync, so nobody has to press Sync: upload anything still waiting (also covers
  // Wi-Fi without internet, where no 'online' event ever fires), otherwise check the cloud for
  // changes made on other devices.
  useEffect(() => {
    if (!import.meta.env.VITE_SUPABASE_URL || !user) return;
    const timer = window.setInterval(() => {
      if (pendingSyncOpsRef.current.some((op) => !op.parked)) {
        void processQueueRef.current();
      } else if (!isLiveRef.current || Date.now() - lastFullRefreshRef.current > FULL_REFRESH_WHEN_LIVE_MS) {
        void refreshFromCloudRef.current();
      }
    }, BACKGROUND_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [user]);

  // Live updates: a sale, payment or stock change on the other PC shows up here within a second
  // or two. Changes arriving while this PC still has uploads waiting are held back and applied
  // once those are in, so they can't hide this PC's own newer changes.
  useEffect(() => {
    if (!import.meta.env.VITE_SUPABASE_URL || !user) return;
    let subscribedBefore = false;
    const channel = supabase.channel(`pos-live-${user.id}`);
    for (const table of LIVE_TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        const change: LiveChange = {
          table,
          eventType: payload.eventType as LiveChange['eventType'],
          row: (payload.new || {}) as Record<string, unknown>,
          oldRow: (payload.old || {}) as Record<string, unknown>,
        };
        const busy = processingRef.current !== null || pendingSyncOpsRef.current.some((op) => !op.parked);
        if (!busy) {
          applyLiveChange(change);
        } else if (liveBufferRef.current.length < 5000) {
          liveBufferRef.current.push(change);
        } else {
          // Far too much to hold back: reload everything at the next background check instead.
          liveBufferRef.current = [];
          lastFullRefreshRef.current = 0;
        }
      });
    }
    channel.subscribe((status) => {
      const live = status === 'SUBSCRIBED';
      isLiveRef.current = live;
      setIsLive(live);
      // After a dropped connection, changes may have been missed: reload once.
      if (live && subscribedBefore) void refreshFromCloudRef.current();
      if (live) subscribedBefore = true;
    });
    return () => {
      isLiveRef.current = false;
      setIsLive(false);
      void supabase.removeChannel(channel);
    };
  }, [user, applyLiveChange]);

  // Cancel a scheduled retry when the provider unmounts.
  useEffect(
    () => () => {
      if (pendingSyncTimer.current !== null) {
        window.clearTimeout(pendingSyncTimer.current);
      }
    },
    []
  );

  // Save held carts to localStorage (keep local)
  useEffect(() => {
    if (!isHydrated) return;
    void saveArrayToDexie('heldCarts', heldCarts);
  }, [heldCarts, isHydrated]);

  // Persist reference/inventory data locally as a durability fallback even when Supabase is configured.
  // This prevents data loss on refresh if a Supabase table is missing/misconfigured.
  useEffect(() => {
    if (!isHydrated) return;
    void saveArrayToDexie('products', products);
  }, [products, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    void saveArrayToDexie('units', units);
  }, [units, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    void saveArrayToDexie('categories', categories);
  }, [categories, isHydrated]);

  // Save customers to localStorage
  useEffect(() => {
    if (!isHydrated) return;
    void saveArrayToDexie('customers', customers);
  }, [customers, isHydrated]);

  // Save customer transactions to localStorage
  useEffect(() => {
    if (!isHydrated) return;
    void saveArrayToDexie('customerTransactions', customerTransactions);
  }, [customerTransactions, isHydrated]);

  // Save customer reminders to localStorage
  useEffect(() => {
    if (!isHydrated) return;
    void saveArrayToDexie('customerReminders', customerReminders);
  }, [customerReminders, isHydrated]);

  // Save suppliers to localStorage
  useEffect(() => {
    if (!isHydrated) return;
    void saveArrayToDexie('suppliers', suppliers);
  }, [suppliers, isHydrated]);

  // Save supplier purchases to localStorage
  useEffect(() => {
    if (!isHydrated) return;
    void saveArrayToDexie('supplierPurchases', supplierPurchases);
  }, [supplierPurchases, isHydrated]);

  // Save supplier payment schedules to localStorage
  useEffect(() => {
    if (!isHydrated) return;
    void saveArrayToDexie('supplierPaymentSchedules', supplierPaymentSchedules);
  }, [supplierPaymentSchedules, isHydrated]);

  useEffect(() => {
    document.title = settings.storeName?.trim() || 'Point of Sale';
  }, [settings.storeName]);

  // Sales history, bill-edit history and settings are also kept locally so the app can start offline.
  useEffect(() => {
    if (!isHydrated) return;
    void saveArrayToDexie('orders', orders);
  }, [orders, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    void saveArrayToDexie('orderItems', orderItems);
  }, [orderItems, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    void saveArrayToDexie('orderEditLogs', orderEditLogs);
  }, [orderEditLogs, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    void saveSettingsToDexie(settings);
  }, [settings, isHydrated]);

  // Latest master data and ledgers (like productsRef), so a double click or two quick edits in a
  // row never act on a stale copy (e.g. taking the same payment off a balance twice).
  const unitsRef = useRef(units);
  unitsRef.current = units;
  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;
  const customersRef = useRef(customers);
  customersRef.current = customers;
  const customerTransactionsRef = useRef(customerTransactions);
  customerTransactionsRef.current = customerTransactions;
  const customerRemindersRef = useRef(customerReminders);
  customerRemindersRef.current = customerReminders;
  const suppliersRef = useRef(suppliers);
  suppliersRef.current = suppliers;
  const supplierPurchasesRef = useRef(supplierPurchases);
  supplierPurchasesRef.current = supplierPurchases;
  const supplierPaymentSchedulesRef = useRef(supplierPaymentSchedules);
  supplierPaymentSchedulesRef.current = supplierPaymentSchedules;

  // A product must point at a category and unit that exist, or the database rejects it and the
  // change never reaches the cloud.
  const missingProductReference = (p: Partial<Pick<Product, 'categoryId' | 'unitId'>>): string | null => {
    if (p.categoryId !== undefined && !categoriesRef.current.some((c) => c.id === p.categoryId)) {
      return 'Choose a category for this product (its category no longer exists).';
    }
    if (p.unitId !== undefined && !unitsRef.current.some((u) => u.id === p.unitId)) {
      return 'Choose a unit for this product (its unit no longer exists).';
    }
    return null;
  };

  // Product functions
  const addProduct = (product: Omit<Product, 'id'>): boolean => {
    const problem = missingProductReference(product);
    if (problem) {
      toast.error(problem);
      return false;
    }
    const newProduct = { ...product, id: generateId() };

    // Optimistic update
    productsRef.current = [...productsRef.current, newProduct];
    setProducts((prev) => [...prev, newProduct]);

    if (import.meta.env.VITE_SUPABASE_URL) {
      enqueuePendingSync('product_add', { newProduct, omitStock: true });
      if (newProduct.stockQuantity) {
        enqueuePendingSync('stock_movement', {
          movement: {
            id: generateId(),
            productId: newProduct.id,
            delta: newProduct.stockQuantity,
            reason: 'Opening stock',
            createdAt: new Date().toISOString(),
          },
        });
      }
    } else {
      void saveArrayToDexie('products', productsRef.current);
    }
    return true;
  };

  const updateProduct = (id: string, updates: Partial<Product>): boolean => {
    const problem = missingProductReference(updates);
    if (problem) {
      toast.error(problem);
      return false;
    }
    // A changed stock figure (e.g. a stock count typed in on the product form) is uploaded as the
    // difference, so sales made meanwhile on the other PC are not wiped out.
    const stockBefore = productsRef.current.find((p) => p.id === id)?.stockQuantity;
    const stockDelta =
      updates.stockQuantity !== undefined && stockBefore !== undefined ? updates.stockQuantity - stockBefore : 0;
    productsRef.current = productsRef.current.map((p) => (p.id === id ? { ...p, ...updates } : p));

    // Optimistic update
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updates } : p))
    );

    if (import.meta.env.VITE_SUPABASE_URL) {
      const dbUpdates: Record<string, unknown> = {};
      if (updates.sku) dbUpdates.sku = updates.sku;
      if (updates.name) dbUpdates.name = updates.name;
      if (updates.description !== undefined) dbUpdates.description = updates.description;
      if (updates.categoryId) dbUpdates.category_id = updates.categoryId;
      if (updates.unitId) dbUpdates.unit_id = updates.unitId;
      if (updates.costPrice !== undefined) dbUpdates.cost_price = updates.costPrice;
      if (updates.sellingPrice !== undefined) dbUpdates.selling_price = updates.sellingPrice;
      if (updates.lowStockThreshold !== undefined) dbUpdates.low_stock_threshold = updates.lowStockThreshold;
      if (updates.expiryDate !== undefined) dbUpdates.expiry_date = updates.expiryDate || null;
      if (updates.barcode !== undefined) dbUpdates.barcode = updates.barcode || null;
      if (updates.barcodeEnabled !== undefined) dbUpdates.barcode_enabled = updates.barcodeEnabled;

      if (stockDelta !== 0) {
        enqueuePendingSync('stock_movement', {
          movement: { id: generateId(), productId: id, delta: stockDelta, reason: 'Stock adjusted', createdAt: new Date().toISOString() },
        });
      }
      // Avoid a DB call with an empty update payload (can cause a 400 in PostgREST).
      if (Object.keys(dbUpdates).length > 0) {
        enqueuePendingSync('product_update', { id, dbUpdates });
      }
    } else {
      void saveArrayToDexie('products', productsRef.current);
    }
    return true;
  };

  // Change stock by an amount (negative = sold) starting from the current value, not from a copy
  // of the product taken earlier (cart item, open dialog, ...). Uploaded as a movement the
  // database applies once, so sales on several PCs add up instead of overwriting each other.
  const adjustProductStock = (productId: string, delta: number, reason = 'Stock adjusted', orderId?: string) => {
    const current = productsRef.current.find((p) => p.id === productId);
    if (!current || delta === 0) return Promise.resolve();
    const stockQuantity = current.stockQuantity + delta;
    productsRef.current = productsRef.current.map((p) => (p.id === productId ? { ...p, stockQuantity } : p));
    setProducts((prev) => prev.map((p) => (p.id === productId ? { ...p, stockQuantity } : p)));

    if (import.meta.env.VITE_SUPABASE_URL) {
      enqueuePendingSync('stock_movement', {
        movement: { id: generateId(), productId, delta, reason, orderId, createdAt: new Date().toISOString() },
      });
    }
    return Promise.resolve();
  };

  // Past sales keep the product's name and SKU on their lines (the database sets the line's
  // product link to null). The open sale and held bills drop it: see the cart clean-up below.
  const deleteProducts = (ids: string[]) => {
    const removing = new Set(ids);
    productsRef.current = productsRef.current.filter((p) => !removing.has(p.id));
    setProducts((prev) => prev.filter((p) => !removing.has(p.id)));

    if (import.meta.env.VITE_SUPABASE_URL) {
      enqueuePendingSync('product_delete', { ids });
    } else {
      void saveArrayToDexie('products', productsRef.current);
    }
  };

  const getProductBySku = (sku: string) => {
    return products.find((p) => p.sku.toLowerCase() === sku.toLowerCase());
  };

  // Unit and category names are compared trimmed and ignoring case. Unit names are unique in the
  // database, so a duplicate would be rejected and never reach the cloud.
  const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

  // Unit functions
  const addUnit = (unit: Omit<Unit, 'id'>): boolean => {
    const name = unit.name.trim();
    if (!name) {
      toast.error('Unit name is required');
      return false;
    }
    if (unitsRef.current.some((u) => sameName(u.name, name))) {
      toast.error(`A unit called "${name}" already exists`);
      return false;
    }
    const newUnit: Unit = { id: generateId(), name, description: unit.description?.trim() || '' };
    unitsRef.current = [...unitsRef.current, newUnit];
    setUnits((prev) => [...prev, newUnit]);

    if (import.meta.env.VITE_SUPABASE_URL) {
      enqueuePendingSync('db_writes', { writes: [{ table: 'units', kind: 'upsert', rows: newUnit }] });
    } else {
      void saveArrayToDexie('units', unitsRef.current);
    }
    return true;
  };

  const updateUnit = (id: string, updates: Partial<Unit>): boolean => {
    const current = unitsRef.current.find((u) => u.id === id);
    if (!current) return false;
    const next: Unit = { ...current };
    if (updates.name !== undefined) {
      const name = updates.name.trim();
      if (!name) {
        toast.error('Unit name is required');
        return false;
      }
      if (unitsRef.current.some((u) => u.id !== id && sameName(u.name, name))) {
        toast.error(`A unit called "${name}" already exists`);
        return false;
      }
      next.name = name;
    }
    if (updates.description !== undefined) next.description = updates.description.trim();
    unitsRef.current = unitsRef.current.map((u) => (u.id === id ? next : u));
    setUnits((prev) => prev.map((u) => (u.id === id ? next : u)));

    if (import.meta.env.VITE_SUPABASE_URL) {
      enqueuePendingSync('db_writes', {
        writes: [{ table: 'units', kind: 'update', values: { name: next.name, description: next.description ?? null }, eq: ['id', id] }],
      });
    } else {
      void saveArrayToDexie('units', unitsRef.current);
    }
    return true;
  };

  /**
   * Deletes a unit. Products still using it must be moved to `replacementId`: the database refuses
   * to delete a unit that products point at, so it would stay in the cloud while gone here.
   */
  const deleteUnit = (id: string, replacementId?: string): boolean => {
    if (!unitsRef.current.some((u) => u.id === id)) return false;
    const target =
      replacementId && replacementId !== id && unitsRef.current.some((u) => u.id === replacementId) ? replacementId : undefined;
    const inUse = productsRef.current.filter((p) => p.unitId === id).length;
    if (inUse > 0 && !target) {
      toast.error(`${inUse} product${inUse === 1 ? '' : 's'} still use this unit. Choose another unit for them first.`);
      return false;
    }

    if (target) {
      productsRef.current = productsRef.current.map((p) => (p.unitId === id ? { ...p, unitId: target } : p));
      setProducts((prev) => prev.map((p) => (p.unitId === id ? { ...p, unitId: target } : p)));
    }
    unitsRef.current = unitsRef.current.filter((u) => u.id !== id);
    setUnits((prev) => prev.filter((u) => u.id !== id));

    if (import.meta.env.VITE_SUPABASE_URL) {
      // In this order: the products move first (also any the other PC added), then the unit goes.
      const writes: DbWrite[] = [];
      if (target) writes.push({ table: 'products', kind: 'update', values: { unit_id: target }, eq: ['unit_id', id] });
      writes.push({ table: 'units', kind: 'delete', eq: ['id', id] });
      enqueuePendingSync('db_writes', { writes });
    } else {
      void saveArrayToDexie('units', unitsRef.current);
      void saveArrayToDexie('products', productsRef.current);
    }
    return true;
  };

  const getUnitById = (id: string) => {
    return units.find((u) => u.id === id);
  };

  // Category functions
  const addCategory = (category: Omit<Category, 'id'>): boolean => {
    const name = category.name.trim();
    if (!name) {
      toast.error('Category name is required');
      return false;
    }
    if (categoriesRef.current.some((c) => sameName(c.name, name))) {
      toast.error(`A category called "${name}" already exists`);
      return false;
    }
    const newCategory: Category = { id: generateId(), name, description: category.description?.trim() || '' };
    categoriesRef.current = [...categoriesRef.current, newCategory];
    setCategories((prev) => [...prev, newCategory]);

    if (import.meta.env.VITE_SUPABASE_URL) {
      enqueuePendingSync('db_writes', { writes: [{ table: 'categories', kind: 'upsert', rows: newCategory }] });
    } else {
      void saveArrayToDexie('categories', categoriesRef.current);
    }
    return true;
  };

  const updateCategory = (id: string, updates: Partial<Category>): boolean => {
    const current = categoriesRef.current.find((c) => c.id === id);
    if (!current) return false;
    const next: Category = { ...current };
    if (updates.name !== undefined) {
      const name = updates.name.trim();
      if (!name) {
        toast.error('Category name is required');
        return false;
      }
      if (categoriesRef.current.some((c) => c.id !== id && sameName(c.name, name))) {
        toast.error(`A category called "${name}" already exists`);
        return false;
      }
      next.name = name;
    }
    if (updates.description !== undefined) next.description = updates.description.trim();
    categoriesRef.current = categoriesRef.current.map((c) => (c.id === id ? next : c));
    setCategories((prev) => prev.map((c) => (c.id === id ? next : c)));

    if (import.meta.env.VITE_SUPABASE_URL) {
      enqueuePendingSync('db_writes', {
        writes: [{ table: 'categories', kind: 'update', values: { name: next.name, description: next.description }, eq: ['id', id] }],
      });
    } else {
      void saveArrayToDexie('categories', categoriesRef.current);
    }
    return true;
  };

  /** Deletes a category, moving products that still use it to `replacementId` first (see deleteUnit). */
  const deleteCategory = (id: string, replacementId?: string): boolean => {
    if (!categoriesRef.current.some((c) => c.id === id)) return false;
    const target =
      replacementId && replacementId !== id && categoriesRef.current.some((c) => c.id === replacementId)
        ? replacementId
        : undefined;
    const inUse = productsRef.current.filter((p) => p.categoryId === id).length;
    if (inUse > 0 && !target) {
      toast.error(`${inUse} product${inUse === 1 ? '' : 's'} still use this category. Choose another category for them first.`);
      return false;
    }

    if (target) {
      productsRef.current = productsRef.current.map((p) => (p.categoryId === id ? { ...p, categoryId: target } : p));
      setProducts((prev) => prev.map((p) => (p.categoryId === id ? { ...p, categoryId: target } : p)));
    }
    categoriesRef.current = categoriesRef.current.filter((c) => c.id !== id);
    setCategories((prev) => prev.filter((c) => c.id !== id));

    if (import.meta.env.VITE_SUPABASE_URL) {
      const writes: DbWrite[] = [];
      if (target) writes.push({ table: 'products', kind: 'update', values: { category_id: target }, eq: ['category_id', id] });
      writes.push({ table: 'categories', kind: 'delete', eq: ['id', id] });
      enqueuePendingSync('db_writes', { writes });
    } else {
      void saveArrayToDexie('categories', categoriesRef.current);
      void saveArrayToDexie('products', productsRef.current);
    }
    return true;
  };

  // Cart calculations
  const calculateItemDiscount = (item: CartItem): number => {
    if (item.discountType === 'percentage') {
      return (item.product.sellingPrice * item.quantity * item.discountAmount) / 100;
    }
    return item.discountAmount * item.quantity;
  };

  const calculateSubtotal = (): number => {
    return cart.reduce((sum, item) => {
      const itemTotal = item.product.sellingPrice * item.quantity;
      const discount = calculateItemDiscount(item);
      return sum + itemTotal - discount;
    }, 0);
  };

  const calculateGlobalDiscountAmount = (): number => {
    const subtotal = calculateSubtotal();
    if (globalDiscountType === 'percentage') {
      return (subtotal * globalDiscount) / 100;
    }
    return globalDiscount;
  };

  const calculateTax = (): number => {
    const subtotalAfterDiscount = calculateSubtotal() - calculateGlobalDiscountAmount();
    return (subtotalAfterDiscount * settings.taxRate) / 100;
  };

  const calculateTotal = (): number => {
    return calculateSubtotal() - calculateGlobalDiscountAmount() + calculateTax();
  };

  // Cart functions
  const addToCart = (product: Product, quantity = 1) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + quantity }
            : item
        );
      }
      return [...prev, { product, quantity, discountAmount: 0, discountType: 'fixed' }];
    });
  };

  const updateCartItem = (productId: string, updates: Partial<CartItem>) => {
    setCart((prev) =>
      prev.map((item) =>
        item.product.id === productId ? { ...item, ...updates } : item
      )
    );
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  const clearCart = () => {
    setCart([]);
    setGlobalDiscountState(0);
    setGlobalDiscountType('fixed');
  };

  const setGlobalDiscount = (amount: number, type: 'fixed' | 'percentage') => {
    setGlobalDiscountState(amount);
    setGlobalDiscountType(type);
  };

  // Held cart functions
  const holdCart = (note?: string) => {
    if (cart.length === 0) return;
    const held: HeldCart = {
      id: generateId(),
      items: [...cart],
      globalDiscount,
      globalDiscountType,
      heldAt: new Date().toISOString(),
      note,
    };
    setHeldCarts((prev) => [...prev, held]);
    clearCart();
  };

  const recallCart = (id: string) => {
    const held = heldCarts.find((h) => h.id === id);
    if (!held) return;
    // Recalling over an unfinished sale would lose it, so that sale is held instead.
    const open: HeldCart | null =
      cart.length > 0
        ? { id: generateId(), items: [...cart], globalDiscount, globalDiscountType, heldAt: new Date().toISOString() }
        : null;
    setCart(held.items);
    setGlobalDiscountState(held.globalDiscount);
    setGlobalDiscountType(held.globalDiscountType);
    setHeldCarts((prev) => [...prev.filter((h) => h.id !== id), ...(open ? [open] : [])]);
    if (open) toast.info('The sale that was open has been put on hold.');
  };

  const deleteHeldCart = (id: string) => {
    setHeldCarts((prev) => prev.filter((h) => h.id !== id));
  };

  // Products deleted here or on another PC leave the open sale and held bills. Selling one would
  // upload a sale line for a product the database no longer has, and the whole sale would be rejected.
  useEffect(() => {
    if (!isHydrated) return;
    const exists = new Set(products.map((p) => p.id));
    const gone = cart.filter((item) => !exists.has(item.product.id));
    if (gone.length > 0) {
      setCart((prev) => prev.filter((item) => exists.has(item.product.id)));
      toast.warning(`Removed from the sale (deleted from inventory): ${gone.map((item) => item.product.name).join(', ')}`);
    }
    if (heldCarts.some((h) => h.items.some((item) => !exists.has(item.product.id)))) {
      setHeldCarts((prev) =>
        prev
          .map((h) => ({ ...h, items: h.items.filter((item) => exists.has(item.product.id)) }))
          .filter((h) => h.items.length > 0)
      );
    }
  }, [products, cart, heldCarts, isHydrated]);

  // Order functions
  const createOrder = async (options: CreateOrderOptions): Promise<Order> => {
    const {
      items,
      paymentMethod,
      globalDiscount: orderGlobalDiscount,
      globalDiscountType: orderGlobalDiscountType,
      amountTendered,
      clientName,
      clientPhone,
      transferType,
      transactionId,
      customerId,
    } = options;

    // Without a customer a credit sale would never reach anyone's account.
    if (paymentMethod === 'credit' && !(customerId && customers.some((c) => c.id === customerId))) {
      throw new Error('A credit sale needs a customer.');
    }

    const subtotal = items.reduce((sum, item) => {
      const itemTotal = item.product.sellingPrice * item.quantity;
      const discount =
        item.discountType === 'percentage'
          ? (itemTotal * item.discountAmount) / 100
          : item.discountAmount * item.quantity;
      return sum + itemTotal - discount;
    }, 0);

    const globalDiscountAmt =
      orderGlobalDiscountType === 'percentage'
        ? (subtotal * orderGlobalDiscount) / 100
        : orderGlobalDiscount;

    const taxAmount = ((subtotal - globalDiscountAmt) * settings.taxRate) / 100;

    // Card fee (if payment by card) - applied on post-tax amount
    const baseTotal = subtotal - globalDiscountAmt + taxAmount;
    const cardFeeRate = paymentMethod === 'card' ? settings.cardFeePercent : 0;
    const cardFeeAmount = paymentMethod === 'card' && cardFeeRate > 0 ? (baseTotal * cardFeeRate) / 100 : 0;

    const totalAmount = baseTotal + cardFeeAmount;
    const changeGiven = amountTendered ? amountTendered - totalAmount : undefined;

    const order: Order = {
      id: generateId(),
      createdAt: new Date().toISOString(),
      cashierId: user?.id || 'unknown',
      cashierName: user?.fullName || 'Unknown',
      subtotal,
      taxAmount,
      discountAmount: globalDiscountAmt + items.reduce((sum, item) => {
        return sum + (item.discountType === 'percentage'
          ? (item.product.sellingPrice * item.quantity * item.discountAmount) / 100
          : item.discountAmount * item.quantity);
      }, 0),
      totalAmount,
      cardFeeAmount: cardFeeAmount || undefined,
      cardFeeRate: cardFeeRate || undefined,
      paymentMethod,
      status: paymentMethod === 'credit' ? 'credit' : 'completed',
      amountTendered,
      changeGiven,
      clientName,
      clientPhone,
      transferType,
      transactionId,
      customerId,
    };

    const newOrderItems: OrderItem[] = items.map((item) => ({
      id: generateId(),
      orderId: order.id,
      productId: item.product.id,
      productName: item.product.name,
      productSku: item.product.sku,
      quantity: item.quantity,
      unitPriceAtSale: item.product.sellingPrice,
      unitCostAtSale: item.product.costPrice,
      discountAmount:
        item.discountType === 'percentage'
          ? (item.product.sellingPrice * item.quantity * item.discountAmount) / 100
          : item.discountAmount * item.quantity,
    }));

    // Optimistic update
    setOrders((prev) => [order, ...prev]);
    setOrderItems((prev) => [...prev, ...newOrderItems]);

    // Update stock from the current level (the cart's product copy may be out of date)
    items.forEach((item) => {
      void adjustProductStock(item.product.id, -item.quantity, 'Sale', order.id);
    });

    // If credit sale with customer, add credit transaction (Digi Khata)
    if (paymentMethod === 'credit' && customerId) {
      await addCreditTransaction(customerId, order.id, totalAmount);
    }

    if (import.meta.env.VITE_SUPABASE_URL) {
      // Uploaded in the background: checkout never waits for the internet.
      enqueuePendingSync('order_with_items', { order, orderItems: newOrderItems });
    } else {
      void saveArrayToDexie('orders', [order, ...orders]);
      void saveArrayToDexie('orderItems', [...orderItems, ...newOrderItems]);
    }

    return order;
  };

  const getOrderItems = (orderId: string) => {
    return orderItems.filter((item) => item.orderId === orderId);
  };

  const getCustomerOrders = (customerId: string) => {
    return orders.filter((order) => order.customerId === customerId);
  };

  const updateOrder = async (id: string, updates: Partial<Order>) => {
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, ...updates } : o)));

    if (import.meta.env.VITE_SUPABASE_URL) {
      const dbUpdates: Record<string, unknown> = {};
      if (updates.paymentMethod !== undefined) dbUpdates.payment_method = updates.paymentMethod;
      if (updates.status !== undefined) dbUpdates.status = updates.status;
      if (updates.amountTendered !== undefined) dbUpdates.amount_tendered = updates.amountTendered;
      if (updates.changeGiven !== undefined) dbUpdates.change_given = updates.changeGiven;
      if (updates.clientName !== undefined) dbUpdates.client_name = updates.clientName;
      if (updates.clientPhone !== undefined) dbUpdates.client_phone = updates.clientPhone;
      if (updates.transferType !== undefined) dbUpdates.transfer_type = updates.transferType;
      if (updates.transactionId !== undefined) dbUpdates.transaction_id = updates.transactionId;
      if (updates.customerId !== undefined) dbUpdates.customer_id = updates.customerId;

      enqueuePendingSync('db_writes', { writes: [{ table: 'orders', kind: 'update', values: dbUpdates, eq: ['id', id] }] });
    } else {
      const updatedOrders = orders.map((o) => (o.id === id ? { ...o, ...updates } : o));
      void saveArrayToDexie('orders', updatedOrders);
    }
  };

  /** What a bill looked like, kept in its history. */
  const orderSnapshot = (o: Order): Partial<Order> => ({
    subtotal: o.subtotal,
    taxAmount: o.taxAmount,
    discountAmount: o.discountAmount,
    totalAmount: o.totalAmount,
    paymentMethod: o.paymentMethod,
    status: o.status,
    clientName: o.clientName,
    clientPhone: o.clientPhone,
    customerId: o.customerId,
    cardFeeAmount: o.cardFeeAmount,
    cardFeeRate: o.cardFeeRate,
    amountTendered: o.amountTendered,
    changeGiven: o.changeGiven,
    originalOrderId: o.originalOrderId,
  });

  /** Adds an entry to a bill's history (edit, cancellation, exchange) and uploads it. */
  const recordOrderEditLog = (orderId: string, changesSummary: string, previous: Order, previousItems: OrderItem[]) => {
    const log: OrderEditLog = {
      id: generateId(),
      orderId,
      editedBy: user?.fullName || user?.email || 'Unknown',
      editedAt: new Date().toISOString(),
      changesSummary,
      previousOrder: orderSnapshot(previous),
      previousItems: [...previousItems],
    };
    setOrderEditLogs((prev) => [...prev, log]);
    if (import.meta.env.VITE_SUPABASE_URL) {
      editLogsQueuedRef.current.add(log.id);
      enqueuePendingSync('db_writes', { writes: [{ table: 'order_edit_logs', kind: 'upsert', rows: orderEditLogRow(log) }] });
    }
  };

  /** A customer ledger entry for a bill. The customer's totals follow from it, as in the database. */
  const postOrderLedgerEntry = (entry: Omit<CustomerTransaction, 'id' | 'createdAt'>) => {
    const transaction: CustomerTransaction = { ...entry, id: generateId(), createdAt: new Date().toISOString() };
    setCustomerTransactions((prev) => [...prev, transaction]);
    setCustomers((prev) =>
      prev.map((c) => (c.id === transaction.customerId ? applyCustomerLedger(c, { added: [transaction] }) : c))
    );
    if (import.meta.env.VITE_SUPABASE_URL) {
      enqueuePendingSync(transaction.type === 'credit' ? 'customer_credit' : 'customer_payment', { transaction });
    }
  };

  /**
   * Takes off customer accounts whatever a bill still puts on them: the credit its ledger entries
   * add up to (a credit sale less any reversals) is reversed, and a refund to the account (an
   * exchange with a negative total) is taken back. Customers deleted since are skipped.
   */
  const reverseOrderLedger = (orderId: string, label: string) => {
    const netCredit = new Map<string, number>();
    for (const t of customerTransactions) {
      if (t.orderId !== orderId) continue;
      netCredit.set(t.customerId, (netCredit.get(t.customerId) || 0) + customerTxEffect(t).credit);
    }
    for (const [customerId, amount] of netCredit) {
      if (Math.abs(amount) < 0.005 || !customers.some((c) => c.id === customerId)) continue;
      postOrderLedgerEntry(
        amount > 0
          ? { customerId, orderId, type: 'payment', amount, description: `Credit reversal - ${label}` }
          : { customerId, orderId, type: 'credit', amount: -amount, description: `Refund taken back - ${label}` }
      );
    }
  };

  const cancelOrder = async (id: string, reason?: string): Promise<boolean> => {
    const order = orders.find((o) => o.id === id);
    if (!order) {
      toast.error('Bill not found');
      return false;
    }
    // A bill with exchanges against it would count those goods and refunds twice.
    const blocked = cancelBlockReason(order, orders);
    if (blocked) {
      toast.error(blocked);
      return false;
    }

    const relatedItems = getOrderItems(id);
    const exchange = isExchangeOrder(order);

    // Put stock back. On an exchange the returned goods (negative lines) go out of stock again.
    for (const item of relatedItems) {
      await adjustProductStock(item.productId, item.quantity, exchange ? 'Exchange cancelled' : 'Bill cancelled', id);
    }

    await updateOrder(id, { status: 'refunded' });

    reverseOrderLedger(id, `Cancelled ${exchange ? 'exchange' : 'order'} #${billNumber(id)}`);

    const note = reason?.trim() ? ` Reason: ${reason.trim()}` : '';
    recordOrderEditLog(id, `${exchange ? 'Exchange' : 'Bill'} cancelled.${note}`, order, relatedItems);
    const original = exchange ? orders.find((o) => o.id === order.originalOrderId) : undefined;
    if (original) {
      recordOrderEditLog(
        original.id,
        `Exchange #${billNumber(id)} cancelled (it ${describeExchange(relatedItems, order.totalAmount, order.paymentMethod)}).${note}`,
        original,
        getOrderItems(original.id)
      );
    }
    return true;
  };

  const updateOrderFull = async (id: string, newItems: BillEditLine[], orderUpdates: Partial<Order>): Promise<boolean> => {
    const existingOrder = orders.find((o) => o.id === id);
    if (!existingOrder) {
      toast.error('Bill not found');
      return false;
    }
    // Cancelled bills, exchanges, and bills with exchanges against them can't be changed.
    const blocked = editBlockReason(existingOrder, orders);
    if (blocked) {
      toast.error(blocked);
      return false;
    }
    if (newItems.length === 0) {
      toast.error('Bill must have at least one item');
      return false;
    }
    const badLine = newItems.find(
      (i) => !Number.isInteger(i.quantity) || i.quantity < 1 || !(i.unitPrice >= 0) || !(i.discountAmount >= 0)
    );
    if (badLine) {
      toast.error(`Check the quantity, price and discount of ${badLine.productName}`);
      return false;
    }

    const finalPaymentMethod = orderUpdates.paymentMethod || existingOrder.paymentMethod;
    // `customerId` given but empty removes the customer. A customer deleted since can't stay linked.
    const wantedCustomerId = 'customerId' in orderUpdates ? orderUpdates.customerId : existingOrder.customerId;
    const finalCustomerId = wantedCustomerId && customers.some((c) => c.id === wantedCustomerId) ? wantedCustomerId : undefined;
    if (finalPaymentMethod === 'credit' && !finalCustomerId) {
      toast.error('A credit bill needs a customer. Choose one, or pick another payment method.');
      return false;
    }
    const finalClientName = 'clientName' in orderUpdates ? orderUpdates.clientName || undefined : existingOrder.clientName;
    const finalClientPhone = 'clientPhone' in orderUpdates ? orderUpdates.clientPhone || undefined : existingOrder.clientPhone;

    const oldItems = orderItems.filter((item) => item.orderId === id);
    // The bill line an edited line came from (lines of deleted products have no product id to match on).
    const sourceOf = (line: BillEditLine) =>
      (line.sourceItemId ? oldItems.find((o) => o.id === line.sourceItemId) : undefined) ??
      (line.productId ? oldItems.find((o) => o.productId === line.productId) : undefined);

    // --- History entry ---
    const changes: string[] = [];
    const keptLines = new Set<string>();
    for (const ni of newItems) {
      const existing = sourceOf(ni);
      if (!existing) {
        changes.push(`Added ${ni.productName} (×${ni.quantity})`);
        continue;
      }
      keptLines.add(existing.id);
      const diffs: string[] = [];
      if (existing.quantity !== ni.quantity) diffs.push(`qty: ${existing.quantity}→${ni.quantity}`);
      if (existing.unitPriceAtSale !== ni.unitPrice) diffs.push(`price: ${existing.unitPriceAtSale}→${ni.unitPrice}`);
      if (existing.discountAmount !== ni.discountAmount) diffs.push(`discount: ${existing.discountAmount}→${ni.discountAmount}`);
      if (diffs.length > 0) changes.push(`${ni.productName}: ${diffs.join(', ')}`);
    }
    for (const oi of oldItems) {
      if (!keptLines.has(oi.id)) changes.push(`Removed ${oi.productName} (×${oi.quantity})`);
    }
    if ((finalClientName || '') !== (existingOrder.clientName || '')) {
      changes.push(`Client name: "${existingOrder.clientName || ''}" → "${finalClientName || ''}"`);
    }
    if ((finalClientPhone || '') !== (existingOrder.clientPhone || '')) {
      changes.push(`Client phone: "${existingOrder.clientPhone || ''}" → "${finalClientPhone || ''}"`);
    }
    if (finalPaymentMethod !== existingOrder.paymentMethod) {
      changes.push(`Payment: ${existingOrder.paymentMethod} → ${finalPaymentMethod}`);
    }
    if ((existingOrder.customerId || undefined) !== finalCustomerId) {
      const nameOf = (cid?: string) => (cid ? customers.find((c) => c.id === cid)?.name || 'deleted customer' : 'none');
      changes.push(`Customer: ${nameOf(existingOrder.customerId)} → ${nameOf(finalCustomerId)}`);
    }

    // --- Stock: apply only the difference between the old and the new quantities ---
    const stockDeltas = new Map<string, number>();
    for (const oi of oldItems) {
      if (oi.productId) stockDeltas.set(oi.productId, (stockDeltas.get(oi.productId) || 0) + oi.quantity);
    }
    for (const ni of newItems) {
      if (ni.productId) stockDeltas.set(ni.productId, (stockDeltas.get(ni.productId) || 0) - ni.quantity);
    }

    if (!settings.allowNegativeStock) {
      for (const [productId, delta] of stockDeltas) {
        const product = productsRef.current.find((p) => p.id === productId);
        if (product && delta < 0 && product.stockQuantity + delta < 0) {
          toast.error(`Insufficient stock for ${product.name}`);
          return false;
        }
      }
    }

    for (const [productId, delta] of stockDeltas) {
      if (delta !== 0) await adjustProductStock(productId, delta, 'Bill edited', id);
    }

    // --- Recalculate totals (keeps the bill's cart-wide discount and the tax rate it was sold with) ---
    const { subtotal, taxAmount, cardFeeRate, cardFeeAmount, totalAmount, totalDiscount } = computeEditedOrderTotals({
      existingOrder,
      oldItems,
      newItems,
      paymentMethod: finalPaymentMethod,
      fallbackTaxRate: settings.taxRate,
      fallbackCardFeePercent: settings.cardFeePercent || 0,
    });

    // --- Customer account: take off what the bill put on it, then put the new amount on ---
    const ledgerFieldsChanged =
      round2(existingOrder.totalAmount) !== totalAmount ||
      existingOrder.paymentMethod !== finalPaymentMethod ||
      (existingOrder.customerId || undefined) !== finalCustomerId;

    if (ledgerFieldsChanged) {
      const label = `Edited order #${billNumber(id)}`;
      reverseOrderLedger(id, label);
      if (finalPaymentMethod === 'credit' && finalCustomerId && totalAmount > 0) {
        postOrderLedgerEntry({
          customerId: finalCustomerId,
          orderId: id,
          type: 'credit',
          amount: totalAmount,
          description: `Credit sale - ${label}`,
        });
      }
    }

    // --- New lines ---
    const newOrderItems: OrderItem[] = newItems.map((item) => {
      const source = sourceOf(item);
      const product = item.productId ? productsRef.current.find((p) => p.id === item.productId) : undefined;
      return {
        id: generateId(),
        orderId: id,
        // Empty once the product is deleted: the cloud would refuse a link to a missing product.
        productId: product ? item.productId : '',
        productName: item.productName,
        productSku: item.productSku,
        quantity: item.quantity,
        unitPriceAtSale: item.unitPrice,
        // Keep the cost recorded when the bill was made; only newly added products use today's cost.
        unitCostAtSale: source?.unitCostAtSale ?? product?.costPrice,
        discountAmount: item.discountAmount,
      };
    });

    // Change is worked out again from the cash handed over; cleared once that no longer covers the bill.
    const tendered = existingOrder.amountTendered;
    const cashCovers = finalPaymentMethod === 'cash' && typeof tendered === 'number' && tendered >= totalAmount;

    const updatedOrder: Order = {
      ...existingOrder,
      ...orderUpdates,
      paymentMethod: finalPaymentMethod,
      customerId: finalCustomerId,
      clientName: finalClientName,
      clientPhone: finalClientPhone,
      subtotal,
      taxAmount,
      discountAmount: totalDiscount,
      totalAmount,
      cardFeeAmount: cardFeeAmount || undefined,
      cardFeeRate: cardFeeRate || undefined,
      // Changing to/from credit changes whether the bill counts as pending.
      status: finalPaymentMethod === 'credit' ? 'credit' : 'completed',
      amountTendered: cashCovers ? tendered : undefined,
      changeGiven: cashCovers ? round2(tendered - totalAmount) : undefined,
      transferType: finalPaymentMethod === 'transfer' ? orderUpdates.transferType ?? existingOrder.transferType : undefined,
      transactionId: finalPaymentMethod === 'transfer' ? orderUpdates.transactionId ?? existingOrder.transactionId : undefined,
    };

    setOrderItems((prev) => [...prev.filter((item) => item.orderId !== id), ...newOrderItems]);
    setOrders((prev) => prev.map((o) => (o.id === id ? updatedOrder : o)));

    if (import.meta.env.VITE_SUPABASE_URL) {
      // The whole bill is uploaded again (so cleared fields are cleared in the cloud too), then the old lines removed.
      enqueuePendingSync('order_with_items', {
        order: updatedOrder,
        orderItems: newOrderItems,
        removeItemIds: oldItems.map((item) => item.id),
      });
    }

    recordOrderEditLog(id, changes.length > 0 ? changes.join('; ') : 'No changes detected', existingOrder, oldItems);
    toast.success('Bill updated successfully');
    return true;
  };

  const getOrderEditLogs = (orderId: string): OrderEditLog[] => {
    return orderEditLogs.filter((log) => log.orderId === orderId);
  };

  const createExchange = async (
    originalOrderId: string,
    returns: Array<{ itemId: string; quantity: number }>,
    newItems: Array<{ productId: string; quantity: number; unitPrice: number; discountAmount: number }>,
    settlement: ExchangeSettlement
  ): Promise<Order> => {
    const original = orders.find((o) => o.id === originalOrderId);
    if (!original) throw new Error('Bill not found.');
    const blocked = exchangeBlockReason(original);
    if (blocked) throw new Error(blocked);

    // --- What comes back (never more than is still on the bill) ---
    const returnable = getReturnableLines(original, orders, orderItems);
    const returnQty = new Map<string, number>();
    for (const r of returns) returnQty.set(r.itemId, (returnQty.get(r.itemId) || 0) + r.quantity);
    const returnInputs: ExchangeReturn[] = [];
    for (const [itemId, quantity] of returnQty) {
      if (!quantity) continue;
      const line = returnable.find((l) => l.item.id === itemId);
      if (!line) throw new Error('A returned item is not on this bill.');
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > line.returnable) {
        throw new Error(`Only ${line.returnable} x ${line.item.productName} can be returned.`);
      }
      returnInputs.push({ item: line.item, alreadyReturned: line.returned, quantity });
    }
    if (returnInputs.length === 0) throw new Error('Choose at least one item the customer is bringing back.');

    // --- What the customer takes instead ---
    const newInputs: ExchangeNewItem[] = [];
    for (const n of newItems) {
      if (!n.quantity) continue;
      const product = productsRef.current.find((p) => p.id === n.productId);
      if (!product) throw new Error('A new item is no longer in the product list.');
      if (!Number.isInteger(n.quantity) || n.quantity < 0 || !(n.unitPrice >= 0) || !(n.discountAmount >= 0)) {
        throw new Error(`Check the quantity, price and discount of ${product.name}.`);
      }
      newInputs.push({
        productId: product.id,
        productName: product.name,
        productSku: product.sku,
        quantity: n.quantity,
        unitPrice: n.unitPrice,
        unitCost: product.costPrice,
        discountAmount: n.discountAmount,
      });
    }

    // Stock for the new items; returned units of the same product count towards it.
    if (!settings.allowNegativeStock) {
      const deltas = new Map<string, number>();
      for (const r of returnInputs) {
        if (r.item.productId) deltas.set(r.item.productId, (deltas.get(r.item.productId) || 0) + r.quantity);
      }
      for (const n of newInputs) deltas.set(n.productId, (deltas.get(n.productId) || 0) - n.quantity);
      for (const [productId, delta] of deltas) {
        const product = productsRef.current.find((p) => p.id === productId);
        if (product && delta < 0 && product.stockQuantity + delta < 0) {
          throw new Error(`Insufficient stock for ${product.name}.`);
        }
      }
    }

    const { paymentMethod } = settlement;
    const customer = settlement.customerId ? customers.find((c) => c.id === settlement.customerId) : undefined;
    if (paymentMethod === 'credit' && !customer) {
      throw new Error('Choose the customer whose account this goes on.');
    }

    const { lines, totals } = computeExchange({
      original,
      originalItems: orderItems.filter((i) => i.orderId === original.id),
      returns: returnInputs,
      newItems: newInputs,
      paymentMethod,
      taxRate: settings.taxRate,
      cardFeePercent: settings.cardFeePercent || 0,
    });
    const total = totals.totalAmount;
    const tendered = paymentMethod === 'cash' && total > 0 && settlement.amountTendered ? settlement.amountTendered : undefined;
    if (tendered !== undefined && tendered < total) throw new Error('The cash received is less than the amount due.');

    const id = generateId();
    // Name and phone stay as on the bill unless the exchange is put on another customer.
    const otherCustomer = customer && customer.id !== original.customerId ? customer : undefined;
    const order: Order = {
      id,
      createdAt: new Date().toISOString(),
      cashierId: user?.id || 'unknown',
      cashierName: user?.fullName || 'Unknown',
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      discountAmount: totals.discountAmount,
      totalAmount: total,
      cardFeeAmount: totals.cardFeeAmount || undefined,
      cardFeeRate: totals.cardFeeRate || undefined,
      paymentMethod,
      status: paymentMethod === 'credit' && total > 0 ? 'credit' : 'completed',
      amountTendered: tendered,
      changeGiven: tendered !== undefined ? round2(tendered - total) : undefined,
      clientName: otherCustomer ? otherCustomer.name : original.clientName ?? customer?.name,
      clientPhone: otherCustomer ? otherCustomer.phone : original.clientPhone ?? customer?.phone,
      transferType: paymentMethod === 'transfer' ? settlement.transferType : undefined,
      transactionId: paymentMethod === 'transfer' ? settlement.transactionId?.trim() || undefined : undefined,
      customerId: customer?.id,
      originalOrderId: original.id,
    };
    const exchangeItems: OrderItem[] = lines.map((line) => ({
      ...line,
      id: generateId(),
      orderId: id,
      // Empty once the product is deleted: the cloud would refuse a link to a missing product.
      productId: line.productId && productsRef.current.some((p) => p.id === line.productId) ? line.productId : '',
    }));

    setOrders((prev) => [order, ...prev]);
    setOrderItems((prev) => [...prev, ...exchangeItems]);
    if (import.meta.env.VITE_SUPABASE_URL) {
      enqueuePendingSync('order_with_items', { order, orderItems: exchangeItems });
    }

    // Returned goods go back into stock, new goods come out of it (deleted products are skipped).
    for (const item of exchangeItems) {
      await adjustProductStock(item.productId, -item.quantity, item.quantity < 0 ? 'Exchange return' : 'Exchange', id);
    }

    // Settled on the customer's account: what they owe goes up, or a refund takes it down.
    const tag = `Exchange #${billNumber(id)} (bill #${billNumber(original.id)})`;
    if (paymentMethod === 'credit' && customer && total !== 0) {
      postOrderLedgerEntry(
        total > 0
          ? { customerId: customer.id, orderId: id, type: 'credit', amount: total, description: `Credit sale - ${tag}` }
          : { customerId: customer.id, orderId: id, type: 'payment', amount: -total, description: `Credit reversal - ${tag}` }
      );
    }

    recordOrderEditLog(
      original.id,
      `Exchange #${billNumber(id)}: ${describeExchange(exchangeItems, total, paymentMethod)}`,
      original,
      orderItems.filter((i) => i.orderId === original.id)
    );

    return order;
  };

  const updateSettings = async (updates: Partial<StoreSettings>) => {
    setSettings((prev) => ({ ...prev, ...updates }));

    if (import.meta.env.VITE_SUPABASE_URL) {
      const dbUpdates: any = {};
      if (updates.storeName !== undefined) dbUpdates.store_name = updates.storeName;
      if (updates.address !== undefined) dbUpdates.address = updates.address;
      if (updates.phone !== undefined) dbUpdates.phone = updates.phone;
      if (updates.taxRate !== undefined) dbUpdates.tax_rate = updates.taxRate;
      if (updates.cardFeePercent !== undefined) dbUpdates.card_fee_percent = updates.cardFeePercent;
      if (updates.receiptFooterMessage !== undefined) dbUpdates.receipt_footer_message = updates.receiptFooterMessage;
      if (updates.allowNegativeStock !== undefined) dbUpdates.allow_negative_stock = updates.allowNegativeStock;
      // Removing the logo arrives as `logo: undefined` and must clear it.
      if ('logo' in updates) dbUpdates.logo = updates.logo ?? null;

      // Single settings row (id 1).
      enqueuePendingSync('db_writes', { writes: [{ table: 'store_settings', kind: 'upsert', rows: { id: 1, ...dbUpdates } }] });
    } else {
      const newSettings = { ...settings, ...updates };
      void saveSettingsToDexie(newSettings);
    }
  };

  // Customer functions (Digi Khata)
  const addCustomer = (customer: Omit<Customer, 'id' | 'createdAt' | 'totalCredit' | 'totalPaid' | 'balance'>) => {
    const newCustomer: Customer = {
      ...customer,
      id: generateId(),
      createdAt: new Date().toISOString(),
      totalCredit: 0,
      totalPaid: 0,
      balance: 0,
    };
    customersRef.current = [...customersRef.current, newCustomer];
    setCustomers((prev) => [...prev, newCustomer]);

    if (import.meta.env.VITE_SUPABASE_URL) {
      enqueuePendingSync('customer_add', { customer: newCustomer });
    }
  };

  const updateCustomer = (id: string, updates: Partial<Customer>) => {
    // Totals only ever change through ledger entries (see applyCustomerLedger).
    const { id: _id, createdAt: _createdAt, totalCredit: _credit, totalPaid: _paid, balance: _balance, ...details } = updates;
    setCustomers((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...details } : c))
    );

    if (import.meta.env.VITE_SUPABASE_URL) {
      const dbUpdates: Record<string, unknown> = {};
      if (details.name !== undefined) dbUpdates.name = details.name;
      if (details.phone !== undefined) dbUpdates.phone = details.phone;
      if (details.address !== undefined) dbUpdates.address = details.address;
      // A cleared NIC arrives as `nic: undefined` and must be cleared in the cloud too.
      if ('nic' in details) dbUpdates.nic = details.nic?.trim() || null;

      if (Object.keys(dbUpdates).length > 0) enqueuePendingSync('customer_update', { id, dbUpdates });
    }
  };

  // The database also deletes the customer's ledger entries and reminders, and unlinks their bills
  // (which keep the name printed on them), so the same happens here.
  const deleteCustomer = (id: string) => {
    customersRef.current = customersRef.current.filter((c) => c.id !== id);
    customerTransactionsRef.current = customerTransactionsRef.current.filter((t) => t.customerId !== id);
    customerRemindersRef.current = customerRemindersRef.current.filter((r) => r.customerId !== id);
    setCustomers((prev) => prev.filter((c) => c.id !== id));
    setCustomerTransactions((prev) => prev.filter((t) => t.customerId !== id));
    setCustomerReminders((prev) => prev.filter((r) => r.customerId !== id));
    setOrders((prev) =>
      prev.some((o) => o.customerId === id) ? prev.map((o) => (o.customerId === id ? { ...o, customerId: undefined } : o)) : prev
    );

    if (import.meta.env.VITE_SUPABASE_URL) {
      enqueuePendingSync('customer_delete', { id });
    }
  };

  const getCustomerById = (id: string) => {
    return customers.find((c) => c.id === id);
  };

  // "Credit reversal ..." entries take a cancelled bill off the balance (see isCreditReversal), so a
  // payment typed in by hand must never be worded like one.
  const REVERSAL_WORDING_ERROR = 'A payment description can\'t start with "Credit reversal": that wording is kept for cancelled bills.';

  const addCustomerPayment = (customerId: string, amount: number, description: string, paymentMethod: 'cash' | 'card'): boolean => {
    if (!customersRef.current.some((c) => c.id === customerId)) {
      toast.error('Customer not found');
      return false;
    }
    if (!isValidAmount(amount)) {
      toast.error('Enter an amount above 0 with at most 2 decimals');
      return false;
    }
    const text = description.trim() || `${paymentMethod === 'card' ? 'Card' : 'Cash'} payment received`;
    if (isCreditReversal({ type: 'payment', description: text })) {
      toast.error(REVERSAL_WORDING_ERROR);
      return false;
    }
    const value = Number(amount.toFixed(2));
    const transaction: CustomerTransaction = {
      id: generateId(),
      customerId,
      type: 'payment',
      amount: value,
      paymentMethod,
      ...customerPaymentCharges(value, paymentMethod, settings.cardFeePercent ?? 0),
      description: text,
      createdAt: new Date().toISOString(),
    };
    customerTransactionsRef.current = [...customerTransactionsRef.current, transaction];
    setCustomerTransactions((prev) => [...prev, transaction]);
    setCustomers((prev) => prev.map((c) => (c.id === customerId ? applyCustomerLedger(c, { added: [transaction] }) : c)));

    if (import.meta.env.VITE_SUPABASE_URL) {
      // The customer's totals follow from the entry in the database.
      enqueuePendingSync('customer_payment', { transaction });
    }
    return true;
  };

  /**
   * Edits a customer ledger entry: amount, payment method, date (the calendar day; the time of day
   * is kept) and description. Entries that belong to a bill (credit sales and their reversals) only
   * allow the description to change: their amount follows the bill, which is edited or cancelled
   * from POS → Manage Bills.
   */
  const updateCustomerTransaction = (
    id: string,
    updates: { amount?: number; description?: string; paymentMethod?: 'cash' | 'card'; date?: string }
  ): boolean => {
    const old = customerTransactionsRef.current.find((t) => t.id === id);
    if (!old) return false;

    if (updates.amount !== undefined && !isValidAmount(updates.amount)) {
      toast.error('Enter an amount above 0 with at most 2 decimals');
      return false;
    }
    if (updates.date !== undefined && !isValidLocalDate(updates.date)) {
      toast.error('Enter a valid date');
      return false;
    }
    if (updates.date !== undefined && updates.date > todayLocal()) {
      toast.error("The date can't be in the future");
      return false;
    }

    // A card payment keeps the fee rate it was taken with; switching to card uses today's rate.
    const { next, dbUpdates } = editedCustomerTransaction(old, updates, settings.cardFeePercent ?? 0);

    if (old.orderId && (next.amount !== old.amount || next.paymentMethod !== old.paymentMethod || next.createdAt !== old.createdAt)) {
      toast.error(`This entry belongs to Bill #${billNumber(old.orderId)}. Edit or cancel the bill from POS → Manage Bills.`);
      return false;
    }
    if (isCreditReversal(old) !== isCreditReversal(next)) {
      toast.error(
        isCreditReversal(old)
          ? 'Keep "Credit reversal" at the start of this description: it is what takes the bill off the balance.'
          : REVERSAL_WORDING_ERROR
      );
      return false;
    }

    customerTransactionsRef.current = customerTransactionsRef.current.map((t) => (t.id === id ? next : t));
    setCustomerTransactions((prev) => prev.map((t) => (t.id === id ? next : t)));
    setCustomers((prev) =>
      prev.map((c) => (c.id === old.customerId ? applyCustomerLedger(c, { removed: [old], added: [next] }) : c))
    );

    // The customer's totals follow from the edited entry in the database.
    if (import.meta.env.VITE_SUPABASE_URL && Object.keys(dbUpdates).length > 0) {
      enqueuePendingSync('customer_transaction_update', { id, dbUpdates });
    }
    return true;
  };

  const deleteCustomerTransaction = (id: string): boolean => {
    const old = customerTransactionsRef.current.find((t) => t.id === id);
    if (!old) return false;
    if (old.orderId) {
      toast.error(`This entry belongs to Bill #${billNumber(old.orderId)}. Edit or cancel the bill from POS → Manage Bills.`);
      return false;
    }

    customerTransactionsRef.current = customerTransactionsRef.current.filter((t) => t.id !== id);
    setCustomerTransactions((prev) => prev.filter((t) => t.id !== id));
    setCustomers((prev) => prev.map((c) => (c.id === old.customerId ? applyCustomerLedger(c, { removed: [old] }) : c)));

    if (import.meta.env.VITE_SUPABASE_URL) {
      // The customer's totals follow from the removed entry in the database.
      enqueuePendingSync('customer_transaction_delete', { id, customerId: old.customerId });
    }
    return true;
  };

  const getCustomerTransactions = (customerId: string) => {
    return customerTransactions.filter((t) => t.customerId === customerId);
  };

  const addCustomerReminder = (
    customerId: string,
    frequency: ReminderFrequency,
    nextReminderDate: string,
    note?: string
  ): boolean => {
    if (!customersRef.current.some((c) => c.id === customerId)) {
      toast.error('Customer not found');
      return false;
    }
    if (!isValidLocalDate(nextReminderDate)) {
      toast.error('Choose a valid reminder date');
      return false;
    }
    const reminder: CustomerReminder = {
      id: generateId(),
      customerId,
      frequency,
      nextReminderDate,
      isActive: true,
      note: note?.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    customerRemindersRef.current = [reminder, ...customerRemindersRef.current];
    setCustomerReminders((prev) => [reminder, ...prev]);

    if (import.meta.env.VITE_SUPABASE_URL) {
      enqueuePendingSync('customer_reminder_add', { reminder });
    }
    return true;
  };

  const updateCustomerReminder = (id: string, updates: Partial<CustomerReminder>): boolean => {
    if (!customerRemindersRef.current.some((r) => r.id === id)) return false;
    if (updates.nextReminderDate !== undefined && !isValidLocalDate(updates.nextReminderDate)) {
      toast.error('Choose a valid reminder date');
      return false;
    }
    const { id: _id, customerId: _customerId, createdAt: _createdAt, ...changes } = updates;
    if ('note' in changes) changes.note = changes.note?.trim() || undefined;
    customerRemindersRef.current = customerRemindersRef.current.map((r) => (r.id === id ? { ...r, ...changes } : r));
    setCustomerReminders((prev) =>
      prev.map((reminder) => (reminder.id === id ? { ...reminder, ...changes } : reminder))
    );

    if (import.meta.env.VITE_SUPABASE_URL) {
      const dbUpdates: Record<string, unknown> = {};
      if (changes.frequency !== undefined) dbUpdates.frequency = changes.frequency;
      if (changes.nextReminderDate !== undefined) dbUpdates.next_reminder_date = changes.nextReminderDate;
      if (changes.isActive !== undefined) dbUpdates.is_active = changes.isActive;
      // A cleared note arrives as `note: undefined` and must be cleared in the cloud too.
      if ('note' in changes) dbUpdates.note = changes.note ?? null;
      if (changes.lastTriggeredAt !== undefined) dbUpdates.last_triggered_at = changes.lastTriggeredAt;

      if (Object.keys(dbUpdates).length > 0) enqueuePendingSync('customer_reminder_update', { id, dbUpdates });
    }
    return true;
  };

  const deleteCustomerReminder = (id: string) => {
    customerRemindersRef.current = customerRemindersRef.current.filter((r) => r.id !== id);
    setCustomerReminders((prev) => prev.filter((reminder) => reminder.id !== id));

    if (import.meta.env.VITE_SUPABASE_URL) {
      enqueuePendingSync('customer_reminder_delete', { id });
    }
  };

  const getCustomerReminders = (customerId: string) => {
    return customerReminders.filter((reminder) => reminder.customerId === customerId);
  };

  const getDueCustomerReminders = () => {
    const today = todayLocal();
    return customerReminders.filter((reminder) => reminder.isActive && reminder.nextReminderDate <= today);
  };

  const markReminderTriggered = (id: string) => {
    const reminder = customerRemindersRef.current.find((r) => r.id === id);
    if (!reminder) return;

    updateCustomerReminder(id, {
      lastTriggeredAt: new Date().toISOString(),
      nextReminderDate: calculateNextReminderDate(reminder.nextReminderDate, reminder.frequency),
    });
  };

  // Supplier functions
  const addSupplier = (
    supplier: Omit<Supplier, 'id' | 'createdAt' | 'totalPurchased' | 'totalPaid' | 'balance'>
  ) => {
    const newSupplier: Supplier = {
      ...supplier,
      id: generateId(),
      createdAt: new Date().toISOString(),
      totalPurchased: 0,
      totalPaid: 0,
      balance: 0,
    };

    suppliersRef.current = [newSupplier, ...suppliersRef.current];
    setSuppliers((prev) => [newSupplier, ...prev]);

    if (import.meta.env.VITE_SUPABASE_URL) {
      enqueuePendingSync('supplier_add', { supplier: newSupplier });
    }
  };

  const updateSupplier = (id: string, updates: Partial<Supplier>) => {
    // Totals only ever change through ledger entries (see applySupplierLedger).
    const { id: _id, createdAt: _createdAt, totalPurchased: _purchased, totalPaid: _paid, balance: _balance, ...details } = updates;
    setSuppliers((prev) => prev.map((s) => (s.id === id ? { ...s, ...details } : s)));

    if (import.meta.env.VITE_SUPABASE_URL) {
      const dbUpdates: Record<string, unknown> = {};
      if (details.name !== undefined) dbUpdates.name = details.name;
      if (details.phone !== undefined) dbUpdates.phone = details.phone;
      if (details.address !== undefined) dbUpdates.address = details.address;
      // Cleared optional fields arrive as `undefined` and must be cleared in the cloud too.
      if ('contactPerson' in details) dbUpdates.contact_person = details.contactPerson?.trim() || null;
      if ('notes' in details) dbUpdates.notes = details.notes?.trim() || null;

      if (Object.keys(dbUpdates).length > 0) enqueuePendingSync('supplier_update', { id, dbUpdates });
    }
  };

  // The database also deletes the supplier's purchases, payments and payment schedules.
  const deleteSupplier = (id: string) => {
    suppliersRef.current = suppliersRef.current.filter((s) => s.id !== id);
    supplierPurchasesRef.current = supplierPurchasesRef.current.filter((p) => p.supplierId !== id);
    supplierPaymentSchedulesRef.current = supplierPaymentSchedulesRef.current.filter((s) => s.supplierId !== id);
    setSuppliers((prev) => prev.filter((s) => s.id !== id));
    setSupplierPurchases((prev) => prev.filter((p) => p.supplierId !== id));
    setSupplierPaymentSchedules((prev) => prev.filter((s) => s.supplierId !== id));

    if (import.meta.env.VITE_SUPABASE_URL) {
      enqueuePendingSync('supplier_delete', { id });
    }
  };

  const getSupplierById = (id: string) => suppliers.find((s) => s.id === id);

  // Supplier ledger amounts are signed: purchases are positive, payments to the supplier negative.
  const isValidSupplierAmount = (amount: number) => isValidAmount(Math.abs(amount));

  const addSupplierPurchase = (purchase: Omit<SupplierPurchase, 'id' | 'createdAt'>): boolean => {
    if (!suppliersRef.current.some((s) => s.id === purchase.supplierId)) {
      toast.error('Supplier not found');
      return false;
    }
    if (!isValidSupplierAmount(purchase.amount)) {
      toast.error('Enter an amount above 0 with at most 2 decimals');
      return false;
    }
    if (!isValidLocalDate(purchase.purchaseDate)) {
      toast.error('Enter a valid date');
      return false;
    }
    const amount = Number(purchase.amount.toFixed(2));
    const newPurchase: SupplierPurchase = {
      ...purchase,
      amount,
      // The database requires a description.
      description: purchase.description.trim() || (amount < 0 ? 'Payment to supplier' : 'Purchase'),
      invoiceNumber: purchase.invoiceNumber?.trim() || undefined,
      id: generateId(),
      createdAt: new Date().toISOString(),
    };

    supplierPurchasesRef.current = [newPurchase, ...supplierPurchasesRef.current];
    setSupplierPurchases((prev) => [newPurchase, ...prev]);
    setSuppliers((prev) => prev.map((s) => (s.id === newPurchase.supplierId ? applySupplierLedger(s, { added: [newPurchase] }) : s)));

    if (import.meta.env.VITE_SUPABASE_URL) {
      // The supplier's totals follow from the entry in the database.
      enqueuePendingSync('supplier_purchase_add', { purchase: newPurchase });
    }
    return true;
  };

  /**
   * Edits a supplier ledger entry: amount (negative = payment, so flipping the sign turns a
   * purchase into a payment), date, invoice number and description.
   */
  const updateSupplierPurchase = (
    id: string,
    updates: { amount?: number; description?: string; purchaseDate?: string; invoiceNumber?: string }
  ): boolean => {
    const old = supplierPurchasesRef.current.find((p) => p.id === id);
    if (!old) return false;
    if (updates.amount !== undefined && !isValidSupplierAmount(updates.amount)) {
      toast.error('Enter an amount above 0 with at most 2 decimals');
      return false;
    }
    if (updates.purchaseDate !== undefined && !isValidLocalDate(updates.purchaseDate)) {
      toast.error('Enter a valid date');
      return false;
    }

    const { next, dbUpdates } = editedSupplierPurchase(old, updates);
    supplierPurchasesRef.current = supplierPurchasesRef.current.map((p) => (p.id === id ? next : p));
    setSupplierPurchases((prev) => prev.map((p) => (p.id === id ? next : p)));
    setSuppliers((prev) =>
      prev.map((s) => (s.id === old.supplierId ? applySupplierLedger(s, { removed: [old], added: [next] }) : s))
    );

    // The supplier's totals follow from the edited entry in the database.
    if (import.meta.env.VITE_SUPABASE_URL && Object.keys(dbUpdates).length > 0) {
      enqueuePendingSync('supplier_purchase_update', { id, dbUpdates });
    }
    return true;
  };

  // Deleting a "Receive stock" entry does not take the stock back out (see isStockIntakeEntry).
  const deleteSupplierPurchase = (id: string): boolean => {
    const old = supplierPurchasesRef.current.find((p) => p.id === id);
    if (!old) return false;

    supplierPurchasesRef.current = supplierPurchasesRef.current.filter((p) => p.id !== id);
    setSupplierPurchases((prev) => prev.filter((p) => p.id !== id));
    setSuppliers((prev) => prev.map((s) => (s.id === old.supplierId ? applySupplierLedger(s, { removed: [old] }) : s)));

    if (import.meta.env.VITE_SUPABASE_URL) {
      // The supplier's totals follow from the removed entry in the database.
      enqueuePendingSync('supplier_purchase_delete', { id, supplierId: old.supplierId });
    }
    return true;
  };

  const receiveSupplierStockBatch = (input: {
    supplierId: string;
    items: Array<{
      productId: string;
      quantity: number;
      unitCost?: number;
      expiryDate?: string;
      note?: string;
    }>;
    paidAmount?: number;
    purchaseDate?: string;
    invoiceNumber?: string;
    note?: string;
  }): boolean => {
    if (!input.items || input.items.length === 0) {
      toast.error('Please add at least one product item');
      return false;
    }

    const supplier = suppliersRef.current.find((s) => s.id === input.supplierId);
    if (!supplier) {
      toast.error('Supplier not found');
      return false;
    }
    if (input.purchaseDate && !isValidLocalDate(input.purchaseDate)) {
      toast.error('Enter a valid purchase date');
      return false;
    }

    const purchaseDate = input.purchaseDate || todayLocal();
    const createdAt = new Date().toISOString();

    const resolvedInvoiceNumber = input.invoiceNumber?.trim()
      ? input.invoiceNumber.trim()
      : `INV-${purchaseDate.replace(/-/g, '')}-${Date.now().toString().slice(-6)}`;

    const productsToUpdate = [...productsRef.current];
    let totalPurchaseAmount = 0;

    const itemSummaries: string[] = [];

    // Track which products actually changed for Supabase sync, and how much stock each received.
    const changedProductIds = new Set<string>();
    const receivedQuantities = new Map<string, number>();

    for (const item of input.items) {
      const quantity = Math.floor(item.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        toast.error('Each item quantity must be at least 1');
        return false;
      }

      const originalProduct = productsRef.current.find((p) => p.id === item.productId);
      if (!originalProduct) {
        toast.error('One or more products were not found');
        return false;
      }

      const resolvedUnitCost = item.unitCost !== undefined ? item.unitCost : originalProduct.costPrice;
      if (!Number.isFinite(resolvedUnitCost) || resolvedUnitCost < 0) {
        toast.error('Unit cost must be a valid non-negative number');
        return false;
      }

      const itemExpiry = item.expiryDate || originalProduct.expiryDate;
      const newBatchSku = itemExpiry
        ? `${originalProduct.sku}-EXP-${itemExpiry.replace(/-/g, '')}`
        : `${originalProduct.sku}-B${Date.now().toString().slice(-4)}`;

      // Find if a product with same SKU AND same Expiry exists, or the batch made for that expiry
      // last time (otherwise a second delivery would create another product with the same SKU).
      let targetProduct = productsToUpdate.find(
        (p) =>
          (p.sku === originalProduct.sku && (p.expiryDate === itemExpiry || (!p.expiryDate && !itemExpiry))) ||
          (!!itemExpiry && p.sku === newBatchSku)
      );

      if (!targetProduct) {
        // Create a new batch clone
        targetProduct = {
          ...originalProduct,
          id: generateId(),
          sku: newBatchSku,
          expiryDate: itemExpiry,
          stockQuantity: 0,
          costPrice: resolvedUnitCost,
        };
        productsToUpdate.push(targetProduct);
        toast.info(`Created new batch for ${originalProduct.name} (Exp: ${itemExpiry || 'None'})`);
      }

      const amount = Number((resolvedUnitCost * quantity).toFixed(2));
      totalPurchaseAmount += amount;

      itemSummaries.push(`${originalProduct.name} x${quantity}`);

      // Update the target product
      const targetIndex = productsToUpdate.findIndex(p => p.id === targetProduct!.id);
      productsToUpdate[targetIndex] = {
        ...productsToUpdate[targetIndex],
        stockQuantity: productsToUpdate[targetIndex].stockQuantity + quantity,
        costPrice: resolvedUnitCost,
      };
      
      changedProductIds.add(productsToUpdate[targetIndex].id);
      receivedQuantities.set(
        productsToUpdate[targetIndex].id,
        (receivedQuantities.get(productsToUpdate[targetIndex].id) || 0) + quantity
      );

    }

    const paidAmount = Number((input.paidAmount ?? 0).toFixed(2));
    if (!Number.isFinite(paidAmount) || paidAmount < 0) {
      toast.error('Paid amount must be a valid non-negative number');
      return false;
    }
    if (paidAmount > Number(totalPurchaseAmount.toFixed(2))) {
      toast.error('Paid amount cannot be greater than total purchase amount');
      return false;
    }

    const invoicePurchase: SupplierPurchase = {
      id: generateId(),
      supplierId: supplier.id,
      // Always starts with "Stock intake" so the ledger can tell this entry also added stock.
      description:
        `Stock intake (${input.items.length} item${input.items.length === 1 ? '' : 's'}): ${itemSummaries.join(', ')}` +
        (input.note?.trim() ? ` - ${input.note.trim()}` : ''),
      amount: Number(totalPurchaseAmount.toFixed(2)),
      purchaseDate,
      invoiceNumber: resolvedInvoiceNumber,
      createdAt,
    };

    const paymentPurchase: SupplierPurchase | null = paidAmount > 0
      ? {
          id: generateId(),
          supplierId: supplier.id,
          description: `Payment received${resolvedInvoiceNumber ? ` for invoice ${resolvedInvoiceNumber}` : ''}`,
          amount: Number((-paidAmount).toFixed(2)),
          purchaseDate,
          invoiceNumber: resolvedInvoiceNumber,
          createdAt,
        }
      : null;

    const ledgerEntries = paymentPurchase ? [invoicePurchase, paymentPurchase] : [invoicePurchase];

    // Optimistic Update
    productsRef.current = productsToUpdate;
    setProducts(productsToUpdate);
    supplierPurchasesRef.current = [...ledgerEntries, ...supplierPurchasesRef.current];
    setSupplierPurchases((prev) => [...ledgerEntries, ...prev]);
    setSuppliers((prev) => prev.map((s) => (s.id === supplier.id ? applySupplierLedger(s, { added: ledgerEntries }) : s)));

    // Uploaded in the background through the sync queue.
    if (import.meta.env.VITE_SUPABASE_URL) {
      const productsToSync = productsToUpdate.filter((p) => changedProductIds.has(p.id));
      enqueuePendingSync('supplier_stock_receive_batch', {
        productUpserts: productsToSync,
        stockMovements: [...receivedQuantities].map(([productId, delta]) => ({
          id: generateId(),
          productId,
          delta,
          reason: `Received from ${supplier.name} (${resolvedInvoiceNumber})`,
          createdAt,
        })),
        purchases: ledgerEntries,
        supplierId: supplier.id,
      });
    }
    toast.success(`Stock intake saved (Invoice: ${resolvedInvoiceNumber})`);
    return true;
  };

  const receiveSupplierStock = (input: {
    productId: string;
    supplierId: string;
    quantity: number;
    unitCost?: number;
    paidAmount?: number;
    purchaseDate?: string;
    invoiceNumber?: string;
    note?: string;
  }): boolean => {
    return receiveSupplierStockBatch({
      supplierId: input.supplierId,
      items: [
        {
          productId: input.productId,
          quantity: input.quantity,
          unitCost: input.unitCost,
          note: input.note,
        },
      ],
      paidAmount: input.paidAmount,
      purchaseDate: input.purchaseDate,
      invoiceNumber: input.invoiceNumber,
      note: input.note,
    });
  };

  const getSupplierPurchases = (supplierId: string) =>
    supplierPurchases.filter((p) => p.supplierId === supplierId);

  const addSupplierPaymentSchedule = (
    schedule: Omit<SupplierPaymentSchedule, 'id' | 'createdAt' | 'isActive' | 'lastPaidAt'>
  ): boolean => {
    if (!suppliersRef.current.some((s) => s.id === schedule.supplierId)) {
      toast.error('Supplier not found');
      return false;
    }
    if (!isValidAmount(schedule.amount)) {
      toast.error('Enter an amount above 0 with at most 2 decimals');
      return false;
    }
    if (!isValidLocalDate(schedule.nextPaymentDate)) {
      toast.error('Choose a valid payment date');
      return false;
    }
    const newSchedule: SupplierPaymentSchedule = {
      ...schedule,
      amount: Number(schedule.amount.toFixed(2)),
      note: schedule.note?.trim() || undefined,
      id: generateId(),
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    supplierPaymentSchedulesRef.current = [newSchedule, ...supplierPaymentSchedulesRef.current];
    setSupplierPaymentSchedules((prev) => [newSchedule, ...prev]);

    if (import.meta.env.VITE_SUPABASE_URL) {
      enqueuePendingSync('supplier_schedule_add', { schedule: newSchedule });
    }
    return true;
  };

  const updateSupplierPaymentSchedule = (id: string, updates: Partial<SupplierPaymentSchedule>): boolean => {
    if (!supplierPaymentSchedulesRef.current.some((s) => s.id === id)) return false;
    if (updates.amount !== undefined && !isValidAmount(updates.amount)) {
      toast.error('Enter an amount above 0 with at most 2 decimals');
      return false;
    }
    if (updates.nextPaymentDate !== undefined && !isValidLocalDate(updates.nextPaymentDate)) {
      toast.error('Choose a valid payment date');
      return false;
    }
    const { id: _id, supplierId: _supplierId, createdAt: _createdAt, ...changes } = updates;
    if (changes.amount !== undefined) changes.amount = Number(changes.amount.toFixed(2));
    if ('note' in changes) changes.note = changes.note?.trim() || undefined;
    supplierPaymentSchedulesRef.current = supplierPaymentSchedulesRef.current.map((s) => (s.id === id ? { ...s, ...changes } : s));
    setSupplierPaymentSchedules((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...changes } : s))
    );

    if (import.meta.env.VITE_SUPABASE_URL) {
      const dbUpdates: Record<string, unknown> = {};
      if (changes.frequency !== undefined) dbUpdates.frequency = changes.frequency;
      if (changes.nextPaymentDate !== undefined) dbUpdates.next_payment_date = changes.nextPaymentDate;
      if (changes.amount !== undefined) dbUpdates.amount = changes.amount;
      if (changes.isActive !== undefined) dbUpdates.is_active = changes.isActive;
      // A cleared note arrives as `note: undefined` and must be cleared in the cloud too.
      if ('note' in changes) dbUpdates.note = changes.note ?? null;
      if (changes.lastPaidAt !== undefined) dbUpdates.last_paid_at = changes.lastPaidAt;

      if (Object.keys(dbUpdates).length > 0) enqueuePendingSync('supplier_schedule_update', { id, dbUpdates });
    }
    return true;
  };

  const deleteSupplierPaymentSchedule = (id: string) => {
    supplierPaymentSchedulesRef.current = supplierPaymentSchedulesRef.current.filter((s) => s.id !== id);
    setSupplierPaymentSchedules((prev) => prev.filter((s) => s.id !== id));

    if (import.meta.env.VITE_SUPABASE_URL) {
      enqueuePendingSync('supplier_schedule_delete', { id });
    }
  };

  const getSupplierPaymentSchedules = (supplierId: string) =>
    supplierPaymentSchedules.filter((s) => s.supplierId === supplierId);

  const getDueSupplierPaymentSchedules = () => {
    const today = todayLocal();
    return supplierPaymentSchedules.filter((s) => s.isActive && s.nextPaymentDate <= today);
  };

  /** Records the scheduled amount as a payment to the supplier (dated today) and moves the schedule on. */
  const markSupplierSchedulePaid = (id: string): boolean => {
    const schedule = supplierPaymentSchedulesRef.current.find((s) => s.id === id);
    if (!schedule) return false;
    const supplier = suppliersRef.current.find((s) => s.id === schedule.supplierId);
    if (!supplier) {
      toast.error('Supplier not found');
      return false;
    }
    if (!isValidAmount(schedule.amount)) {
      toast.error('Set an amount for this schedule first');
      return false;
    }

    const createdAt = new Date().toISOString();
    const paymentEntry: SupplierPurchase = {
      id: generateId(),
      supplierId: supplier.id,
      description: schedule.note?.trim() || `Payment received (schedule: ${schedule.frequency})`,
      amount: Number((-schedule.amount).toFixed(2)),
      purchaseDate: todayLocal(),
      createdAt,
    };

    supplierPurchasesRef.current = [paymentEntry, ...supplierPurchasesRef.current];
    setSupplierPurchases((prev) => [paymentEntry, ...prev]);
    setSuppliers((prev) => prev.map((s) => (s.id === supplier.id ? applySupplierLedger(s, { added: [paymentEntry] }) : s)));

    if (import.meta.env.VITE_SUPABASE_URL) {
      // The supplier's totals follow from the entry in the database.
      enqueuePendingSync('supplier_payment_add', { purchase: paymentEntry });
    }

    updateSupplierPaymentSchedule(id, {
      lastPaidAt: createdAt,
      nextPaymentDate: calculateNextScheduleDate(schedule.nextPaymentDate, schedule.frequency),
    });
    return true;
  };

  // Helper to add credit transaction when creating credit order. (Always uploaded: it used to be
  // skipped when the customer was not in this render's list, e.g. one added a moment before.)
  const addCreditTransaction = async (customerId: string, orderId: string, amount: number) => {
    postOrderLedgerEntry({
      customerId,
      orderId,
      type: 'credit',
      amount,
      description: `Credit sale - Order #${billNumber(orderId)}`,
    });
  };

  const manualSync = useCallback(async () => {
    if (!import.meta.env.VITE_SUPABASE_URL) {
      toast.error('Supabase is not configured.');
      return;
    }
    if (!user) {
      toast.error('Sign in to sync.');
      return;
    }
    // Pressing Sync now also retries changes that were set aside after database errors.
    updateQueue((ops) => ops.map((op) => (op.parked ? { ...op, parked: false, retryCount: 0 } : op)));
    const pending = pendingSyncOpsRef.current.length;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      toast.error(
        pending > 0
          ? `You are offline. ${pending} change${pending === 1 ? '' : 's'} saved on this device, waiting to sync.`
          : 'You are offline.'
      );
      return;
    }

    const toastId = toast.loading(pending > 0 ? `Syncing ${pending} pending changes...` : 'Syncing with cloud...');
    const result = await processPendingSyncQueue();
    toast.dismiss(toastId);
    // Signed out while syncing: nothing more to tell the next screen.
    if (!signedInRef.current) return;

    if (result.failed > 0) {
      const error = pendingSyncOpsRef.current.find((op) => op.lastError)?.lastError;
      toast.error(
        `${result.failed} change${result.failed === 1 ? '' : 's'} could not be uploaded yet. They stay saved on this device and keep retrying.${error ? ` (${error})` : ''}`
      );
      return;
    }

    // Everything is on the server: reload from it without resetting the open cart.
    setRefreshKey((k) => k + 1);
    if (result.synced === 0) toast.success('Everything is up to date.');
  }, [processPendingSyncQueue, user, updateQueue]);

  const syncStatus: SyncStatus = {
    online: isOnline,
    syncing: isSyncing,
    pending: pendingSyncOps.filter((op) => !op.parked).length,
    failed: pendingSyncOps.filter((op) => op.parked).length,
    lastError: pendingSyncOps.find((op) => op.lastError)?.lastError,
    lastSyncedAt,
    needsDbUpdate,
    live: isLive,
  };

  return (
    <StoreContext.Provider
      value={{
        products,
        addProduct,
        updateProduct,
        deleteProducts,
        adjustProductStock,
        getProductBySku,
        units,
        addUnit,
        updateUnit,
        deleteUnit,
        getUnitById,
        categories,
        addCategory,
        updateCategory,
        deleteCategory,
        customers,
        customerTransactions,
        customerReminders,
        addCustomer,
        updateCustomer,
        deleteCustomer,
        getCustomerById,
        addCustomerPayment,
        updateCustomerTransaction,
        deleteCustomerTransaction,
        getCustomerTransactions,
        addCustomerReminder,
        updateCustomerReminder,
        deleteCustomerReminder,
        getCustomerReminders,
        getDueCustomerReminders,
        markReminderTriggered,
        suppliers,
        supplierPurchases,
        supplierPaymentSchedules,
        addSupplier,
        updateSupplier,
        deleteSupplier,
        getSupplierById,
        addSupplierPurchase,
        updateSupplierPurchase,
        deleteSupplierPurchase,
        receiveSupplierStock,
        receiveSupplierStockBatch,
        getSupplierPurchases,
        addSupplierPaymentSchedule,
        updateSupplierPaymentSchedule,
        deleteSupplierPaymentSchedule,
        getSupplierPaymentSchedules,
        getDueSupplierPaymentSchedules,
        markSupplierSchedulePaid,
        orders,
        orderItems,
        orderEditLogs,
        createOrder,
        updateOrder,
        updateOrderFull,
        cancelOrder,
        createExchange,
        getOrderItems,
        getOrderEditLogs,
        getCustomerOrders,
        settings,
        updateSettings,
        cart,
        addToCart,
        updateCartItem,
        removeFromCart,
        clearCart,
        globalDiscount,
        globalDiscountType,
        setGlobalDiscount,
        heldCarts,
        holdCart,
        recallCart,
        deleteHeldCart,
        calculateSubtotal,
        calculateTax,
        calculateTotal,
        calculateItemDiscount,
        calculateGlobalDiscountAmount,
        manualSync,
        syncStatus,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}

