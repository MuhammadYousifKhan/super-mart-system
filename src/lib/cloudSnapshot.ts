/* eslint-disable @typescript-eslint/no-explicit-any -- rows come back untyped from Supabase */
import { supabase } from '@/lib/supabase';
import type {
  Category,
  Customer,
  CustomerReminder,
  CustomerTransaction,
  Order,
  OrderItem,
  Product,
  StoreSettings,
  Supplier,
  SupplierPaymentSchedule,
  SupplierPurchase,
  Unit,
} from '@/types/pos';

/**
 * Everything the app keeps in the cloud, read in one go.
 * `null` means the table could not be read (optional / not created yet): keep the local copy.
 */
export interface CloudSnapshot {
  categories: Category[];
  /** null when the table is missing or empty: use the locally stored units. */
  units: Unit[] | null;
  products: Product[];
  orders: Order[];
  orderItems: OrderItem[];
  /** null when there is no settings row: use the locally stored settings. */
  settings: Omit<StoreSettings, 'cardFeePercent'> & { cardFeePercent?: number } | null;
  customers: Customer[];
  customerTransactions: CustomerTransaction[];
  customerReminders: CustomerReminder[] | null;
  suppliers: Supplier[] | null;
  supplierPurchases: SupplierPurchase[] | null;
  supplierPaymentSchedules: SupplierPaymentSchedule[] | null;
}

const PAGE_SIZE = 1000;

/**
 * Reads every row of a table. Supabase returns at most 1000 rows per request, so a plain
 * select('*') silently drops older sales once a shop has more than that.
 */
async function fetchAllRows(table: string, newestFirst: boolean): Promise<any[]> {
  const rows: any[] = [];
  let total: number | null = null;
  for (;;) {
    let query = supabase
      .from(table)
      .select('*', rows.length === 0 ? { count: 'exact' } : undefined)
      .range(rows.length, rows.length + PAGE_SIZE - 1);
    // A stable order is required for paging; id breaks ties between equal timestamps.
    if (newestFirst) query = query.order('created_at', { ascending: false });
    query = query.order('id', { ascending: true });

    const { data, error, count } = await query;
    if (error) throw error;
    if (total === null) total = count ?? null;
    const page = data || [];
    rows.push(...page);
    if (page.length === 0 || (total !== null && rows.length >= total) || (total === null && page.length < PAGE_SIZE)) {
      return rows;
    }
  }
}

/** Optional tables: a missing table must not stop the rest of the app from loading. */
async function fetchOptional(table: string, newestFirst: boolean): Promise<any[] | null> {
  try {
    return await fetchAllRows(table, newestFirst);
  } catch (error) {
    console.warn(`${table} not available yet:`, (error as { message?: string })?.message);
    return null;
  }
}

// Row converters (database columns -> app objects), shared by the full load and live updates.

export const mapProduct = (p: any): Product => ({
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
});

export const mapOrder = (o: any): Order => ({
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
});

export const mapOrderItem = (i: any): OrderItem => ({
  id: i.id,
  orderId: i.order_id,
  productId: i.product_id,
  productName: i.product_name,
  productSku: i.product_sku,
  quantity: i.quantity,
  unitPriceAtSale: i.unit_price_at_sale,
  unitCostAtSale: i.unit_cost_at_sale ?? undefined,
  discountAmount: i.discount_amount,
});

export const mapSettings = (s: any): NonNullable<CloudSnapshot['settings']> => ({
  storeName: s.store_name,
  address: s.address ?? '',
  phone: s.phone ?? '',
  taxRate: s.tax_rate,
  cardFeePercent: s.card_fee_percent ?? undefined,
  receiptFooterMessage: s.receipt_footer_message ?? '',
  allowNegativeStock: s.allow_negative_stock,
  logo: s.logo ?? undefined,
});

export const mapCustomer = (c: any): Customer => ({
  id: c.id,
  name: c.name,
  phone: c.phone,
  address: c.address,
  nic: c.nic,
  createdAt: c.created_at,
  totalCredit: c.total_credit,
  totalPaid: c.total_paid,
  balance: c.balance,
});

export const mapCustomerTransaction = (t: any): CustomerTransaction => ({
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
});

export const mapCustomerReminder = (r: any): CustomerReminder => ({
  id: r.id,
  customerId: r.customer_id,
  frequency: r.frequency,
  nextReminderDate: r.next_reminder_date,
  isActive: r.is_active,
  note: r.note,
  createdAt: r.created_at,
  lastTriggeredAt: r.last_triggered_at,
});

export const mapSupplier = (s: any): Supplier => ({
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
});

export const mapSupplierPurchase = (p: any): SupplierPurchase => ({
  id: p.id,
  supplierId: p.supplier_id,
  description: p.description,
  amount: p.amount,
  purchaseDate: p.purchase_date,
  invoiceNumber: p.invoice_number,
  createdAt: p.created_at,
});

export const mapSupplierPaymentSchedule = (s: any): SupplierPaymentSchedule => ({
  id: s.id,
  supplierId: s.supplier_id,
  frequency: s.frequency,
  nextPaymentDate: s.next_payment_date,
  amount: s.amount,
  isActive: s.is_active,
  note: s.note,
  createdAt: s.created_at,
  lastPaidAt: s.last_paid_at,
});

export async function fetchCloudSnapshot(): Promise<CloudSnapshot> {
  const [
    categoriesData,
    unitsData,
    productsData,
    ordersData,
    orderItemsData,
    settingsResult,
    customersData,
    transactionsData,
    remindersData,
    suppliersData,
    purchasesData,
    schedulesData,
  ] = await Promise.all([
    fetchAllRows('categories', false),
    fetchOptional('units', false),
    fetchAllRows('products', false),
    fetchAllRows('orders', true),
    fetchAllRows('order_items', false),
    supabase.from('store_settings').select('*').single(),
    fetchAllRows('customers', true),
    fetchAllRows('customer_transactions', true),
    fetchOptional('customer_reminders', true),
    fetchOptional('suppliers', true),
    fetchOptional('supplier_purchases', true),
    fetchOptional('supplier_payment_schedules', true),
  ]);

  return {
    categories: categoriesData,
    units: unitsData && unitsData.length > 0 ? unitsData : null,
    products: productsData.map(mapProduct),
    orders: ordersData.map(mapOrder),
    orderItems: orderItemsData.map(mapOrderItem),
    settings: settingsResult.error || !settingsResult.data ? null : mapSettings(settingsResult.data),
    customers: customersData.map(mapCustomer),
    customerTransactions: transactionsData.map(mapCustomerTransaction),
    customerReminders: remindersData?.map(mapCustomerReminder) ?? null,
    suppliers: suppliersData?.map(mapSupplier) ?? null,
    supplierPurchases: purchasesData?.map(mapSupplierPurchase) ?? null,
    supplierPaymentSchedules: schedulesData?.map(mapSupplierPaymentSchedule) ?? null,
  };
}
