import React, { useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import {
  Product,
  Category,
  Unit,
  Order,
  OrderItem,
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
      note?: string;
    }>;
    paidAmount?: number;
    purchaseDate?: string;
    invoiceNumber?: string;
    note?: string;
  }) => void;
  getSupplierPurchases: (supplierId: string) => SupplierPurchase[];
  addSupplierPaymentSchedule: (schedule: Omit<SupplierPaymentSchedule, 'id' | 'createdAt' | 'isActive' | 'lastPaidAt'>) => void;
  updateSupplierPaymentSchedule: (id: string, updates: Partial<SupplierPaymentSchedule>) => void;
  deleteSupplierPaymentSchedule: (id: string) => void;
  getSupplierPaymentSchedules: (supplierId: string) => SupplierPaymentSchedule[];
  getDueSupplierPaymentSchedules: () => SupplierPaymentSchedule[];
  markSupplierSchedulePaid: (id: string) => void;

  // Orders
  orders: Order[];
  orderItems: OrderItem[];
  createOrder: (options: CreateOrderOptions) => Promise<Order>;
  updateOrder: (id: string, updates: Partial<Order>) => Promise<void>;
  cancelOrder: (id: string) => Promise<void>;
  getOrderItems: (orderId: string) => OrderItem[];
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
}

type PendingSyncOperationType =
  | 'order_with_items'
  | 'customer_add'
  | 'customer_update'
  | 'customer_delete'
  | 'customer_payment'
  | 'customer_credit'
  | 'customer_reminder_add'
  | 'customer_reminder_update'
  | 'customer_reminder_delete'
  | 'supplier_add'
  | 'supplier_update'
  | 'supplier_delete'
  | 'supplier_purchase_add'
  | 'supplier_stock_receive'
  | 'supplier_stock_receive_batch'
  | 'supplier_schedule_add'
  | 'supplier_schedule_update'
  | 'supplier_schedule_delete';

interface PendingSyncOperation {
  id: string;
  type: PendingSyncOperationType;
  payload: any;
  createdAt: string;
  retryCount: number;
  lastError?: string;
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

const FIXED_CARD_FEE_PERCENT = 2;
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
  const [pendingSyncOps, setPendingSyncOps] = useState<PendingSyncOperation[]>(() => loadPendingSyncQueue());
  const [loading, setLoading] = useState(true);
  const isProcessingPendingSync = useRef(false);
  const pendingSyncTimer = useRef<number | null>(null);

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
          productUpdates: Array<{ productId: string; newStockQuantity: number; newCostPrice: number }>;
          purchases: SupplierPurchase[];
          supplierId: string;
          newTotalPurchased: number;
          newTotalPaid: number;
          newBalance: number;
        };

        const productPromises = payload.productUpdates.map((item) =>
          supabase
            .from('products')
            .update({
              stock_quantity: item.newStockQuantity,
              cost_price: item.newCostPrice,
            })
            .eq('id', item.productId)
        );

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
    }
  }, []);

  const processPendingSyncQueue = useCallback(async () => {
    if (!import.meta.env.VITE_SUPABASE_URL) return;
    if (pendingSyncOps.length === 0) return;
    if (isProcessingPendingSync.current) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    isProcessingPendingSync.current = true;
    let successCount = 0;
    const remainingOps: PendingSyncOperation[] = [];

    for (const op of pendingSyncOps) {
      try {
        await executePendingSyncOperation(op);
        successCount += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown sync error';
        remainingOps.push({
          ...op,
          retryCount: op.retryCount + 1,
          lastError: message,
        });
      }
    }

    setPendingSyncOps(remainingOps);
    isProcessingPendingSync.current = false;

    if (successCount > 0) {
      toast.success(`Synced ${successCount} pending changes to database.`);
    }

    if (remainingOps.length > 0) {
      const maxRetryCount = Math.max(...remainingOps.map((op) => op.retryCount));
      const delayMs = Math.min(60000, 5000 * Math.max(1, maxRetryCount));
      if (pendingSyncTimer.current !== null) {
        window.clearTimeout(pendingSyncTimer.current);
      }
      pendingSyncTimer.current = window.setTimeout(() => {
        void processPendingSyncQueue();
      }, delayMs);
    }
  }, [executePendingSyncOperation, pendingSyncOps]);

  // Load data from Supabase
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Check if Supabase is configured
        if (!import.meta.env.VITE_SUPABASE_URL) {
          console.warn('Supabase not configured, using local storage fallback');
          loadFromLocalStorage();
          setLoading(false);
          return;
        }

        // Fetch Categories
        const { data: categoriesData, error: categoriesError } = await supabase
          .from('categories')
          .select('*');
        
        if (categoriesError) throw categoriesError;
        if (categoriesData) setCategories(categoriesData);

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
            cardFeePercent: FIXED_CARD_FEE_PERCENT,
            receiptFooterMessage: settingsData.receipt_footer_message,
            allowNegativeStock: settingsData.allow_negative_stock,
            logo: settingsData.logo,
          });
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
        loadFromLocalStorage();
      } finally {
        setLoading(false);
      }
    };

    const loadFromLocalStorage = () => {
      const loadData = <T,>(key: string, defaultValue: T): T => {
        const saved = localStorage.getItem(key);
        if (saved) {
          try {
            return JSON.parse(saved);
          } catch {
            return defaultValue;
          }
        }
        return defaultValue;
      };

      setProducts(loadData('pos_products', SAMPLE_PRODUCTS));
      setUnits(loadData('pos_units', SAMPLE_UNITS));
      setCategories(loadData('pos_categories', SAMPLE_CATEGORIES));
      setOrders(loadData('pos_orders', []));
      setOrderItems(loadData('pos_order_items', []));
      setSettings(loadData('pos_settings', DEFAULT_SETTINGS));
      setHeldCarts(loadData('pos_held_carts', []));
      setCustomers(loadData('pos_customers', []));
      setCustomerTransactions(loadData('pos_customer_transactions', []));
      setCustomerReminders(loadData('pos_customer_reminders', []));
      setSuppliers(loadData('pos_suppliers', []));
      setSupplierPurchases(loadData('pos_supplier_purchases', []));
      setSupplierPaymentSchedules(loadData('pos_supplier_payment_schedules', []));
    };

    fetchData();
  }, []);

  useEffect(() => {
    localStorage.setItem(PENDING_SYNC_STORAGE_KEY, JSON.stringify(pendingSyncOps));
  }, [pendingSyncOps]);

  useEffect(() => {
    if (!import.meta.env.VITE_SUPABASE_URL) return;
    if (pendingSyncOps.length === 0) return;
    void processPendingSyncQueue();
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      void processPendingSyncQueue();
    };

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
      if (pendingSyncTimer.current !== null) {
        window.clearTimeout(pendingSyncTimer.current);
      }
    };
  }, [processPendingSyncQueue]);

  // Save held carts to localStorage (keep local)
  useEffect(() => {
    localStorage.setItem('pos_held_carts', JSON.stringify(heldCarts));
  }, [heldCarts]);

  // Save customers to localStorage
  useEffect(() => {
    localStorage.setItem('pos_customers', JSON.stringify(customers));
  }, [customers]);

  // Save customer transactions to localStorage
  useEffect(() => {
    localStorage.setItem('pos_customer_transactions', JSON.stringify(customerTransactions));
  }, [customerTransactions]);

  // Save customer reminders to localStorage
  useEffect(() => {
    localStorage.setItem('pos_customer_reminders', JSON.stringify(customerReminders));
  }, [customerReminders]);

  // Save suppliers to localStorage
  useEffect(() => {
    localStorage.setItem('pos_suppliers', JSON.stringify(suppliers));
  }, [suppliers]);

  // Save supplier purchases to localStorage
  useEffect(() => {
    localStorage.setItem('pos_supplier_purchases', JSON.stringify(supplierPurchases));
  }, [supplierPurchases]);

  // Save supplier payment schedules to localStorage
  useEffect(() => {
    localStorage.setItem('pos_supplier_payment_schedules', JSON.stringify(supplierPaymentSchedules));
  }, [supplierPaymentSchedules]);

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
        toast.error('Failed to save product to database');
        // Revert optimistic update? Or just let it be local for now.
      }
    } else {
      localStorage.setItem('pos_products', JSON.stringify([...products, newProduct]));
    }
  };

  const updateProduct = async (id: string, updates: Partial<Product>) => {
    // Optimistic update
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updates } : p))
    );

    if (import.meta.env.VITE_SUPABASE_URL) {
      const dbUpdates: any = {};
      if (updates.sku) dbUpdates.sku = updates.sku;
      if (updates.name) dbUpdates.name = updates.name;
      if (updates.description) dbUpdates.description = updates.description;
      if (updates.categoryId) dbUpdates.category_id = updates.categoryId;
      if (updates.unitId) dbUpdates.unit_id = updates.unitId;
      if (updates.costPrice !== undefined) dbUpdates.cost_price = updates.costPrice;
      if (updates.sellingPrice !== undefined) dbUpdates.selling_price = updates.sellingPrice;
      if (updates.stockQuantity !== undefined) dbUpdates.stock_quantity = updates.stockQuantity;
      if (updates.lowStockThreshold !== undefined) dbUpdates.low_stock_threshold = updates.lowStockThreshold;
      if (updates.expiryDate !== undefined) dbUpdates.expiry_date = updates.expiryDate || null;
      if (updates.barcode !== undefined) dbUpdates.barcode = updates.barcode || null;
      if (updates.barcodeEnabled !== undefined) dbUpdates.barcode_enabled = updates.barcodeEnabled;

      const { error } = await supabase
        .from('products')
        .update(dbUpdates)
        .eq('id', id);

      if (error) {
        console.error('Error updating product:', error);
        toast.error('Failed to update product in database');
      }
    } else {
      const updatedProducts = products.map((p) => (p.id === id ? { ...p, ...updates } : p));
      localStorage.setItem('pos_products', JSON.stringify(updatedProducts));
    }
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
        toast.error('Failed to delete products from database');
      }
    } else {
      const remainingProducts = products.filter((p) => !ids.includes(p.id));
      localStorage.setItem('pos_products', JSON.stringify(remainingProducts));
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
        toast.error('Failed to save unit');
      }
    } else {
      localStorage.setItem('pos_units', JSON.stringify([...units, newUnit]));
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
        toast.error('Failed to update unit');
      }
    } else {
      const updatedUnits = units.map((u) => (u.id === id ? { ...u, ...updates } : u));
      localStorage.setItem('pos_units', JSON.stringify(updatedUnits));
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
      localStorage.setItem('pos_units', JSON.stringify(remainingUnits));
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
      localStorage.setItem('pos_categories', JSON.stringify([...categories, newCategory]));
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
      localStorage.setItem('pos_categories', JSON.stringify(updatedCategories));
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
      localStorage.setItem('pos_categories', JSON.stringify(remainingCategories));
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
    const cardFeeRate = paymentMethod === 'card' ? FIXED_CARD_FEE_PERCENT : 0;
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

    // Update stock locally
    items.forEach((item) => {
      updateProduct(item.product.id, {
        stockQuantity: item.product.stockQuantity - item.quantity,
      });
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
      localStorage.setItem('pos_orders', JSON.stringify([order, ...orders]));
      localStorage.setItem('pos_order_items', JSON.stringify([...orderItems, ...newOrderItems]));
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
      localStorage.setItem('pos_orders', JSON.stringify(updatedOrders));
    }
  };

  const cancelOrder = async (id: string) => {
    const order = orders.find((o) => o.id === id);
    if (!order || order.status === 'refunded') return;

    const relatedItems = getOrderItems(id);

    // Restore stock for all items in the cancelled order.
    for (const item of relatedItems) {
      const product = products.find((p) => p.id === item.productId);
      if (!product) continue;
      await updateProduct(item.productId, {
        stockQuantity: product.stockQuantity + item.quantity,
      });
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
      localStorage.setItem('pos_settings', JSON.stringify(newSettings));
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
    const cardFeeRate = paymentMethod === 'card' ? FIXED_CARD_FEE_PERCENT : 0;
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

  const receiveSupplierStockBatch = (input: {
    supplierId: string;
    items: Array<{
      productId: string;
      quantity: number;
      unitCost?: number;
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

    const productUpdates: Array<{ productId: string; newStockQuantity: number; newCostPrice: number }> = [];
    const purchases: SupplierPurchase[] = [];
    let totalPurchaseAmount = 0;

    for (const item of input.items) {
      const quantity = Math.floor(item.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        toast.error('Each item quantity must be at least 1');
        return;
      }

      const product = products.find((p) => p.id === item.productId);
      if (!product) {
        toast.error('One or more products were not found');
        return;
      }

      const resolvedUnitCost = item.unitCost !== undefined ? item.unitCost : product.costPrice;
      if (!Number.isFinite(resolvedUnitCost) || resolvedUnitCost < 0) {
        toast.error('Unit cost must be a valid non-negative number');
        return;
      }

      const amount = Number((resolvedUnitCost * quantity).toFixed(2));
      totalPurchaseAmount += amount;

      productUpdates.push({
        productId: product.id,
        newStockQuantity: product.stockQuantity + quantity,
        newCostPrice: resolvedUnitCost,
      });

      purchases.push({
        id: generateId(),
        supplierId: supplier.id,
        description:
          item.note?.trim() ||
          input.note?.trim() ||
          `Stock received: ${product.name} x${quantity} @ ${resolvedUnitCost.toFixed(2)}`,
        amount,
        purchaseDate,
        invoiceNumber: input.invoiceNumber,
        createdAt,
      });
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

    const productUpdateMap = new Map(
      productUpdates.map((item) => [item.productId, item] as const)
    );

    setProducts((prev) =>
      prev.map((product) => {
        const update = productUpdateMap.get(product.id);
        if (!update) return product;
        return {
          ...product,
          stockQuantity: update.newStockQuantity,
          costPrice: update.newCostPrice,
        };
      })
    );
    setSupplierPurchases((prev) => [...purchases, ...prev]);
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

    if (import.meta.env.VITE_SUPABASE_URL) {
      const productPromises = productUpdates.map((item) =>
        supabase
          .from('products')
          .update({
            stock_quantity: item.newStockQuantity,
            cost_price: item.newCostPrice,
          })
          .eq('id', item.productId)
      );

      void Promise.all([
        supabase.from('supplier_purchases').insert(
          purchases.map((purchase) => ({
            id: purchase.id,
            supplier_id: purchase.supplierId,
            description: purchase.description,
            amount: purchase.amount,
            purchase_date: purchase.purchaseDate,
            invoice_number: purchase.invoiceNumber,
            created_at: purchase.createdAt,
          }))
        ),
        supabase
          .from('suppliers')
          .update({
            total_purchased: newTotalPurchased,
            total_paid: newTotalPaid,
            balance: newBalance,
          })
          .eq('id', supplier.id),
        ...productPromises,
      ]).then(([purchaseResult, supplierResult, ...productResults]) => {
        const firstProductError = productResults.find((r) => r.error)?.error;
        if (purchaseResult.error || supplierResult.error || firstProductError) {
          const err = purchaseResult.error || supplierResult.error || firstProductError;
          if (productUpdates.length === 1 && purchases.length === 1) {
            enqueuePendingSync(
              'supplier_stock_receive',
              {
                productId: productUpdates[0].productId,
                newStockQuantity: productUpdates[0].newStockQuantity,
                purchase: purchases[0],
                supplierId: supplier.id,
                newTotalPurchased,
                newTotalPaid,
                newBalance,
              },
              err?.message
            );
            return;
          }
          enqueuePendingSync(
            'supplier_stock_receive_batch',
            {
              productUpdates,
              purchases,
              supplierId: supplier.id,
              newTotalPurchased,
              newTotalPaid,
              newBalance,
            },
            err?.message
          );
        }
      });
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
      updateSupplier(supplier.id, {
        totalPaid: newTotalPaid,
        balance: newBalance,
      });
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
        createOrder,
        updateOrder,
        cancelOrder,
        getOrderItems,
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
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}

