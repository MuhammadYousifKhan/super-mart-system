import React, { useState, useEffect, useRef, useCallback, ReactNode } from 'react';
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
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { db, saveArrayToDexie, loadArrayFromDexie, saveSettingsToDexie, loadSettingsFromDexie } from '@/db/db';
import { computeEditedOrderTotals } from '@/lib/orderMath';

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

export interface StoreContextType {
  // Products
  products: Product[];
  addProduct: (product: Omit<Product, 'id'>) => void;
  updateProduct: (id: string, product: Partial<Product>) => void;
  deleteProducts: (ids: string[]) => void;
  getProductBySku: (sku: string) => Product | undefined;

  // Units
  units: Unit[];
  addUnit: (unit: Omit<Unit, 'id'>) => void;
  updateUnit: (id: string, unit: Partial<Unit>) => void;
  deleteUnit: (id: string) => void;
  getUnitById: (id: string) => Unit | undefined;

  // Categories
  categories: Category[];
  addCategory: (category: Omit<Category, 'id'>) => void;
  updateCategory: (id: string, category: Partial<Category>) => void;
  deleteCategory: (id: string) => void;

  // Customers (Digi Khata)
  customers: Customer[];
  customerTransactions: CustomerTransaction[];
  customerReminders: CustomerReminder[];
  addCustomer: (customer: Omit<Customer, 'id' | 'createdAt' | 'totalCredit' | 'totalPaid' | 'balance'>) => void;
  updateCustomer: (id: string, customer: Partial<Customer>) => void;
  deleteCustomer: (id: string) => void;
  getCustomerById: (id: string) => Customer | undefined;
  addCustomerPayment: (customerId: string, amount: number, description: string, paymentMethod: 'cash' | 'card') => void;
  updateCustomerTransaction: (id: string, updates: { amount?: number; description?: string }) => void;
  deleteCustomerTransaction: (id: string) => void;
  getCustomerTransactions: (customerId: string) => CustomerTransaction[];
  addCustomerReminder: (customerId: string, frequency: ReminderFrequency, nextReminderDate: string, note?: string) => void;
  updateCustomerReminder: (id: string, updates: Partial<CustomerReminder>) => void;
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
  addSupplierPurchase: (purchase: Omit<SupplierPurchase, 'id' | 'createdAt'>) => void;
  receiveSupplierStock: (input: {
    productId: string;
    supplierId: string;
    quantity: number;
    unitCost?: number;
    paidAmount?: number;
    purchaseDate?: string;
    invoiceNumber?: string;
    note?: string;
  }) => void;
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
  }) => void;
  getSupplierPurchases: (supplierId: string) => SupplierPurchase[];
  updateSupplierPurchase: (id: string, updates: { amount?: number; description?: string }) => void;
  deleteSupplierPurchase: (id: string) => void;
  addSupplierPaymentSchedule: (schedule: Omit<SupplierPaymentSchedule, 'id' | 'createdAt' | 'isActive' | 'lastPaidAt'>) => void;
  updateSupplierPaymentSchedule: (id: string, updates: Partial<SupplierPaymentSchedule>) => void;
  deleteSupplierPaymentSchedule: (id: string) => void;
  getSupplierPaymentSchedules: (supplierId: string) => SupplierPaymentSchedule[];
  getDueSupplierPaymentSchedules: () => SupplierPaymentSchedule[];
  markSupplierSchedulePaid: (id: string) => void;

  // Orders
  orders: Order[];
  orderItems: OrderItem[];
  orderEditLogs: OrderEditLog[];
  createOrder: (options: CreateOrderOptions) => Promise<Order>;
  updateOrder: (id: string, updates: Partial<Order>) => Promise<void>;
  updateOrderFull: (id: string, newItems: Array<{ productId: string; productName: string; productSku: string; quantity: number; unitPrice: number; discountAmount: number }>, orderUpdates: Partial<Order>) => Promise<void>;
  cancelOrder: (id: string) => Promise<void>;
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
  | 'product_delete';

interface PendingSyncOperation {
  id: string;
  type: PendingSyncOperationType;
  payload: any;
  createdAt: string;
  retryCount: number;
  lastError?: string;
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
  const baseDate = new Date(currentDate);
  if (frequency === 'daily') {
    baseDate.setDate(baseDate.getDate() + 1);
  } else if (frequency === 'weekly') {
    baseDate.setDate(baseDate.getDate() + 7);
  } else {
    baseDate.setMonth(baseDate.getMonth() + 1);
  }
  return baseDate.toISOString().slice(0, 10);
}

function calculateNextScheduleDate(currentDate: string, frequency: ScheduleFrequency): string {
  const baseDate = new Date(currentDate);
  if (frequency === 'daily') {
    baseDate.setDate(baseDate.getDate() + 1);
  } else if (frequency === 'weekly') {
    baseDate.setDate(baseDate.getDate() + 7);
  } else {
    baseDate.setMonth(baseDate.getMonth() + 1);
  }
  return baseDate.toISOString().slice(0, 10);
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
  // Always the latest products, so stock maths never starts from a stale snapshot.
  const productsRef = useRef<Product[]>([]);
  productsRef.current = products;
  // The queue is read through refs so retry timers and in-flight runs never act on a stale copy.
  const pendingSyncOpsRef = useRef<PendingSyncOperation[]>(pendingSyncOps);
  pendingSyncOpsRef.current = pendingSyncOps;
  const processingRef = useRef<Promise<SyncResult> | null>(null);
  const processQueueRef = useRef<() => Promise<SyncResult>>(async () => ({ synced: 0, failed: 0 }));

  const enqueuePendingSync = useCallback(
    (type: PendingSyncOperationType, payload: any, errorMessage?: string) => {
      setPendingSyncOps((prev) => [
        ...prev,
        {
          id: generateId(),
          type,
          payload,
          createdAt: new Date().toISOString(),
          retryCount: 0,
          lastError: errorMessage,
        },
      ]);
      toast.warning('Saved locally. Will retry database sync automatically.');
    },
    []
  );

  const executePendingSyncOperation = useCallback(async (op: PendingSyncOperation) => {
    switch (op.type) {
      case 'order_with_items': {
        const payload = op.payload as { order: Order; orderItems: OrderItem[] };
        const { order, orderItems } = payload;
        const { error: orderError } = await supabase
          .from('orders')
          .upsert(
            {
              id: order.id,
              created_at: order.createdAt,
              cashier_id: order.cashierId,
              cashier_name: order.cashierName,
              subtotal: order.subtotal,
              tax_amount: order.taxAmount,
              discount_amount: order.discountAmount,
              total_amount: order.totalAmount,
              card_fee_amount: order.cardFeeAmount,
              card_fee_rate: order.cardFeeRate,
              payment_method: order.paymentMethod,
              status: order.status,
              amount_tendered: order.amountTendered,
              change_given: order.changeGiven,
              client_name: order.clientName,
              client_phone: order.clientPhone,
              transfer_type: order.transferType,
              transaction_id: order.transactionId,
              customer_id: order.customerId,
            },
            { onConflict: 'id' }
          );

        if (orderError) throw orderError;

        const { error: itemsError } = await supabase.from('order_items').upsert(
          orderItems.map((item) => ({
            id: item.id,
            order_id: item.orderId,
            product_id: item.productId,
            product_name: item.productName,
            product_sku: item.productSku,
            quantity: item.quantity,
            unit_price_at_sale: item.unitPriceAtSale,
            discount_amount: item.discountAmount,
          })),
          { onConflict: 'id' }
        );

        if (itemsError) throw itemsError;
        return;
      }

      case 'product_add': {
        const payload = op.payload as { newProduct: any };
        const p = payload.newProduct;
        const { error } = await supabase.from('products').upsert(
          {
            id: p.id,
            sku: p.sku,
            name: p.name,
            description: p.description,
            category_id: p.categoryId,
            unit_id: p.unitId,
            cost_price: p.costPrice,
            selling_price: p.sellingPrice,
            stock_quantity: p.stockQuantity,
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
        const payload = op.payload as { id: string; dbUpdates: any };
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
              total_credit: c.totalCredit,
              total_paid: c.totalPaid,
              balance: c.balance,
            },
            { onConflict: 'id' }
          );
        if (error) throw error;
        return;
      }

      case 'customer_update': {
        const payload = op.payload as { id: string; dbUpdates: any };
        const { error } = await supabase
          .from('customers')
          .update(payload.dbUpdates)
          .eq('id', payload.id);
        if (error) throw error;
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

      case 'customer_payment': {
        const payload = op.payload as {
          transaction: CustomerTransaction;
          customerId: string;
          newTotalPaid: number;
          newBalance: number;
        };

        const [transactionResult, customerResult] = await Promise.all([
          supabase.from('customer_transactions').upsert(
            {
              id: payload.transaction.id,
              customer_id: payload.transaction.customerId,
              order_id: payload.transaction.orderId,
              type: payload.transaction.type,
              amount: payload.transaction.amount,
              payment_method: payload.transaction.paymentMethod,
              card_fee_rate: payload.transaction.cardFeeRate,
              card_fee_amount: payload.transaction.cardFeeAmount,
              total_charged: payload.transaction.totalCharged,
              description: payload.transaction.description,
              created_at: payload.transaction.createdAt,
            },
            { onConflict: 'id' }
          ),
          supabase
            .from('customers')
            .update({ total_paid: payload.newTotalPaid, balance: payload.newBalance })
            .eq('id', payload.customerId),
        ]);

        if (transactionResult.error || customerResult.error) {
          throw transactionResult.error || customerResult.error;
        }
        return;
      }

      case 'customer_credit': {
        const payload = op.payload as {
          transaction: CustomerTransaction;
          customerId: string;
          newTotalCredit: number;
          newBalance: number;
        };

        const [transactionResult, customerResult] = await Promise.all([
          supabase.from('customer_transactions').upsert(
            {
              id: payload.transaction.id,
              customer_id: payload.transaction.customerId,
              order_id: payload.transaction.orderId,
              type: payload.transaction.type,
              amount: payload.transaction.amount,
              payment_method: payload.transaction.paymentMethod,
              card_fee_rate: payload.transaction.cardFeeRate,
              card_fee_amount: payload.transaction.cardFeeAmount,
              total_charged: payload.transaction.totalCharged,
              description: payload.transaction.description,
              created_at: payload.transaction.createdAt,
            },
            { onConflict: 'id' }
          ),
          supabase
            .from('customers')
            .update({ total_credit: payload.newTotalCredit, balance: payload.newBalance })
            .eq('id', payload.customerId),
        ]);

        if (transactionResult.error || customerResult.error) {
          throw transactionResult.error || customerResult.error;
        }
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
        const payload = op.payload as { id: string; dbUpdates: any };
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
            total_purchased: s.totalPurchased,
            total_paid: s.totalPaid,
            balance: s.balance,
          },
          { onConflict: 'id' }
        );
        if (error) throw error;
        return;
      }

      case 'supplier_update': {
        const payload = op.payload as { id: string; dbUpdates: any };
        const { error } = await supabase
          .from('suppliers')
          .update(payload.dbUpdates)
          .eq('id', payload.id);
        if (error) throw error;
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

      case 'supplier_purchase_add': {
        const payload = op.payload as {
          purchase: SupplierPurchase;
          supplierId: string;
          newTotalPurchased: number;
          newBalance: number;
        };

        const [purchaseResult, supplierResult] = await Promise.all([
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
          supabase
            .from('suppliers')
            .update({
              total_purchased: payload.newTotalPurchased,
              balance: payload.newBalance,
            })
            .eq('id', payload.supplierId),
        ]);

        if (purchaseResult.error || supplierResult.error) {
          throw purchaseResult.error || supplierResult.error;
        }
        return;
      }

      case 'supplier_payment_add': {
        const payload = op.payload as { purchase: SupplierPurchase };
        const p = payload.purchase;
        const { error } = await supabase.from('supplier_purchases').upsert(
          {
            id: p.id,
            supplier_id: p.supplierId,
            description: p.description,
            amount: p.amount,
            purchase_date: p.purchaseDate,
            invoice_number: p.invoiceNumber,
            created_at: p.createdAt,
          },
          { onConflict: 'id' }
        );
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

        const [productResult, purchaseResult, supplierResult] = await Promise.all([
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
          supabase
            .from('suppliers')
            .update({
              total_purchased: payload.newTotalPurchased,
              total_paid: payload.newTotalPaid,
              balance: payload.newBalance,
            })
            .eq('id', payload.supplierId),
        ]);

        if (productResult.error || purchaseResult.error || supplierResult.error) {
          throw productResult.error || purchaseResult.error || supplierResult.error;
        }
        return;
      }

      case 'supplier_stock_receive_batch': {
        const payload = op.payload as {
          productUpdates?: Array<{ productId: string; newStockQuantity: number; newCostPrice: number }>;
          productUpserts?: Product[];
          purchases: SupplierPurchase[];
          supplierId: string;
          newTotalPurchased: number;
          newTotalPaid: number;
          newBalance: number;
        };

        const productPromises: Array<PromiseLike<{ error: any }>> = [];
        if (payload.productUpserts && payload.productUpserts.length > 0) {
          productPromises.push(
            supabase.from('products').upsert(
              payload.productUpserts.map((p) => ({
                id: p.id,
                sku: p.sku,
                name: p.name,
                description: p.description,
                category_id: p.categoryId,
                unit_id: p.unitId,
                cost_price: p.costPrice,
                selling_price: p.sellingPrice,
                stock_quantity: p.stockQuantity,
                low_stock_threshold: p.lowStockThreshold,
                expiry_date: p.expiryDate,
                barcode: p.barcode,
                barcode_enabled: p.barcodeEnabled,
              })),
              { onConflict: 'id' }
            )
          );
        } else if (payload.productUpdates && payload.productUpdates.length > 0) {
          for (const item of payload.productUpdates) {
            productPromises.push(
              supabase
                .from('products')
                .update({
                  stock_quantity: item.newStockQuantity,
                  cost_price: item.newCostPrice,
                })
                .eq('id', item.productId)
            );
          }
        }

        const [purchaseResult, supplierResult, ...productResults] = await Promise.all([
          supabase.from('supplier_purchases').upsert(
            payload.purchases.map((purchase) => ({
              id: purchase.id,
              supplier_id: purchase.supplierId,
              description: purchase.description,
              amount: purchase.amount,
              purchase_date: purchase.purchaseDate,
              invoice_number: purchase.invoiceNumber,
              created_at: purchase.createdAt,
            })),
            { onConflict: 'id' }
          ),
          supabase
            .from('suppliers')
            .update({
              total_purchased: payload.newTotalPurchased,
              total_paid: payload.newTotalPaid,
              balance: payload.newBalance,
            })
            .eq('id', payload.supplierId),
          ...productPromises,
        ]);

        const firstProductError = productResults.find((r) => r.error)?.error;
        if (purchaseResult.error || supplierResult.error || firstProductError) {
          throw purchaseResult.error || supplierResult.error || firstProductError;
        }
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
        const payload = op.payload as { id: string; dbUpdates: any };
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

        const ops: Array<PromiseLike<{ error: unknown }>> = [];
        if (Object.keys(txUpdates).length > 0) {
          ops.push(supabase.from('customer_transactions').update(txUpdates).eq('id', payload.id));
        }
        if (payload.customerId && payload.customerUpdates) {
          ops.push(supabase.from('customers').update(payload.customerUpdates).eq('id', payload.customerId));
        }
        const firstError = (await Promise.all(ops)).find((r) => r.error)?.error;
        if (firstError) throw firstError;
        return;
      }

      case 'customer_transaction_delete': {
        const payload = op.payload as {
          id: string;
          customerId?: string;
          customerUpdates?: Record<string, unknown>;
        };
        const ops: Array<PromiseLike<{ error: unknown }>> = [
          supabase.from('customer_transactions').delete().eq('id', payload.id),
        ];
        if (payload.customerId && payload.customerUpdates) {
          ops.push(supabase.from('customers').update(payload.customerUpdates).eq('id', payload.customerId));
        }
        const firstError = (await Promise.all(ops)).find((r) => r.error)?.error;
        if (firstError) throw firstError;
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
        const purchaseUpdates: Record<string, unknown> = payload.dbUpdates ?? {};
        if (!payload.dbUpdates && payload.updates) {
          if (payload.updates.amount !== undefined) purchaseUpdates.amount = payload.updates.amount;
          if (payload.updates.description !== undefined) purchaseUpdates.description = payload.updates.description;
        }

        const ops: Array<PromiseLike<{ error: unknown }>> = [];
        if (Object.keys(purchaseUpdates).length > 0) {
          ops.push(supabase.from('supplier_purchases').update(purchaseUpdates).eq('id', payload.id));
        }
        if (payload.supplierId && payload.supplierUpdates) {
          ops.push(supabase.from('suppliers').update(payload.supplierUpdates).eq('id', payload.supplierId));
        }
        const firstError = (await Promise.all(ops)).find((r) => r.error)?.error;
        if (firstError) throw firstError;
        return;
      }

      case 'supplier_purchase_delete': {
        const payload = op.payload as {
          id: string;
          supplierId?: string;
          supplierUpdates?: Record<string, unknown>;
        };
        const ops: Array<PromiseLike<{ error: unknown }>> = [
          supabase.from('supplier_purchases').delete().eq('id', payload.id),
        ];
        if (payload.supplierId && payload.supplierUpdates) {
          ops.push(supabase.from('suppliers').update(payload.supplierUpdates).eq('id', payload.supplierId));
        }
        const firstError = (await Promise.all(ops)).find((r) => r.error)?.error;
        if (firstError) throw firstError;
        return;
      }

      default:
        // Never report an operation we cannot run as synced: keep it queued with a visible error.
        throw new Error(`Unknown sync operation: ${String((op as { type: string }).type)}`);
    }
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
      const snapshot = [...pendingSyncOpsRef.current];
      if (snapshot.length === 0) return { synced: 0, failed: 0 };

      const succeeded = new Set<string>();
      const failures = new Map<string, { retryCount: number; lastError: string }>();

      for (const op of snapshot) {
        try {
          await executePendingSyncOperation(op);
          succeeded.add(op.id);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : typeof error === 'object' && error !== null && 'message' in error
                ? String((error as { message: unknown }).message)
                : 'Unknown sync error';
          failures.set(op.id, { retryCount: op.retryCount + 1, lastError: message });
        }
      }

      // Functional update so changes queued while this run was in flight are kept.
      setPendingSyncOps((prev) =>
        prev
          .filter((op) => !succeeded.has(op.id))
          .map((op) => {
            const failure = failures.get(op.id);
            return failure ? { ...op, ...failure } : op;
          })
      );

      if (succeeded.size > 0) {
        toast.success(`Synced ${succeeded.size} pending changes to database.`);
      }

      const snapshotIds = new Set(snapshot.map((op) => op.id));
      const queuedDuringRun = pendingSyncOpsRef.current.some((op) => !snapshotIds.has(op.id));
      if (failures.size > 0 || queuedDuringRun) {
        const maxRetryCount = Math.max(0, ...Array.from(failures.values(), (f) => f.retryCount));
        const delayMs = Math.min(60000, 5000 * Math.max(1, maxRetryCount));
        if (pendingSyncTimer.current !== null) {
          window.clearTimeout(pendingSyncTimer.current);
        }
        pendingSyncTimer.current = window.setTimeout(() => {
          void processQueueRef.current();
        }, delayMs);
      }

      return { synced: succeeded.size, failed: failures.size };
    };

    const promise = run().finally(() => {
      processingRef.current = null;
    });
    processingRef.current = promise;
    return promise;
  }, [executePendingSyncOperation, user]);
  processQueueRef.current = processPendingSyncQueue;

  // Load data from Supabase
  useEffect(() => {
    const loadUnitsFallback = async (): Promise<Unit[]> => {
      const saved = await loadArrayFromDexie('units');
      return saved.length ? saved : SAMPLE_UNITS;
    };

    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Check if Supabase is configured
        if (!import.meta.env.VITE_SUPABASE_URL) {
          console.warn('Supabase not configured, using local storage fallback');
          await loadFromDexie();
          setLoading(false);
          return;
        }

        // Tables require a signed-in user; fetching earlier would return empty lists.
        if (!user) {
          setLoading(false);
          return;
        }

        // Push local changes first so the fetch below doesn't overwrite them with older server data.
        await processPendingSyncQueue();

        // Fetch Categories
        const { data: categoriesData, error: categoriesError } = await supabase
          .from('categories')
          .select('*');
        
        if (categoriesError) throw categoriesError;
        if (categoriesData) setCategories(categoriesData);

        // Fetch Units
        const { data: unitsData, error: unitsError } = await supabase
          .from('units')
          .select('*');

        if (unitsError) {
          console.warn('Units not available yet:', unitsError.message);
          setUnits(await loadUnitsFallback());
        } else if (unitsData && unitsData.length > 0) {
          setUnits(unitsData);
        } else {
          // If the table exists but is empty, fall back to locally stored/sample units
          setUnits(await loadUnitsFallback());
        }

        // Fetch Products
        const { data: productsData, error: productsError } = await supabase
          .from('products')
          .select('*');
        
        if (productsError) throw productsError;
        if (productsData) {
          setProducts(productsData.map((p: any) => ({
            id: p.id,
            sku: p.sku,
            name: p.name,
            description: p.description,
            categoryId: p.category_id,
            unitId: p.unit_id || 'unit-pcs',
            costPrice: p.cost_price,
            sellingPrice: p.selling_price,
            stockQuantity: p.stock_quantity,
            lowStockThreshold: p.low_stock_threshold,
            expiryDate: p.expiry_date,
            barcode: p.barcode,
            barcodeEnabled: p.barcode_enabled ?? false,
          })));
        }

        // Fetch Orders
        const { data: ordersData, error: ordersError } = await supabase
          .from('orders')
          .select('*')
          .order('created_at', { ascending: false });
        
        if (ordersError) throw ordersError;
        if (ordersData) {
          setOrders(ordersData.map((o: any) => ({
            id: o.id,
            createdAt: o.created_at,
            cashierId: o.cashier_id,
            cashierName: o.cashier_name,
            subtotal: o.subtotal,
            taxAmount: o.tax_amount,
            discountAmount: o.discount_amount,
            totalAmount: o.total_amount,
            paymentMethod: o.payment_method,
            status: o.status,
            amountTendered: o.amount_tendered,
            changeGiven: o.change_given,
            clientName: o.client_name,
            clientPhone: o.client_phone,
            transferType: o.transfer_type,
            transactionId: o.transaction_id,
            customerId: o.customer_id,
            cardFeeAmount: o.card_fee_amount,
            cardFeeRate: o.card_fee_rate,
          })));
        }

        // Fetch Order Items
        const { data: orderItemsData, error: orderItemsError } = await supabase
          .from('order_items')
          .select('*');
        
        if (orderItemsError) throw orderItemsError;
        if (orderItemsData) {
          setOrderItems(orderItemsData.map((i: any) => ({
            id: i.id,
            orderId: i.order_id,
            productId: i.product_id,
            productName: i.product_name,
            productSku: i.product_sku,
            quantity: i.quantity,
            unitPriceAtSale: i.unit_price_at_sale,
            discountAmount: i.discount_amount,
          })));
        }

        // Fetch Settings
        const { data: settingsData, error: settingsError } = await supabase
          .from('store_settings')
          .select('*')
          .single();
        
        if (!settingsError && settingsData) {
          setSettings({
            storeName: settingsData.store_name,
            address: settingsData.address,
            phone: settingsData.phone,
            taxRate: settingsData.tax_rate,
            cardFeePercent: settingsData.card_fee_percent ?? DEFAULT_SETTINGS.cardFeePercent,
            receiptFooterMessage: settingsData.receipt_footer_message,
            allowNegativeStock: settingsData.allow_negative_stock,
            logo: settingsData.logo,
          });
        } else {
          const localSettings = await loadSettingsFromDexie();
          if (localSettings) setSettings({ ...DEFAULT_SETTINGS, ...localSettings });
        }

        // Fetch Customers
        const { data: customersData, error: customersError } = await supabase
          .from('customers')
          .select('*')
          .order('created_at', { ascending: false });

        if (customersError) throw customersError;
        if (customersData) {
          setCustomers(customersData.map((c: any) => ({
            id: c.id,
            name: c.name,
            phone: c.phone,
            address: c.address,
            nic: c.nic,
            createdAt: c.created_at,
            totalCredit: c.total_credit,
            totalPaid: c.total_paid,
            balance: c.balance,
          })));
        }

        // Fetch Customer Transactions
        const { data: transactionsData, error: transactionsError } = await supabase
          .from('customer_transactions')
          .select('*')
          .order('created_at', { ascending: false });

        if (transactionsError) throw transactionsError;
        if (transactionsData) {
          setCustomerTransactions(transactionsData.map((t: any) => ({
            id: t.id,
            customerId: t.customer_id,
            orderId: t.order_id,
            type: t.type,
            amount: t.amount,
            paymentMethod: t.payment_method || undefined,
            cardFeeRate: t.card_fee_rate || undefined,
            cardFeeAmount: t.card_fee_amount || undefined,
            totalCharged: t.total_charged || undefined,
            description: t.description,
            createdAt: t.created_at,
          })));
        }

        // Fetch Customer Reminders
        const { data: remindersData, error: remindersError } = await supabase
          .from('customer_reminders')
          .select('*')
          .order('created_at', { ascending: false });

        if (remindersError) {
          console.warn('Customer reminders not available yet:', remindersError.message);
        } else if (remindersData) {
          setCustomerReminders(
            remindersData.map((r: any) => ({
              id: r.id,
              customerId: r.customer_id,
              frequency: r.frequency,
              nextReminderDate: r.next_reminder_date,
              isActive: r.is_active,
              note: r.note,
              createdAt: r.created_at,
              lastTriggeredAt: r.last_triggered_at,
            }))
          );
        }

        // Fetch Suppliers
        const { data: suppliersData, error: suppliersError } = await supabase
          .from('suppliers')
          .select('*')
          .order('created_at', { ascending: false });

        if (suppliersError) {
          console.warn('Suppliers not available yet:', suppliersError.message);
        } else if (suppliersData) {
          setSuppliers(
            suppliersData.map((s: any) => ({
              id: s.id,
              name: s.name,
              phone: s.phone,
              address: s.address,
              contactPerson: s.contact_person,
              notes: s.notes,
              createdAt: s.created_at,
              totalPurchased: s.total_purchased,
              totalPaid: s.total_paid,
              balance: s.balance,
            }))
          );
        }

        // Fetch Supplier Purchases
        const { data: purchasesData, error: purchasesError } = await supabase
          .from('supplier_purchases')
          .select('*')
          .order('created_at', { ascending: false });

        if (purchasesError) {
          console.warn('Supplier purchases not available yet:', purchasesError.message);
        } else if (purchasesData) {
          setSupplierPurchases(
            purchasesData.map((p: any) => ({
              id: p.id,
              supplierId: p.supplier_id,
              description: p.description,
              amount: p.amount,
              purchaseDate: p.purchase_date,
              invoiceNumber: p.invoice_number,
              createdAt: p.created_at,
            }))
          );
        }

        // Fetch Supplier Payment Schedules
        const { data: schedulesData, error: schedulesError } = await supabase
          .from('supplier_payment_schedules')
          .select('*')
          .order('created_at', { ascending: false });

        if (schedulesError) {
          console.warn('Supplier payment schedules not available yet:', schedulesError.message);
        } else if (schedulesData) {
          setSupplierPaymentSchedules(
            schedulesData.map((s: any) => ({
              id: s.id,
              supplierId: s.supplier_id,
              frequency: s.frequency,
              nextPaymentDate: s.next_payment_date,
              amount: s.amount,
              isActive: s.is_active,
              note: s.note,
              createdAt: s.created_at,
              lastPaidAt: s.last_paid_at,
            }))
          );
        }

        // These two are not stored in Supabase, so they always come from the local database.
        setHeldCarts(await loadArrayFromDexie('heldCarts'));
        setOrderEditLogs(await loadArrayFromDexie('orderEditLogs'));
        setIsHydrated(true);
      } catch (error) {
        const rawMessage =
          error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : JSON.stringify(error);
        const message = rawMessage.toLowerCase();
        const isNetworkFallback =
          message.includes('failed to fetch') ||
          message.includes('networkerror') ||
          message.includes('err_name_not_resolved') ||
          message.includes('name_not_resolved');

        if (isNetworkFallback) {
          console.warn('Supabase unreachable, using local storage fallback.');
          toast.warning('Cloud database unreachable. Using local data.');
        } else {
          console.error('Error fetching data from Supabase:', error);
          toast.error('Failed to load data from database');
        }
        await loadFromDexie();
      } finally {
        setLoading(false);
      }
    };

    const loadFromDexie = async () => {
      const dbProducts = await loadArrayFromDexie('products');
      setProducts(dbProducts.length ? dbProducts : SAMPLE_PRODUCTS);
      
      const dbUnits = await loadArrayFromDexie('units');
      setUnits(dbUnits.length ? dbUnits : SAMPLE_UNITS);
      
      const dbCategories = await loadArrayFromDexie('categories');
      setCategories(dbCategories.length ? dbCategories : SAMPLE_CATEGORIES);
      
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

  useEffect(() => {
    localStorage.setItem(PENDING_SYNC_STORAGE_KEY, JSON.stringify(pendingSyncOps));
  }, [pendingSyncOps]);

  useEffect(() => {
    const handleOnline = () => {
      void processPendingSyncQueue();
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [processPendingSyncQueue]);

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

  // Product functions
  const addProduct = async (product: Omit<Product, 'id'>) => {
    const newProduct = { ...product, id: generateId() };
    
    // Optimistic update
    setProducts((prev) => [...prev, newProduct]);

    if (import.meta.env.VITE_SUPABASE_URL) {
      const { error } = await supabase.from('products').insert({
        id: newProduct.id,
        sku: newProduct.sku,
        name: newProduct.name,
        description: newProduct.description,
        category_id: newProduct.categoryId,
        unit_id: newProduct.unitId,
        cost_price: newProduct.costPrice,
        selling_price: newProduct.sellingPrice,
        stock_quantity: newProduct.stockQuantity,
        low_stock_threshold: newProduct.lowStockThreshold,
        expiry_date: newProduct.expiryDate || null,
        barcode: newProduct.barcode || null,
        barcode_enabled: newProduct.barcodeEnabled || false,
      });

      if (error) {
        console.error('Error adding product:', error);
        const message = error.message || 'Failed to save product to database';
        enqueuePendingSync('product_add', { newProduct }, message);
      }
    } else {
      void saveArrayToDexie('products', [...products, newProduct]);
    }
  };

  const updateProduct = async (id: string, updates: Partial<Product>) => {
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
      if (updates.stockQuantity !== undefined) dbUpdates.stock_quantity = updates.stockQuantity;
      if (updates.lowStockThreshold !== undefined) dbUpdates.low_stock_threshold = updates.lowStockThreshold;
      if (updates.expiryDate !== undefined) dbUpdates.expiry_date = updates.expiryDate || null;
      if (updates.barcode !== undefined) dbUpdates.barcode = updates.barcode || null;
      if (updates.barcodeEnabled !== undefined) dbUpdates.barcode_enabled = updates.barcodeEnabled;

      // Avoid a DB call with an empty update payload (can cause a 400 in PostgREST).
      if (Object.keys(dbUpdates).length === 0) {
        return;
      }

      const { error } = await supabase
        .from('products')
        .update(dbUpdates)
        .eq('id', id);

      if (error) {
        console.error('Error updating product:', error);
        const message = (error.message || '').toLowerCase();
        const looksLikeSchemaIssue =
          message.includes('schema cache') ||
          message.includes('could not find the table') ||
          message.includes('column') ||
          message.includes('relation');

        if (looksLikeSchemaIssue) {
          toast.error('Database schema is missing tables/columns. Run SUPABASE_SETUP.sql, then refresh Supabase schema cache.');
        } else {
          enqueuePendingSync('product_update', { id, dbUpdates }, error.message || 'Failed to update product');
        }
      }
    } else {
      const updatedProducts = products.map((p) => (p.id === id ? { ...p, ...updates } : p));
      void saveArrayToDexie('products', updatedProducts);
    }
  };

  // Change stock by an amount (negative = sold) starting from the current value, not from a copy
  // of the product taken earlier (cart item, open dialog, ...).
  const adjustProductStock = (productId: string, delta: number) => {
    const current = productsRef.current.find((p) => p.id === productId);
    if (!current || delta === 0) return Promise.resolve();
    const stockQuantity = current.stockQuantity + delta;
    productsRef.current = productsRef.current.map((p) => (p.id === productId ? { ...p, stockQuantity } : p));
    return updateProduct(productId, { stockQuantity });
  };

  const deleteProducts = async (ids: string[]) => {
    // Optimistic update
    setProducts((prev) => prev.filter((p) => !ids.includes(p.id)));

    if (import.meta.env.VITE_SUPABASE_URL) {
      const { error } = await supabase
        .from('products')
        .delete()
        .in('id', ids);

      if (error) {
        console.error('Error deleting products:', error);
        enqueuePendingSync('product_delete', { ids }, error.message || 'Failed to delete products');
      }
    } else {
      const remainingProducts = products.filter((p) => !ids.includes(p.id));
      void saveArrayToDexie('products', remainingProducts);
    }
  };

  const getProductBySku = (sku: string) => {
    return products.find((p) => p.sku.toLowerCase() === sku.toLowerCase());
  };

  // Unit functions
  const addUnit = async (unit: Omit<Unit, 'id'>) => {
    const newUnit = { ...unit, id: generateId() };
    setUnits((prev) => [...prev, newUnit]);

    if (import.meta.env.VITE_SUPABASE_URL) {
      const { error } = await supabase.from('units').insert(newUnit);
      if (error) {
        console.error('Error adding unit:', error);
        const message = (error.message || '').toLowerCase();
        if (message.includes('schema cache') || message.includes('could not find the table') || message.includes('relation')) {
          toast.error('Units table not found in Supabase. Run SUPABASE_SETUP.sql (creates public.units). Saved locally for now.');
        } else {
          toast.error('Failed to save unit');
        }
      }
    } else {
      void saveArrayToDexie('units', [...units, newUnit]);
    }
  };

  const updateUnit = async (id: string, updates: Partial<Unit>) => {
    setUnits((prev) =>
      prev.map((u) => (u.id === id ? { ...u, ...updates } : u))
    );

    if (import.meta.env.VITE_SUPABASE_URL) {
      const { error } = await supabase.from('units').update(updates).eq('id', id);
      if (error) {
        console.error('Error updating unit:', error);
        const message = (error.message || '').toLowerCase();
        if (message.includes('schema cache') || message.includes('could not find the table') || message.includes('relation')) {
          toast.error('Units table not found in Supabase. Run SUPABASE_SETUP.sql (creates public.units). Saved locally for now.');
        } else {
          toast.error('Failed to update unit');
        }
      }
    } else {
      const updatedUnits = units.map((u) => (u.id === id ? { ...u, ...updates } : u));
      void saveArrayToDexie('units', updatedUnits);
    }
  };

  const deleteUnit = async (id: string) => {
    setUnits((prev) => prev.filter((u) => u.id !== id));

    if (import.meta.env.VITE_SUPABASE_URL) {
      const { error } = await supabase.from('units').delete().eq('id', id);
      if (error) {
        console.error('Error deleting unit:', error);
        toast.error('Failed to delete unit');
      }
    } else {
      const remainingUnits = units.filter((u) => u.id !== id);
      void saveArrayToDexie('units', remainingUnits);
    }
  };

  const getUnitById = (id: string) => {
    return units.find((u) => u.id === id);
  };

  // Category functions
  const addCategory = async (category: Omit<Category, 'id'>) => {
    const newCategory = { ...category, id: generateId() };
    setCategories((prev) => [...prev, newCategory]);

    if (import.meta.env.VITE_SUPABASE_URL) {
      const { error } = await supabase.from('categories').insert(newCategory);
      if (error) {
        console.error('Error adding category:', error);
        toast.error('Failed to save category');
      }
    } else {
      void saveArrayToDexie('categories', [...categories, newCategory]);
    }
  };

  const updateCategory = async (id: string, updates: Partial<Category>) => {
    setCategories((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...updates } : c))
    );

    if (import.meta.env.VITE_SUPABASE_URL) {
      const { error } = await supabase.from('categories').update(updates).eq('id', id);
      if (error) {
        console.error('Error updating category:', error);
        toast.error('Failed to update category');
      }
    } else {
      const updatedCategories = categories.map((c) => (c.id === id ? { ...c, ...updates } : c));
      void saveArrayToDexie('categories', updatedCategories);
    }
  };

  const deleteCategory = async (id: string) => {
    setCategories((prev) => prev.filter((c) => c.id !== id));

    if (import.meta.env.VITE_SUPABASE_URL) {
      const { error } = await supabase.from('categories').delete().eq('id', id);
      if (error) {
        console.error('Error deleting category:', error);
        toast.error('Failed to delete category');
      }
    } else {
      const remainingCategories = categories.filter((c) => c.id !== id);
      void saveArrayToDexie('categories', remainingCategories);
    }
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
    if (held) {
      setCart(held.items);
      setGlobalDiscountState(held.globalDiscount);
      setGlobalDiscountType(held.globalDiscountType);
      setHeldCarts((prev) => prev.filter((h) => h.id !== id));
    }
  };

  const deleteHeldCart = (id: string) => {
    setHeldCarts((prev) => prev.filter((h) => h.id !== id));
  };

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
      void adjustProductStock(item.product.id, -item.quantity);
    });

    // If credit sale with customer, add credit transaction (Digi Khata)
    if (paymentMethod === 'credit' && customerId) {
      await addCreditTransaction(customerId, order.id, totalAmount);
    }

    if (import.meta.env.VITE_SUPABASE_URL) {
      try {
        await executePendingSyncOperation({
          id: generateId(),
          type: 'order_with_items',
          payload: { order, orderItems: newOrderItems },
          createdAt: new Date().toISOString(),
          retryCount: 0,
        });
      } catch (error) {
        console.error('Error creating order:', error);
        const message = error instanceof Error ? error.message : 'Order write failed';
        enqueuePendingSync('order_with_items', { order, orderItems: newOrderItems }, message);
      }
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
      const dbUpdates: any = {};
      if (updates.paymentMethod !== undefined) dbUpdates.payment_method = updates.paymentMethod;
      if (updates.status !== undefined) dbUpdates.status = updates.status;
      if (updates.amountTendered !== undefined) dbUpdates.amount_tendered = updates.amountTendered;
      if (updates.changeGiven !== undefined) dbUpdates.change_given = updates.changeGiven;
      if (updates.clientName !== undefined) dbUpdates.client_name = updates.clientName;
      if (updates.clientPhone !== undefined) dbUpdates.client_phone = updates.clientPhone;
      if (updates.transferType !== undefined) dbUpdates.transfer_type = updates.transferType;
      if (updates.transactionId !== undefined) dbUpdates.transaction_id = updates.transactionId;
      if (updates.customerId !== undefined) dbUpdates.customer_id = updates.customerId;

      const { error } = await supabase.from('orders').update(dbUpdates).eq('id', id);
      if (error) {
        console.error('Error updating order:', error);
        toast.error('Failed to update bill in database');
      }
    } else {
      const updatedOrders = orders.map((o) => (o.id === id ? { ...o, ...updates } : o));
      void saveArrayToDexie('orders', updatedOrders);
    }
  };

  const cancelOrder = async (id: string) => {
    const order = orders.find((o) => o.id === id);
    if (!order || order.status === 'refunded') return;

    const relatedItems = getOrderItems(id);

    // Restore stock for all items in the cancelled order.
    for (const item of relatedItems) {
      await adjustProductStock(item.productId, item.quantity);
    }

    await updateOrder(id, { status: 'refunded' });

    if (order.paymentMethod === 'credit' && order.customerId) {
      const customer = customers.find((c) => c.id === order.customerId);
      if (!customer) return;

      const reversalAmount = order.totalAmount;
      const creditAfterReversal = Math.max(0, customer.totalCredit - reversalAmount);
      const updatedBalance = creditAfterReversal - customer.totalPaid;

      setCustomers((prev) =>
        prev.map((c) =>
          c.id === customer.id
            ? {
                ...c,
                totalCredit: creditAfterReversal,
                balance: updatedBalance,
              }
            : c
        )
      );

      const reversalTransaction: CustomerTransaction = {
        id: generateId(),
        customerId: customer.id,
        orderId: order.id,
        type: 'payment',
        amount: reversalAmount,
        description: `Credit reversal - Cancelled order #${order.id.slice(-8).toUpperCase()}`,
        createdAt: new Date().toISOString(),
      };
      setCustomerTransactions((prev) => [...prev, reversalTransaction]);

      if (import.meta.env.VITE_SUPABASE_URL) {
        const [transactionResult, customerResult] = await Promise.all([
          supabase.from('customer_transactions').insert({
            id: reversalTransaction.id,
            customer_id: reversalTransaction.customerId,
            order_id: reversalTransaction.orderId,
            type: reversalTransaction.type,
            amount: reversalTransaction.amount,
            description: reversalTransaction.description,
            created_at: reversalTransaction.createdAt,
          }),
          supabase
            .from('customers')
            .update({ total_credit: creditAfterReversal, balance: updatedBalance })
            .eq('id', customer.id),
        ]);

        if (transactionResult.error || customerResult.error) {
          console.error('Error reversing customer credit:', transactionResult.error || customerResult.error);
          toast.error('Bill cancelled, but failed to sync customer credit reversal');
        }
      }
    }
  };

  const updateOrderFull = async (
    id: string,
    newItems: Array<{
      productId: string;
      productName: string;
      productSku: string;
      quantity: number;
      unitPrice: number;
      discountAmount: number;
    }>,
    orderUpdates: Partial<Order>
  ) => {
    const existingOrder = orders.find((o) => o.id === id);
    if (!existingOrder) {
      toast.error('Order not found');
      return;
    }
    if (existingOrder.status === 'refunded') {
      toast.error('Cannot edit a cancelled/refunded bill');
      return;
    }

    const oldItems = orderItems.filter((item) => item.orderId === id);

    // --- Build audit log ---
    const changes: string[] = [];
    const oldItemMap = new Map(oldItems.map((i) => [i.productId, i]));
    const newItemMap = new Map(newItems.map((i) => [i.productId, i]));

    // Check removed items
    for (const oi of oldItems) {
      if (!newItemMap.has(oi.productId)) {
        changes.push(`Removed ${oi.productName} (×${oi.quantity})`);
      }
    }
    // Check added or changed items
    for (const ni of newItems) {
      const existing = oldItemMap.get(ni.productId);
      if (!existing) {
        changes.push(`Added ${ni.productName} (×${ni.quantity})`);
      } else {
        const diffs: string[] = [];
        if (existing.quantity !== ni.quantity) diffs.push(`qty: ${existing.quantity}→${ni.quantity}`);
        if (existing.unitPriceAtSale !== ni.unitPrice) diffs.push(`price: ${existing.unitPriceAtSale}→${ni.unitPrice}`);
        if (existing.discountAmount !== ni.discountAmount) diffs.push(`discount: ${existing.discountAmount}→${ni.discountAmount}`);
        if (diffs.length > 0) changes.push(`${ni.productName}: ${diffs.join(', ')}`);
      }
    }
    // Check order-level field changes
    if (orderUpdates.clientName !== undefined && orderUpdates.clientName !== existingOrder.clientName) {
      changes.push(`Client name: "${existingOrder.clientName || ''}" → "${orderUpdates.clientName}"`);
    }
    if (orderUpdates.clientPhone !== undefined && orderUpdates.clientPhone !== existingOrder.clientPhone) {
      changes.push(`Client phone: "${existingOrder.clientPhone || ''}" → "${orderUpdates.clientPhone}"`);
    }
    if (orderUpdates.paymentMethod !== undefined && orderUpdates.paymentMethod !== existingOrder.paymentMethod) {
      changes.push(`Payment: ${existingOrder.paymentMethod} → ${orderUpdates.paymentMethod}`);
    }

    const editLog: OrderEditLog = {
      id: generateId(),
      orderId: id,
      editedBy: user?.fullName || user?.email || 'Unknown',
      editedAt: new Date().toISOString(),
      changesSummary: changes.length > 0 ? changes.join('; ') : 'No changes detected',
      previousOrder: {
        subtotal: existingOrder.subtotal,
        taxAmount: existingOrder.taxAmount,
        discountAmount: existingOrder.discountAmount,
        totalAmount: existingOrder.totalAmount,
        paymentMethod: existingOrder.paymentMethod,
        clientName: existingOrder.clientName,
        clientPhone: existingOrder.clientPhone,
      },
      previousItems: [...oldItems],
    };

    // --- Stock: apply only the difference between the old and the new quantities ---
    const stockDeltas = new Map<string, number>();
    for (const oi of oldItems) {
      stockDeltas.set(oi.productId, (stockDeltas.get(oi.productId) || 0) + oi.quantity);
    }
    for (const ni of newItems) {
      stockDeltas.set(ni.productId, (stockDeltas.get(ni.productId) || 0) - ni.quantity);
    }

    if (!settings.allowNegativeStock) {
      for (const [productId, delta] of stockDeltas) {
        const product = productsRef.current.find((p) => p.id === productId);
        if (product && delta < 0 && product.stockQuantity + delta < 0) {
          toast.error(`Insufficient stock for ${product.name}`);
          return;
        }
      }
    }

    for (const [productId, delta] of stockDeltas) {
      if (delta !== 0) await adjustProductStock(productId, delta);
    }

    // --- Recalculate totals (keeps the bill's cart-wide discount and the tax rate it was sold with) ---
    const paymentMethod = orderUpdates.paymentMethod || existingOrder.paymentMethod;
    const { subtotal, taxAmount, cardFeeRate, cardFeeAmount, totalAmount, totalDiscount } = computeEditedOrderTotals({
      existingOrder,
      oldItems,
      newItems,
      paymentMethod,
      fallbackTaxRate: settings.taxRate,
      fallbackCardFeePercent: settings.cardFeePercent || 0,
    });

    // --- LEDGER SYNCHRONIZATION (High Reliability) ---
    const finalPaymentMethod = orderUpdates.paymentMethod || existingOrder.paymentMethod;
    const finalCustomerId = orderUpdates.customerId || existingOrder.customerId;
    
    const ledgerFieldsChanged = 
        Number(existingOrder.totalAmount.toFixed(2)) !== totalAmount || 
        existingOrder.paymentMethod !== finalPaymentMethod || 
        existingOrder.customerId !== finalCustomerId;

    if (ledgerFieldsChanged) {
        // Step 1: Reverse old debt if it existed
        if (existingOrder.paymentMethod === 'credit' && existingOrder.customerId) {
            const oldCustomer = customers.find((c) => c.id === existingOrder.customerId);
            if (oldCustomer) {
                const reversalAmount = Number(existingOrder.totalAmount.toFixed(2));
                const newTotalCredit = Number((oldCustomer.totalCredit - reversalAmount).toFixed(2));
                const newBalance = Number((newTotalCredit - oldCustomer.totalPaid).toFixed(2));

                // Update Local State
                setCustomers((prev) =>
                    prev.map((c) =>
                        c.id === oldCustomer.id
                            ? { ...c, totalCredit: newTotalCredit, balance: newBalance }
                            : c
                    )
                );

                const reversalTransaction: CustomerTransaction = {
                    id: generateId(),
                    customerId: oldCustomer.id,
                    orderId: id,
                    type: 'payment',
                    amount: reversalAmount,
                    description: `Credit reversal - Edited order #${id.slice(-8).toUpperCase()}`,
                    createdAt: new Date().toISOString(),
                };
                setCustomerTransactions((prev) => [...prev, reversalTransaction]);

                // Update Database Reliable (Await)
                if (import.meta.env.VITE_SUPABASE_URL) {
                    try {
                        const [txRes, custRes] = await Promise.all([
                            supabase.from('customer_transactions').insert({
                                id: reversalTransaction.id,
                                customer_id: reversalTransaction.customerId,
                                order_id: reversalTransaction.orderId,
                                type: reversalTransaction.type,
                                amount: reversalTransaction.amount,
                                description: reversalTransaction.description,
                                created_at: reversalTransaction.createdAt,
                            }),
                            supabase.from('customers').update({ 
                                total_credit: newTotalCredit, 
                                balance: newBalance 
                            }).eq('id', oldCustomer.id),
                        ]);
                        if (txRes.error || custRes.error) throw txRes.error || custRes.error;
                    } catch (err) {
                        console.error('Error reversing debt:', err);
                        toast.error('Ledger reversal failed in database');
                    }
                }
            }
        }

        // Step 2: Apply new debt if applicable
        if (finalPaymentMethod === 'credit' && finalCustomerId) {
            const baseCustomer = customers.find(c => c.id === finalCustomerId);
            if (baseCustomer) {
                let customerTotalCredit = baseCustomer.totalCredit;
                if (existingOrder.customerId === finalCustomerId && existingOrder.paymentMethod === 'credit') {
                    customerTotalCredit -= Number(existingOrder.totalAmount.toFixed(2));
                }
                
                const newTotalCredit = Number((customerTotalCredit + totalAmount).toFixed(2));
                const newBalance = Number((newTotalCredit - baseCustomer.totalPaid).toFixed(2));
                
                // Update Local State
                setCustomers((prev) =>
                    prev.map((c) =>
                        c.id === finalCustomerId
                            ? { ...c, totalCredit: newTotalCredit, balance: newBalance }
                            : c
                    )
                );

                const creditTransaction: CustomerTransaction = {
                    id: generateId(),
                    customerId: finalCustomerId,
                    orderId: id,
                    type: 'credit',
                    amount: totalAmount,
                    description: `Credit sale - Edited order #${id.slice(-8).toUpperCase()}`,
                    createdAt: new Date().toISOString(),
                };
                setCustomerTransactions((prev) => [...prev, creditTransaction]);

                // Update Database Reliable (Await)
                if (import.meta.env.VITE_SUPABASE_URL) {
                    try {
                        const [txRes, custRes] = await Promise.all([
                            supabase.from('customer_transactions').insert({
                                id: creditTransaction.id,
                                customer_id: creditTransaction.customerId,
                                order_id: creditTransaction.orderId,
                                type: creditTransaction.type,
                                amount: creditTransaction.amount,
                                description: creditTransaction.description,
                                created_at: creditTransaction.createdAt,
                            }),
                            supabase.from('customers').update({ 
                                total_credit: newTotalCredit, 
                                balance: newBalance 
                            }).eq('id', finalCustomerId),
                        ]);
                        if (txRes.error || custRes.error) throw txRes.error || custRes.error;
                    } catch (err) {
                        console.error('Error applying new debt:', err);
                        toast.error('Ledger application failed in database');
                    }
                }
            }
        }
    }

    // --- Build new OrderItem[] ---
    const newOrderItems: OrderItem[] = newItems.map((item) => ({
      id: generateId(),
      orderId: id,
      productId: item.productId,
      productName: item.productName,
      productSku: item.productSku,
      quantity: item.quantity,
      unitPriceAtSale: item.unitPrice,
      discountAmount: item.discountAmount,
    }));

    // --- Update state ---
    setOrderItems((prev) => [
      ...prev.filter((item) => item.orderId !== id),
      ...newOrderItems,
    ]);

    const orderUpdate: Partial<Order> = {
      ...orderUpdates,
      subtotal,
      taxAmount,
      discountAmount: totalDiscount,
      totalAmount,
      cardFeeAmount: cardFeeAmount || undefined,
      cardFeeRate: cardFeeRate || undefined,
      // Changing to/from credit changes whether the bill counts as pending.
      status: finalPaymentMethod === 'credit' ? 'credit' : 'completed',
    };

    setOrders((prev) =>
      prev.map((o) => (o.id === id ? { ...o, ...orderUpdate } : o))
    );

    // Persist edit log
    const updatedLogs = [...orderEditLogs, editLog];
    setOrderEditLogs(updatedLogs);

    // --- Persist to storage ---
    if (import.meta.env.VITE_SUPABASE_URL) {
      // Delete old order items and insert new ones
      try {
        // Insert the new lines first and remove the old ones afterwards, so a failure never leaves the bill empty.
        const insertResult = await supabase.from('order_items').insert(
          newOrderItems.map((item) => ({
            id: item.id,
            order_id: item.orderId,
            product_id: item.productId,
            product_name: item.productName,
            product_sku: item.productSku,
            quantity: item.quantity,
            unit_price_at_sale: item.unitPriceAtSale,
            discount_amount: item.discountAmount,
          }))
        );
        if (insertResult.error) throw insertResult.error;
        const oldItemIds = oldItems.map((item) => item.id);
        if (oldItemIds.length > 0) {
          const deleteResult = await supabase.from('order_items').delete().in('id', oldItemIds);
          if (deleteResult.error) throw deleteResult.error;
        }

        const dbUpdates: any = {};
        if (orderUpdate.subtotal !== undefined) dbUpdates.subtotal = orderUpdate.subtotal;
        if (orderUpdate.taxAmount !== undefined) dbUpdates.tax_amount = orderUpdate.taxAmount;
        if (orderUpdate.discountAmount !== undefined) dbUpdates.discount_amount = orderUpdate.discountAmount;
        if (orderUpdate.totalAmount !== undefined) dbUpdates.total_amount = orderUpdate.totalAmount;
        if (orderUpdate.paymentMethod !== undefined) dbUpdates.payment_method = orderUpdate.paymentMethod;
        if (orderUpdate.clientName !== undefined) dbUpdates.client_name = orderUpdate.clientName;
        if (orderUpdate.clientPhone !== undefined) dbUpdates.client_phone = orderUpdate.clientPhone;
        // Written explicitly (0 when not a card sale) so a stale card fee never stays in the database.
        dbUpdates.card_fee_amount = cardFeeAmount;
        dbUpdates.card_fee_rate = cardFeeRate;
        dbUpdates.status = orderUpdate.status;
        if (orderUpdate.customerId !== undefined) dbUpdates.customer_id = orderUpdate.customerId;

        const orderResult = await supabase.from('orders').update(dbUpdates).eq('id', id);
        if (orderResult.error) throw orderResult.error;
      } catch (error) {
        console.error('Error updating order in database:', error);
        toast.error('Failed to sync edited bill to database');
      }
    } else {
      const allOrders = orders.map((o) => (o.id === id ? { ...o, ...orderUpdate } : o));
      void saveArrayToDexie('orders', allOrders);
      const allItems = orderItems.filter((item) => item.orderId !== id).concat(newOrderItems);
      void saveArrayToDexie('orderItems', allItems);
      void saveArrayToDexie('orderEditLogs', updatedLogs);
    }

    toast.success('Bill updated successfully');
  };

  const getOrderEditLogs = (orderId: string): OrderEditLog[] => {
    return orderEditLogs.filter((log) => log.orderId === orderId);
  };

  const updateSettings = async (updates: Partial<StoreSettings>) => {
    setSettings((prev) => ({ ...prev, ...updates }));

    if (import.meta.env.VITE_SUPABASE_URL) {
      const dbUpdates: any = {};
      if (updates.storeName) dbUpdates.store_name = updates.storeName;
      if (updates.address) dbUpdates.address = updates.address;
      if (updates.phone) dbUpdates.phone = updates.phone;
      if (updates.taxRate !== undefined) dbUpdates.tax_rate = updates.taxRate;
      if (updates.cardFeePercent !== undefined) dbUpdates.card_fee_percent = updates.cardFeePercent;
      if (updates.receiptFooterMessage) dbUpdates.receipt_footer_message = updates.receiptFooterMessage;
      if (updates.allowNegativeStock !== undefined) dbUpdates.allow_negative_stock = updates.allowNegativeStock;
      if (updates.logo) dbUpdates.logo = updates.logo;

      // Upsert settings (assuming ID 1 for single row settings)
      const { error } = await supabase
        .from('store_settings')
        .upsert({ id: 1, ...dbUpdates });

      if (error) {
        console.error('Error updating settings:', error);
        toast.error('Failed to save settings');
      }
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
    setCustomers((prev) => [...prev, newCustomer]);

    if (import.meta.env.VITE_SUPABASE_URL) {
      void supabase.from('customers').insert({
        id: newCustomer.id,
        name: newCustomer.name,
        phone: newCustomer.phone,
        address: newCustomer.address,
        nic: newCustomer.nic,
        created_at: newCustomer.createdAt,
        total_credit: newCustomer.totalCredit,
        total_paid: newCustomer.totalPaid,
        balance: newCustomer.balance,
      }).then(({ error }) => {
        if (error) {
          console.error('Error adding customer:', error);
          enqueuePendingSync('customer_add', { customer: newCustomer }, error.message);
        }
      });
    }
  };

  const updateCustomer = (id: string, updates: Partial<Customer>) => {
    setCustomers((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...updates } : c))
    );

    if (import.meta.env.VITE_SUPABASE_URL) {
      const dbUpdates: any = {};
      if (updates.name !== undefined) dbUpdates.name = updates.name;
      if (updates.phone !== undefined) dbUpdates.phone = updates.phone;
      if (updates.address !== undefined) dbUpdates.address = updates.address;
      if (updates.nic !== undefined) dbUpdates.nic = updates.nic;
      if (updates.totalCredit !== undefined) dbUpdates.total_credit = updates.totalCredit;
      if (updates.totalPaid !== undefined) dbUpdates.total_paid = updates.totalPaid;
      if (updates.balance !== undefined) dbUpdates.balance = updates.balance;

      void supabase
        .from('customers')
        .update(dbUpdates)
        .eq('id', id)
        .then(({ error }) => {
          if (error) {
            console.error('Error updating customer:', error);
            enqueuePendingSync('customer_update', { id, dbUpdates }, error.message);
          }
        });
    }
  };

  const deleteCustomer = (id: string) => {
    setCustomers((prev) => prev.filter((c) => c.id !== id));
    // Also delete related transactions
    setCustomerTransactions((prev) => prev.filter((t) => t.customerId !== id));

    if (import.meta.env.VITE_SUPABASE_URL) {
      void supabase
        .from('customers')
        .delete()
        .eq('id', id)
        .then(({ error }) => {
          if (error) {
            console.error('Error deleting customer:', error);
            enqueuePendingSync('customer_delete', { id }, error.message);
          }
        });
    }
  };

  const getCustomerById = (id: string) => {
    return customers.find((c) => c.id === id);
  };

  const addCustomerPayment = (customerId: string, amount: number, description: string, paymentMethod: 'cash' | 'card') => {
    const createdAt = new Date().toISOString();
    const cardFeeRate = paymentMethod === 'card' ? settings.cardFeePercent : 0;
    const cardFeeAmount = paymentMethod === 'card' ? (amount * cardFeeRate) / 100 : 0;
    const totalCharged = amount + cardFeeAmount;
    const transaction: CustomerTransaction = {
      id: generateId(),
      customerId,
      type: 'payment',
      amount,
      paymentMethod,
      cardFeeRate: cardFeeRate || undefined,
      cardFeeAmount: cardFeeAmount || undefined,
      totalCharged,
      description,
      createdAt,
    };
    setCustomerTransactions((prev) => [...prev, transaction]);
    
    // Update customer balance
    setCustomers((prev) =>
      prev.map((c) => {
        if (c.id === customerId) {
          const newTotalPaid = c.totalPaid + amount;
          return {
            ...c,
            totalPaid: newTotalPaid,
            balance: c.totalCredit - newTotalPaid,
          };
        }
        return c;
      })
    );

    if (import.meta.env.VITE_SUPABASE_URL) {
      const customer = customers.find((c) => c.id === customerId);
      if (customer) {
        const newTotalPaid = customer.totalPaid + amount;
        const newBalance = customer.totalCredit - newTotalPaid;

        void Promise.all([
          supabase.from('customer_transactions').insert({
            id: transaction.id,
            customer_id: transaction.customerId,
            order_id: transaction.orderId,
            type: transaction.type,
            amount: transaction.amount,
            payment_method: transaction.paymentMethod,
            card_fee_rate: transaction.cardFeeRate,
            card_fee_amount: transaction.cardFeeAmount,
            total_charged: transaction.totalCharged,
            description: transaction.description,
            created_at: createdAt,
          }),
          supabase
            .from('customers')
            .update({ total_paid: newTotalPaid, balance: newBalance })
            .eq('id', customerId),
        ]).then(([transactionResult, customerResult]) => {
          if (transactionResult.error || customerResult.error) {
            console.error('Error adding customer payment:', transactionResult.error || customerResult.error);
            const errorMessage = (transactionResult.error || customerResult.error)?.message;
            enqueuePendingSync(
              'customer_payment',
              {
                transaction,
                customerId,
                newTotalPaid,
                newBalance,
              },
              errorMessage
            );
          }
        });
      }
    }
  };

  const updateCustomerTransaction = (id: string, updates: { amount?: number; description?: string }) => {
    const oldTransaction = customerTransactions.find((t) => t.id === id);
    if (!oldTransaction) return;

    const oldAmount = oldTransaction.amount;
    const newAmount = updates.amount !== undefined ? updates.amount : oldAmount;
    const amountDiff = newAmount - oldAmount;

    // Update the transaction
    setCustomerTransactions((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );

    // Recalculate customer totals if amount changed
    if (amountDiff !== 0) {
      setCustomers((prev) =>
        prev.map((c) => {
          if (c.id !== oldTransaction.customerId) return c;
          if (oldTransaction.type === 'payment') {
            const newTotalPaid = c.totalPaid + amountDiff;
            return { ...c, totalPaid: newTotalPaid, balance: c.totalCredit - newTotalPaid };
          } else {
            const newTotalCredit = c.totalCredit + amountDiff;
            return { ...c, totalCredit: newTotalCredit, balance: newTotalCredit - c.totalPaid };
          }
        })
      );
    }

    if (import.meta.env.VITE_SUPABASE_URL) {
      const dbUpdates: any = {};
      if (updates.amount !== undefined) dbUpdates.amount = updates.amount;
      if (updates.description !== undefined) dbUpdates.description = updates.description;

      let customerUpdates: Record<string, unknown> | undefined;
      const ops: Array<PromiseLike<{ error: any }>> = [
        supabase.from('customer_transactions').update(dbUpdates).eq('id', id),
      ];

      if (amountDiff !== 0) {
        const customer = customers.find((c) => c.id === oldTransaction.customerId);
        if (customer) {
          if (oldTransaction.type === 'payment') {
            const newTotalPaid = customer.totalPaid + amountDiff;
            const newBalance = customer.totalCredit - newTotalPaid;
            customerUpdates = { total_paid: newTotalPaid, balance: newBalance };
            ops.push(supabase.from('customers').update(customerUpdates).eq('id', oldTransaction.customerId));
          } else {
            const newTotalCredit = customer.totalCredit + amountDiff;
            const newBalance = newTotalCredit - customer.totalPaid;
            customerUpdates = { total_credit: newTotalCredit, balance: newBalance };
            ops.push(supabase.from('customers').update(customerUpdates).eq('id', oldTransaction.customerId));
          }
        }
      }

      void Promise.all(ops).then((results) => {
        const firstError = results.find((r) => r.error)?.error;
        if (firstError) {
          enqueuePendingSync('customer_transaction_update', { id, dbUpdates, customerId: oldTransaction.customerId, customerUpdates }, firstError.message);
        }
      });
    }
  };

  const deleteCustomerTransaction = (id: string) => {
    const transaction = customerTransactions.find((t) => t.id === id);
    if (!transaction) return;

    setCustomerTransactions((prev) => prev.filter((t) => t.id !== id));

    // Reverse the amount from customer totals
    setCustomers((prev) =>
      prev.map((c) => {
        if (c.id !== transaction.customerId) return c;
        if (transaction.type === 'payment') {
          const newTotalPaid = c.totalPaid - transaction.amount;
          return { ...c, totalPaid: newTotalPaid, balance: c.totalCredit - newTotalPaid };
        } else {
          const newTotalCredit = c.totalCredit - transaction.amount;
          return { ...c, totalCredit: newTotalCredit, balance: newTotalCredit - c.totalPaid };
        }
      })
    );

    if (import.meta.env.VITE_SUPABASE_URL) {
      const customer = customers.find((c) => c.id === transaction.customerId);
      let customerUpdates: Record<string, unknown> | undefined;
      const ops: Array<PromiseLike<{ error: any }>> = [
        supabase.from('customer_transactions').delete().eq('id', id),
      ];

      if (customer) {
        if (transaction.type === 'payment') {
          const newTotalPaid = customer.totalPaid - transaction.amount;
          const newBalance = customer.totalCredit - newTotalPaid;
          customerUpdates = { total_paid: newTotalPaid, balance: newBalance };
          ops.push(supabase.from('customers').update(customerUpdates).eq('id', transaction.customerId));
        } else {
          const newTotalCredit = customer.totalCredit - transaction.amount;
          const newBalance = newTotalCredit - customer.totalPaid;
          customerUpdates = { total_credit: newTotalCredit, balance: newBalance };
          ops.push(supabase.from('customers').update(customerUpdates).eq('id', transaction.customerId));
        }
      }

      void Promise.all(ops).then((results) => {
        const firstError = results.find((r) => r.error)?.error;
        if (firstError) {
          enqueuePendingSync('customer_transaction_delete', { id, customerId: transaction.customerId, customerUpdates }, firstError.message);
        }
      });
    }
  };

  const getCustomerTransactions = (customerId: string) => {
    return customerTransactions.filter((t) => t.customerId === customerId);
  };

  const addCustomerReminder = (
    customerId: string,
    frequency: ReminderFrequency,
    nextReminderDate: string,
    note?: string
  ) => {
    const reminder: CustomerReminder = {
      id: generateId(),
      customerId,
      frequency,
      nextReminderDate,
      isActive: true,
      note,
      createdAt: new Date().toISOString(),
    };

    setCustomerReminders((prev) => [reminder, ...prev]);

    if (import.meta.env.VITE_SUPABASE_URL) {
      void supabase
        .from('customer_reminders')
        .insert({
          id: reminder.id,
          customer_id: reminder.customerId,
          frequency: reminder.frequency,
          next_reminder_date: reminder.nextReminderDate,
          is_active: reminder.isActive,
          note: reminder.note,
          created_at: reminder.createdAt,
          last_triggered_at: reminder.lastTriggeredAt,
        })
        .then(({ error }) => {
          if (error) {
            enqueuePendingSync('customer_reminder_add', { reminder }, error.message);
          }
        });
    }
  };

  const updateCustomerReminder = (id: string, updates: Partial<CustomerReminder>) => {
    setCustomerReminders((prev) =>
      prev.map((reminder) => (reminder.id === id ? { ...reminder, ...updates } : reminder))
    );

    if (import.meta.env.VITE_SUPABASE_URL) {
      const dbUpdates: any = {};
      if (updates.frequency !== undefined) dbUpdates.frequency = updates.frequency;
      if (updates.nextReminderDate !== undefined) dbUpdates.next_reminder_date = updates.nextReminderDate;
      if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;
      if (updates.note !== undefined) dbUpdates.note = updates.note;
      if (updates.lastTriggeredAt !== undefined) dbUpdates.last_triggered_at = updates.lastTriggeredAt;

      void supabase
        .from('customer_reminders')
        .update(dbUpdates)
        .eq('id', id)
        .then(({ error }) => {
          if (error) {
            enqueuePendingSync('customer_reminder_update', { id, dbUpdates }, error.message);
          }
        });
    }
  };

  const deleteCustomerReminder = (id: string) => {
    setCustomerReminders((prev) => prev.filter((reminder) => reminder.id !== id));

    if (import.meta.env.VITE_SUPABASE_URL) {
      void supabase
        .from('customer_reminders')
        .delete()
        .eq('id', id)
        .then(({ error }) => {
          if (error) {
            enqueuePendingSync('customer_reminder_delete', { id }, error.message);
          }
        });
    }
  };

  const getCustomerReminders = (customerId: string) => {
    return customerReminders.filter((reminder) => reminder.customerId === customerId);
  };

  const getDueCustomerReminders = () => {
    const today = new Date().toISOString().slice(0, 10);
    return customerReminders.filter((reminder) => reminder.isActive && reminder.nextReminderDate <= today);
  };

  const markReminderTriggered = (id: string) => {
    const reminder = customerReminders.find((r) => r.id === id);
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

    setSuppliers((prev) => [newSupplier, ...prev]);

    if (import.meta.env.VITE_SUPABASE_URL) {
      void supabase
        .from('suppliers')
        .insert({
          id: newSupplier.id,
          name: newSupplier.name,
          phone: newSupplier.phone,
          address: newSupplier.address,
          contact_person: newSupplier.contactPerson,
          notes: newSupplier.notes,
          created_at: newSupplier.createdAt,
          total_purchased: newSupplier.totalPurchased,
          total_paid: newSupplier.totalPaid,
          balance: newSupplier.balance,
        })
        .then(({ error }) => {
          if (error) {
            enqueuePendingSync('supplier_add', { supplier: newSupplier }, error.message);
          }
        });
    }
  };

  const updateSupplier = (id: string, updates: Partial<Supplier>) => {
    setSuppliers((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));

    if (import.meta.env.VITE_SUPABASE_URL) {
      const dbUpdates: any = {};
      if (updates.name !== undefined) dbUpdates.name = updates.name;
      if (updates.phone !== undefined) dbUpdates.phone = updates.phone;
      if (updates.address !== undefined) dbUpdates.address = updates.address;
      if (updates.contactPerson !== undefined) dbUpdates.contact_person = updates.contactPerson;
      if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
      if (updates.totalPurchased !== undefined) dbUpdates.total_purchased = updates.totalPurchased;
      if (updates.totalPaid !== undefined) dbUpdates.total_paid = updates.totalPaid;
      if (updates.balance !== undefined) dbUpdates.balance = updates.balance;

      void supabase
        .from('suppliers')
        .update(dbUpdates)
        .eq('id', id)
        .then(({ error }) => {
          if (error) {
            enqueuePendingSync('supplier_update', { id, dbUpdates }, error.message);
          }
        });
    }
  };

  const deleteSupplier = (id: string) => {
    setSuppliers((prev) => prev.filter((s) => s.id !== id));
    setSupplierPurchases((prev) => prev.filter((p) => p.supplierId !== id));
    setSupplierPaymentSchedules((prev) => prev.filter((s) => s.supplierId !== id));

    if (import.meta.env.VITE_SUPABASE_URL) {
      void supabase
        .from('suppliers')
        .delete()
        .eq('id', id)
        .then(({ error }) => {
          if (error) {
            enqueuePendingSync('supplier_delete', { id }, error.message);
          }
        });
    }
  };

  const getSupplierById = (id: string) => suppliers.find((s) => s.id === id);

  const addSupplierPurchase = (purchase: Omit<SupplierPurchase, 'id' | 'createdAt'>) => {
    const newPurchase: SupplierPurchase = {
      ...purchase,
      id: generateId(),
      createdAt: new Date().toISOString(),
    };

    setSupplierPurchases((prev) => [newPurchase, ...prev]);
    setSuppliers((prev) =>
      prev.map((s) => {
        if (s.id !== purchase.supplierId) return s;
        const newTotalPurchased = s.totalPurchased + purchase.amount;
        return {
          ...s,
          totalPurchased: newTotalPurchased,
          balance: newTotalPurchased - s.totalPaid,
        };
      })
    );

    if (import.meta.env.VITE_SUPABASE_URL) {
      const supplier = suppliers.find((s) => s.id === purchase.supplierId);
      if (!supplier) return;
      const newTotalPurchased = supplier.totalPurchased + purchase.amount;
      const newBalance = newTotalPurchased - supplier.totalPaid;

      void Promise.all([
        supabase.from('supplier_purchases').insert({
          id: newPurchase.id,
          supplier_id: newPurchase.supplierId,
          description: newPurchase.description,
          amount: newPurchase.amount,
          purchase_date: newPurchase.purchaseDate,
          invoice_number: newPurchase.invoiceNumber,
          created_at: newPurchase.createdAt,
        }),
        supabase
          .from('suppliers')
          .update({ total_purchased: newTotalPurchased, balance: newBalance })
          .eq('id', newPurchase.supplierId),
      ]).then(([purchaseResult, supplierResult]) => {
        if (purchaseResult.error || supplierResult.error) {
          const err = purchaseResult.error || supplierResult.error;
          enqueuePendingSync(
            'supplier_purchase_add',
            {
              purchase: newPurchase,
              supplierId: newPurchase.supplierId,
              newTotalPurchased,
              newBalance,
            },
            err?.message
          );
        }
      });
    }
  };

  const updateSupplierPurchase = (id: string, updates: { amount?: number; description?: string }) => {
    const oldPurchase = supplierPurchases.find((p) => p.id === id);
    if (!oldPurchase) return;

    const oldAmount = oldPurchase.amount;
    const newAmount = updates.amount !== undefined ? updates.amount : oldAmount;
    const amountDiff = newAmount - oldAmount;

    setSupplierPurchases((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updates } : p))
    );

    if (amountDiff !== 0) {
      setSuppliers((prev) =>
        prev.map((s) => {
          if (s.id !== oldPurchase.supplierId) return s;
          
          let newTotalPurchased = s.totalPurchased;
          let newTotalPaid = s.totalPaid;

          if (oldPurchase.amount < 0 && newAmount < 0) {
            newTotalPaid = s.totalPaid - amountDiff; 
          } else if (oldPurchase.amount >= 0 && newAmount >= 0) {
            newTotalPurchased = s.totalPurchased + amountDiff;
          } else {
            if (oldPurchase.amount < 0) {
              newTotalPaid = s.totalPaid + oldPurchase.amount; 
            } else {
              newTotalPurchased = s.totalPurchased - oldPurchase.amount; 
            }
            if (newAmount < 0) {
              newTotalPaid = newTotalPaid - newAmount; 
            } else {
              newTotalPurchased = newTotalPurchased + newAmount; 
            }
          }

          return {
            ...s,
            totalPurchased: newTotalPurchased,
            totalPaid: newTotalPaid,
            balance: newTotalPurchased - newTotalPaid,
          };
        })
      );
    }

    if (import.meta.env.VITE_SUPABASE_URL) {
      const dbUpdates: any = {};
      if (updates.amount !== undefined) dbUpdates.amount = updates.amount;
      if (updates.description !== undefined) dbUpdates.description = updates.description;

      let supplierUpdates: Record<string, unknown> | undefined;
      const ops: Array<PromiseLike<{ error: any }>> = [
        supabase.from('supplier_purchases').update(dbUpdates).eq('id', id),
      ];

      if (amountDiff !== 0) {
        const supplier = suppliers.find((s) => s.id === oldPurchase.supplierId);
        if (supplier) {
          let newTotalPurchased = supplier.totalPurchased;
          let newTotalPaid = supplier.totalPaid;

          if (oldPurchase.amount < 0 && newAmount < 0) {
            newTotalPaid = supplier.totalPaid - amountDiff; 
          } else if (oldPurchase.amount >= 0 && newAmount >= 0) {
            newTotalPurchased = supplier.totalPurchased + amountDiff;
          } else {
            if (oldPurchase.amount < 0) {
              newTotalPaid = supplier.totalPaid + oldPurchase.amount; 
            } else {
              newTotalPurchased = supplier.totalPurchased - oldPurchase.amount; 
            }
            if (newAmount < 0) {
              newTotalPaid = newTotalPaid - newAmount; 
            } else {
              newTotalPurchased = newTotalPurchased + newAmount; 
            }
          }

          const newBalance = newTotalPurchased - newTotalPaid;
          supplierUpdates = { total_purchased: newTotalPurchased, total_paid: newTotalPaid, balance: newBalance };
          ops.push(supabase.from('suppliers').update(supplierUpdates).eq('id', oldPurchase.supplierId));
        }
      }

      void Promise.all(ops).then((results) => {
        const firstError = results.find((r) => r.error)?.error;
        if (firstError) {
          enqueuePendingSync('supplier_purchase_update', { id, dbUpdates, supplierId: oldPurchase.supplierId, supplierUpdates }, firstError.message);
        }
      });
    }
  };

  const deleteSupplierPurchase = (id: string) => {
    const purchase = supplierPurchases.find((p) => p.id === id);
    if (!purchase) return;

    setSupplierPurchases((prev) => prev.filter((p) => p.id !== id));

    setSuppliers((prev) =>
      prev.map((s) => {
        if (s.id !== purchase.supplierId) return s;

        let newTotalPurchased = s.totalPurchased;
        let newTotalPaid = s.totalPaid;

        if (purchase.amount < 0) {
          newTotalPaid = s.totalPaid + purchase.amount; 
        } else {
          newTotalPurchased = s.totalPurchased - purchase.amount;
        }

        return {
          ...s,
          totalPurchased: newTotalPurchased,
          totalPaid: newTotalPaid,
          balance: newTotalPurchased - newTotalPaid,
        };
      })
    );

    if (import.meta.env.VITE_SUPABASE_URL) {
      const supplier = suppliers.find((s) => s.id === purchase.supplierId);
      let supplierUpdates: Record<string, unknown> | undefined;
      const ops: Array<PromiseLike<{ error: any }>> = [
        supabase.from('supplier_purchases').delete().eq('id', id),
      ];

      if (supplier) {
        let newTotalPurchased = supplier.totalPurchased;
        let newTotalPaid = supplier.totalPaid;

        if (purchase.amount < 0) {
          newTotalPaid = supplier.totalPaid + purchase.amount; 
        } else {
          newTotalPurchased = supplier.totalPurchased - purchase.amount;
        }
        const newBalance = newTotalPurchased - newTotalPaid;
        
        supplierUpdates = { total_purchased: newTotalPurchased, total_paid: newTotalPaid, balance: newBalance };
        
        ops.push(supabase.from('suppliers').update(supplierUpdates).eq('id', purchase.supplierId));
      }

      void Promise.all(ops).then((results) => {
        const firstError = results.find((r) => r.error)?.error;
        if (firstError) {
          enqueuePendingSync('supplier_purchase_delete', { id, supplierId: purchase.supplierId, supplierUpdates }, firstError.message);
        }
      });
    }
  };

  const receiveSupplierStockBatch = async (input: {
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
  }) => {
    if (!input.items || input.items.length === 0) {
      toast.error('Please add at least one product item');
      return;
    }

    const supplier = suppliers.find((s) => s.id === input.supplierId);
    if (!supplier) {
      toast.error('Supplier not found');
      return;
    }

    const purchaseDate = input.purchaseDate || new Date().toISOString().slice(0, 10);
    const createdAt = new Date().toISOString();

    const resolvedInvoiceNumber = input.invoiceNumber?.trim()
      ? input.invoiceNumber.trim()
      : `INV-${purchaseDate.replace(/-/g, '')}-${Date.now().toString().slice(-6)}`;

    const productsToUpdate = [...productsRef.current];
    let totalPurchaseAmount = 0;

    const itemSummaries: string[] = [];

    // Track which products actually changed for Supabase sync
    const changedProductIds = new Set<string>();

    for (const item of input.items) {
      const quantity = Math.floor(item.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        toast.error('Each item quantity must be at least 1');
        return;
      }

      const originalProduct = productsRef.current.find((p) => p.id === item.productId);
      if (!originalProduct) {
        toast.error('One or more products were not found');
        return;
      }

      const resolvedUnitCost = item.unitCost !== undefined ? item.unitCost : originalProduct.costPrice;
      if (!Number.isFinite(resolvedUnitCost) || resolvedUnitCost < 0) {
        toast.error('Unit cost must be a valid non-negative number');
        return;
      }

      const itemExpiry = item.expiryDate || originalProduct.expiryDate;

      // Find if a product with same SKU AND same Expiry exists
      let targetProduct = productsToUpdate.find(
        (p) => p.sku === originalProduct.sku && (p.expiryDate === itemExpiry || (!p.expiryDate && !itemExpiry))
      );

      if (!targetProduct) {
        // Create a new batch clone
        const newBatchSku = itemExpiry 
          ? `${originalProduct.sku}-EXP-${itemExpiry.replace(/-/g, '')}`
          : `${originalProduct.sku}-B${Date.now().toString().slice(-4)}`;
        
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

    }

    const paidAmount = Number((input.paidAmount ?? 0).toFixed(2));
    if (!Number.isFinite(paidAmount) || paidAmount < 0) {
      toast.error('Paid amount must be a valid non-negative number');
      return;
    }
    if (paidAmount > totalPurchaseAmount) {
      toast.error('Paid amount cannot be greater than total purchase amount');
      return;
    }

    const newTotalPurchased = Number((supplier.totalPurchased + totalPurchaseAmount).toFixed(2));
    const newTotalPaid = Number((supplier.totalPaid + paidAmount).toFixed(2));
    const newBalance = Number((newTotalPurchased - newTotalPaid).toFixed(2));

    const invoicePurchase: SupplierPurchase = {
      id: generateId(),
      supplierId: supplier.id,
      description:
        input.note?.trim() ||
        `Stock intake (${input.items.length} item${input.items.length === 1 ? '' : 's'}): ${itemSummaries.join(', ')}`,
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
    setProducts(productsToUpdate);
    setSupplierPurchases((prev) => [...ledgerEntries, ...prev]);
    setSuppliers((prev) =>
      prev.map((s) =>
        s.id === supplier.id
          ? {
              ...s,
              totalPurchased: newTotalPurchased,
              totalPaid: newTotalPaid,
              balance: newBalance,
            }
          : s
      )
    );

    // Persist to Supabase (enqueue on failure for durability)
    if (import.meta.env.VITE_SUPABASE_URL) {
      const productsToSync = productsToUpdate.filter((p) => changedProductIds.has(p.id));

      try {
        const ops: Array<PromiseLike<{ error: any }>> = [];

        if (productsToSync.length > 0) {
          ops.push(
            supabase.from('products').upsert(
              productsToSync.map((p) => ({
                id: p.id,
                sku: p.sku,
                name: p.name,
                description: p.description,
                category_id: p.categoryId,
                unit_id: p.unitId,
                cost_price: p.costPrice,
                selling_price: p.sellingPrice,
                stock_quantity: p.stockQuantity,
                low_stock_threshold: p.lowStockThreshold,
                expiry_date: p.expiryDate,
                barcode: p.barcode,
                barcode_enabled: p.barcodeEnabled,
              })),
              { onConflict: 'id' }
            )
          );
        }

        ops.push(
          supabase.from('supplier_purchases').upsert(
            ledgerEntries.map((purchase) => ({
              id: purchase.id,
              supplier_id: purchase.supplierId,
              description: purchase.description,
              amount: purchase.amount,
              purchase_date: purchase.purchaseDate,
              invoice_number: purchase.invoiceNumber,
              created_at: purchase.createdAt,
            })),
            { onConflict: 'id' }
          )
        );

        ops.push(
          supabase
            .from('suppliers')
            .update({
              total_purchased: newTotalPurchased,
              total_paid: newTotalPaid,
              balance: newBalance,
            })
            .eq('id', supplier.id)
        );

        const results = await Promise.all(ops);
        const firstError = results.find((r) => r.error)?.error;
        if (firstError) throw firstError;

        toast.success(`Stock intake saved (Invoice: ${resolvedInvoiceNumber})`);
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : JSON.stringify(error);

        enqueuePendingSync(
          'supplier_stock_receive_batch',
          {
            productUpserts: productsToSync,
            purchases: ledgerEntries,
            supplierId: supplier.id,
            newTotalPurchased,
            newTotalPaid,
            newBalance,
          },
          errorMessage
        );
      }
    } else {
      toast.success(`Stock intake saved (Invoice: ${resolvedInvoiceNumber})`);
    }
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
  }) => {
    receiveSupplierStockBatch({
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
  ) => {
    const newSchedule: SupplierPaymentSchedule = {
      ...schedule,
      id: generateId(),
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    setSupplierPaymentSchedules((prev) => [newSchedule, ...prev]);

    if (import.meta.env.VITE_SUPABASE_URL) {
      void supabase
        .from('supplier_payment_schedules')
        .insert({
          id: newSchedule.id,
          supplier_id: newSchedule.supplierId,
          frequency: newSchedule.frequency,
          next_payment_date: newSchedule.nextPaymentDate,
          amount: newSchedule.amount,
          is_active: newSchedule.isActive,
          note: newSchedule.note,
          created_at: newSchedule.createdAt,
          last_paid_at: newSchedule.lastPaidAt,
        })
        .then(({ error }) => {
          if (error) {
            enqueuePendingSync('supplier_schedule_add', { schedule: newSchedule }, error.message);
          }
        });
    }
  };

  const updateSupplierPaymentSchedule = (id: string, updates: Partial<SupplierPaymentSchedule>) => {
    setSupplierPaymentSchedules((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
    );

    if (import.meta.env.VITE_SUPABASE_URL) {
      const dbUpdates: any = {};
      if (updates.frequency !== undefined) dbUpdates.frequency = updates.frequency;
      if (updates.nextPaymentDate !== undefined) dbUpdates.next_payment_date = updates.nextPaymentDate;
      if (updates.amount !== undefined) dbUpdates.amount = updates.amount;
      if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;
      if (updates.note !== undefined) dbUpdates.note = updates.note;
      if (updates.lastPaidAt !== undefined) dbUpdates.last_paid_at = updates.lastPaidAt;

      void supabase
        .from('supplier_payment_schedules')
        .update(dbUpdates)
        .eq('id', id)
        .then(({ error }) => {
          if (error) {
            enqueuePendingSync('supplier_schedule_update', { id, dbUpdates }, error.message);
          }
        });
    }
  };

  const deleteSupplierPaymentSchedule = (id: string) => {
    setSupplierPaymentSchedules((prev) => prev.filter((s) => s.id !== id));

    if (import.meta.env.VITE_SUPABASE_URL) {
      void supabase
        .from('supplier_payment_schedules')
        .delete()
        .eq('id', id)
        .then(({ error }) => {
          if (error) {
            enqueuePendingSync('supplier_schedule_delete', { id }, error.message);
          }
        });
    }
  };

  const getSupplierPaymentSchedules = (supplierId: string) =>
    supplierPaymentSchedules.filter((s) => s.supplierId === supplierId);

  const getDueSupplierPaymentSchedules = () => {
    const today = new Date().toISOString().slice(0, 10);
    return supplierPaymentSchedules.filter((s) => s.isActive && s.nextPaymentDate <= today);
  };

  const markSupplierSchedulePaid = (id: string) => {
    const schedule = supplierPaymentSchedules.find((s) => s.id === id);
    if (!schedule) return;

    const supplier = suppliers.find((s) => s.id === schedule.supplierId);
    if (supplier) {
      const newTotalPaid = supplier.totalPaid + schedule.amount;
      const newBalance = supplier.totalPurchased - newTotalPaid;

      const createdAt = new Date().toISOString();
      const paymentDate = createdAt.slice(0, 10);
      const paymentEntry: SupplierPurchase = {
        id: generateId(),
        supplierId: supplier.id,
        description: schedule.note?.trim() || `Payment received (schedule: ${schedule.frequency})`,
        amount: Number((-schedule.amount).toFixed(2)),
        purchaseDate: paymentDate,
        createdAt,
      };

      setSupplierPurchases((prev) => [paymentEntry, ...prev]);

      updateSupplier(supplier.id, {
        totalPaid: newTotalPaid,
        balance: newBalance,
      });

      if (import.meta.env.VITE_SUPABASE_URL) {
        void supabase
          .from('supplier_purchases')
          .insert({
            id: paymentEntry.id,
            supplier_id: paymentEntry.supplierId,
            description: paymentEntry.description,
            amount: paymentEntry.amount,
            purchase_date: paymentEntry.purchaseDate,
            invoice_number: paymentEntry.invoiceNumber,
            created_at: paymentEntry.createdAt,
          })
          .then(({ error }) => {
            if (error) {
              enqueuePendingSync('supplier_payment_add', { purchase: paymentEntry }, error.message);
            }
          });
      }
    }

    updateSupplierPaymentSchedule(id, {
      lastPaidAt: new Date().toISOString(),
      nextPaymentDate: calculateNextScheduleDate(schedule.nextPaymentDate, schedule.frequency),
    });
  };

  // Helper to add credit transaction when creating credit order
  const addCreditTransaction = async (customerId: string, orderId: string, amount: number) => {
    const createdAt = new Date().toISOString();
    const transaction: CustomerTransaction = {
      id: generateId(),
      customerId,
      orderId,
      type: 'credit',
      amount,
      description: `Credit sale - Order #${orderId.slice(-8).toUpperCase()}`,
      createdAt,
    };
    setCustomerTransactions((prev) => [...prev, transaction]);
    
    // Update customer balance
    setCustomers((prev) =>
      prev.map((c) => {
        if (c.id === customerId) {
          const newTotalCredit = c.totalCredit + amount;
          return {
            ...c,
            totalCredit: newTotalCredit,
            balance: newTotalCredit - c.totalPaid,
          };
        }
        return c;
      })
    );

    if (import.meta.env.VITE_SUPABASE_URL) {
      const customer = customers.find((c) => c.id === customerId);
      if (!customer) return;

      const newTotalCredit = customer.totalCredit + amount;
      const newBalance = newTotalCredit - customer.totalPaid;

      const [transactionResult, customerResult] = await Promise.all([
        supabase.from('customer_transactions').insert({
          id: transaction.id,
          customer_id: transaction.customerId,
          order_id: transaction.orderId,
          type: transaction.type,
          amount: transaction.amount,
          description: transaction.description,
          created_at: createdAt,
        }),
        supabase
          .from('customers')
          .update({ total_credit: newTotalCredit, balance: newBalance })
          .eq('id', customerId),
      ]);

      if (transactionResult.error || customerResult.error) {
        console.error('Error adding credit transaction:', transactionResult.error || customerResult.error);
        const errorMessage = (transactionResult.error || customerResult.error)?.message;
        enqueuePendingSync(
          'customer_credit',
          {
            transaction,
            customerId,
            newTotalCredit,
            newBalance,
          },
          errorMessage
        );
      }
    }
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
    const pending = pendingSyncOpsRef.current.length;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      toast.error(
        pending > 0
          ? `You are offline. ${pending} change${pending === 1 ? '' : 's'} saved on this device, waiting to sync.`
          : 'You are offline.'
      );
      return;
    }

    const toastId = toast.loading(pending > 0 ? `Syncing ${pending} pending changes...` : 'Checking for updates...');
    const result = await processPendingSyncQueue();
    toast.dismiss(toastId);

    if (result.failed > 0) {
      toast.error(
        `${result.failed} change${result.failed === 1 ? '' : 's'} could not be synced yet. They stay saved on this device and will retry automatically.`
      );
      return;
    }

    // Everything is on the server: reload from it without resetting the open cart.
    setRefreshKey((k) => k + 1);
    if (result.synced === 0) toast.success('Everything is up to date.');
  }, [processPendingSyncQueue, user]);

  return (
    <StoreContext.Provider
      value={{
        products,
        addProduct,
        updateProduct,
        deleteProducts,
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
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}

