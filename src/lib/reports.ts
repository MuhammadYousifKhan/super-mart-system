import type {
  Category,
  Customer,
  CustomerTransaction,
  Order,
  OrderItem,
  Product,
  Supplier,
  SupplierPurchase,
} from '@/types/pos';
import { getOrderBreakdown } from '@/lib/orderMath';
import { parseLocalDate, toLocalISODate, todayLocal } from '@/lib/dates';

/** Inclusive range of local calendar days, as YYYY-MM-DD. */
export interface DateRange {
  from: string;
  to: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Local calendar day of an ISO timestamp (or a YYYY-MM-DD date, returned as is). */
export function dayOf(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return toLocalISODate(new Date(value));
}

export const inRange = (day: string, range: DateRange) => day >= range.from && day <= range.to;

export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((parseLocalDate(toDay).getTime() - parseLocalDate(fromDay).getTime()) / 86400000);
}

// ---------------------------------------------------------------------------
// Sales & profit
// ---------------------------------------------------------------------------

export interface ProfitRow {
  key: string;
  label: string;
  orders: number;
  quantity: number;
  sales: number;
  cost: number;
  profit: number;
  /** Profit as a percentage of sales. */
  margin: number;
}

export interface PaymentRow {
  method: string;
  orders: number;
  amount: number;
}

export interface SalesProfitReport {
  orders: number;
  itemsSold: number;
  /** Item prices x quantity, before discounts. */
  grossSales: number;
  discounts: number;
  /** Sales after discounts, before tax and card fees. Profit is measured against this. */
  netSales: number;
  tax: number;
  cardFees: number;
  /** What customers were billed in total (net sales + tax + card fees). */
  billed: number;
  cost: number;
  profit: number;
  margin: number;
  averageBill: number;
  cancelledOrders: number;
  cancelledAmount: number;
  /** Credit given on account in the period (bills paid by credit). */
  creditSales: number;
  /** Money customers paid against their credit in the period. */
  creditRecovered: number;
  creditRecoveredByMethod: PaymentRow[];
  /** Sale lines from before cost tracking, priced at today's product cost. */
  estimatedCostLines: number;
  /** Sale lines whose product no longer exists, so no cost is known (counted as 0). */
  missingCostLines: number;
  byPayment: PaymentRow[];
  byDay: ProfitRow[];
  byProduct: ProfitRow[];
  byCategory: ProfitRow[];
  byCashier: ProfitRow[];
}

type Acc = { label: string; orders: Set<string>; quantity: number; sales: number; cost: number };

function addTo(map: Map<string, Acc>, key: string, label: string, orderId: string, qty: number, sales: number, cost: number) {
  let acc = map.get(key);
  if (!acc) {
    acc = { label, orders: new Set(), quantity: 0, sales: 0, cost: 0 };
    map.set(key, acc);
  }
  acc.orders.add(orderId);
  acc.quantity += qty;
  acc.sales += sales;
  acc.cost += cost;
}

function toRows(map: Map<string, Acc>): ProfitRow[] {
  return [...map.entries()].map(([key, a]) => {
    const sales = round2(a.sales);
    const cost = round2(a.cost);
    const profit = round2(sales - cost);
    return {
      key,
      label: a.label,
      orders: a.orders.size,
      quantity: round2(a.quantity),
      sales,
      cost,
      profit,
      margin: sales > 0 ? round2((profit / sales) * 100) : 0,
    };
  });
}

export const isCreditReversal = (t: CustomerTransaction) =>
  t.type === 'payment' && /^credit reversal/i.test(t.description || '');

export function paymentLabel(order: Pick<Order, 'paymentMethod' | 'transferType'>): string {
  const method = order.paymentMethod.charAt(0).toUpperCase() + order.paymentMethod.slice(1);
  return order.transferType ? `${method} (${order.transferType})` : method;
}

export function buildSalesProfitReport(args: {
  range: DateRange;
  orders: Order[];
  orderItems: OrderItem[];
  products: Product[];
  categories: Category[];
  customerTransactions: CustomerTransaction[];
}): SalesProfitReport {
  const { range, orders, orderItems, products, categories, customerTransactions } = args;

  const itemsByOrder = new Map<string, OrderItem[]>();
  for (const item of orderItems) {
    const list = itemsByOrder.get(item.orderId);
    if (list) list.push(item);
    else itemsByOrder.set(item.orderId, [item]);
  }
  const productById = new Map(products.map((p) => [p.id, p]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  const byDay = new Map<string, Acc>();
  const byProduct = new Map<string, Acc>();
  const byCategory = new Map<string, Acc>();
  const byCashier = new Map<string, Acc>();
  const byPayment = new Map<string, PaymentRow>();

  let count = 0;
  let itemsSold = 0;
  let grossSales = 0;
  let discounts = 0;
  let netSales = 0;
  let tax = 0;
  let cardFees = 0;
  let billed = 0;
  let cost = 0;
  let cancelledOrders = 0;
  let cancelledAmount = 0;
  let creditSales = 0;
  let estimatedCostLines = 0;
  let missingCostLines = 0;

  for (const order of orders) {
    const day = dayOf(order.createdAt);
    if (!inRange(day, range)) continue;
    if (order.status === 'refunded') {
      cancelledOrders += 1;
      cancelledAmount += order.totalAmount;
      continue;
    }

    const items = itemsByOrder.get(order.id) || [];
    const breakdown = getOrderBreakdown(order, items);
    count += 1;
    grossSales += breakdown.subtotal;
    discounts += breakdown.discount;
    netSales += breakdown.taxable;
    tax += order.taxAmount;
    cardFees += breakdown.cardFee;
    billed += order.totalAmount;
    if (order.paymentMethod === 'credit') creditSales += order.totalAmount;

    const payKey = paymentLabel(order);
    const pay = byPayment.get(payKey) || { method: payKey, orders: 0, amount: 0 };
    pay.orders += 1;
    pay.amount += order.totalAmount;
    byPayment.set(payKey, pay);

    // Spread the cart-wide discount over the lines, so per-product sales add up to net sales.
    const lineNets = items.map((i) => i.unitPriceAtSale * i.quantity - i.discountAmount);
    const sumNets = lineNets.reduce((s, n) => s + n, 0);
    const factor = sumNets > 0 ? breakdown.taxable / sumNets : 0;

    let orderCost = 0;
    items.forEach((item, idx) => {
      const product = productById.get(item.productId);
      let unitCost = item.unitCostAtSale;
      if (unitCost === undefined || unitCost === null) {
        if (product) {
          unitCost = product.costPrice;
          estimatedCostLines += 1;
        } else {
          unitCost = 0;
          missingCostLines += 1;
        }
      }
      const lineCost = unitCost * item.quantity;
      const lineSales = lineNets[idx] * factor;
      orderCost += lineCost;
      itemsSold += item.quantity;

      addTo(byProduct, item.productId || item.productName, item.productName, order.id, item.quantity, lineSales, lineCost);
      const catId = product?.categoryId || '';
      addTo(byCategory, catId || 'none', categoryName.get(catId) || 'Uncategorised', order.id, item.quantity, lineSales, lineCost);
    });

    cost += orderCost;
    addTo(byDay, day, day, order.id, 0, breakdown.taxable, orderCost);
    addTo(byCashier, order.cashierId || order.cashierName, order.cashierName || 'Unknown', order.id, 0, breakdown.taxable, orderCost);
  }

  // Credit recovered: real customer payments, not reversals of cancelled credit bills.
  const recoveredByMethod = new Map<string, PaymentRow>();
  let creditRecovered = 0;
  for (const t of customerTransactions) {
    if (t.type !== 'payment' || isCreditReversal(t) || !inRange(dayOf(t.createdAt), range)) continue;
    creditRecovered += t.amount;
    const key = t.paymentMethod === 'card' ? 'Card' : 'Cash';
    const row = recoveredByMethod.get(key) || { method: key, orders: 0, amount: 0 };
    row.orders += 1;
    row.amount += t.amount;
    recoveredByMethod.set(key, row);
  }

  netSales = round2(netSales);
  cost = round2(cost);
  const profit = round2(netSales - cost);

  const byDesc = (a: ProfitRow, b: ProfitRow) => b.sales - a.sales;
  return {
    orders: count,
    itemsSold: round2(itemsSold),
    grossSales: round2(grossSales),
    discounts: round2(discounts),
    netSales,
    tax: round2(tax),
    cardFees: round2(cardFees),
    billed: round2(billed),
    cost,
    profit,
    margin: netSales > 0 ? round2((profit / netSales) * 100) : 0,
    averageBill: count > 0 ? round2(billed / count) : 0,
    cancelledOrders,
    cancelledAmount: round2(cancelledAmount),
    creditSales: round2(creditSales),
    creditRecovered: round2(creditRecovered),
    creditRecoveredByMethod: [...recoveredByMethod.values()].map((r) => ({ ...r, amount: round2(r.amount) })),
    estimatedCostLines,
    missingCostLines,
    byPayment: [...byPayment.values()].map((r) => ({ ...r, amount: round2(r.amount) })).sort((a, b) => b.amount - a.amount),
    byDay: toRows(byDay).sort((a, b) => a.key.localeCompare(b.key)),
    byProduct: toRows(byProduct).sort(byDesc),
    byCategory: toRows(byCategory).sort(byDesc),
    byCashier: toRows(byCashier).sort(byDesc),
  };
}

// ---------------------------------------------------------------------------
// Ledgers (customer and supplier share the same shape)
// ---------------------------------------------------------------------------

export interface LedgerEntry {
  id: string;
  /** Local day, YYYY-MM-DD. */
  date: string;
  /** Exact time when known, for ordering entries on the same day. */
  timestamp: string;
  kind: string;
  description: string;
  /** Increases the balance (credit sale / supplier invoice). */
  debit: number;
  /** Decreases the balance (payment / reversal). */
  credit: number;
  balance: number;
}

export interface Ledger {
  opening: number;
  entries: LedgerEntry[];
  totalDebit: number;
  totalCredit: number;
  closing: number;
}

function buildLedger(all: Omit<LedgerEntry, 'balance'>[], range: DateRange): Ledger {
  const sorted = [...all].sort((a, b) => a.date.localeCompare(b.date) || a.timestamp.localeCompare(b.timestamp));
  let balance = 0;
  let opening = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  const entries: LedgerEntry[] = [];
  for (const e of sorted) {
    if (e.date > range.to) break;
    balance = round2(balance + e.debit - e.credit);
    if (e.date < range.from) {
      opening = balance;
      continue;
    }
    totalDebit += e.debit;
    totalCredit += e.credit;
    entries.push({ ...e, balance });
  }
  return { opening, entries, totalDebit: round2(totalDebit), totalCredit: round2(totalCredit), closing: balance };
}

export function buildCustomerLedger(customerId: string, transactions: CustomerTransaction[], range: DateRange): Ledger {
  return buildLedger(
    transactions
      .filter((t) => t.customerId === customerId)
      .map((t) => {
        const reversal = isCreditReversal(t);
        const kind = t.type === 'credit' ? 'Credit sale' : reversal ? 'Reversal' : `Payment${t.paymentMethod ? ` (${t.paymentMethod})` : ''}`;
        return {
          id: t.id,
          date: dayOf(t.createdAt),
          timestamp: t.createdAt,
          kind,
          description: t.description || '',
          debit: t.type === 'credit' ? t.amount : 0,
          credit: t.type === 'payment' ? t.amount : 0,
        };
      }),
    range
  );
}

export function buildSupplierLedger(supplierId: string, purchases: SupplierPurchase[], range: DateRange): Ledger {
  return buildLedger(
    purchases
      .filter((p) => p.supplierId === supplierId)
      .map((p) => ({
        id: p.id,
        date: dayOf(p.purchaseDate || p.createdAt),
        timestamp: p.createdAt,
        kind: p.amount >= 0 ? 'Purchase' : 'Payment',
        description: [p.description, p.invoiceNumber ? `Inv ${p.invoiceNumber}` : ''].filter(Boolean).join(' - '),
        debit: p.amount >= 0 ? p.amount : 0,
        credit: p.amount < 0 ? -p.amount : 0,
      })),
    range
  );
}

// ---------------------------------------------------------------------------
// Customer outstanding (bakaya) with ageing
// ---------------------------------------------------------------------------

export interface OutstandingRow {
  id: string;
  name: string;
  phone: string;
  totalCredit: number;
  totalPaid: number;
  balance: number;
  /** Unpaid credit split by how old it is, oldest credit paid off first. */
  age0to30: number;
  age31to60: number;
  age61to90: number;
  age90plus: number;
  lastCreditDate: string;
  lastPaymentDate: string;
  /** Days since the last payment, or since the first unpaid credit if never paid. */
  daysSincePayment: number | null;
}

export function buildCustomerOutstanding(
  customers: Customer[],
  transactions: CustomerTransaction[],
  today: string = todayLocal()
): OutstandingRow[] {
  const byCustomer = new Map<string, CustomerTransaction[]>();
  for (const t of transactions) {
    const list = byCustomer.get(t.customerId);
    if (list) list.push(t);
    else byCustomer.set(t.customerId, [t]);
  }

  const rows: OutstandingRow[] = [];
  for (const c of customers) {
    if (!(c.balance > 0.5)) continue;
    const txs = (byCustomer.get(c.id) || []).slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    // First-in, first-out: each payment pays off the oldest credit still open.
    const open: { day: string; remaining: number }[] = [];
    let lastCreditDate = '';
    let lastPaymentDate = '';
    for (const t of txs) {
      const day = dayOf(t.createdAt);
      if (t.type === 'credit') {
        open.push({ day, remaining: t.amount });
        lastCreditDate = day;
      } else {
        if (!isCreditReversal(t)) lastPaymentDate = day;
        let left = t.amount;
        while (left > 0 && open.length > 0) {
          const take = Math.min(left, open[0].remaining);
          open[0].remaining -= take;
          left -= take;
          if (open[0].remaining <= 0.0001) open.shift();
        }
      }
    }

    const ages = [0, 0, 0, 0];
    for (const o of open) {
      const age = daysBetween(o.day, today);
      ages[age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3] += o.remaining;
    }
    // Balance with no matching credit entry (e.g. an opening balance entered directly) is of unknown age.
    const unmatched = c.balance - ages.reduce((s, a) => s + a, 0);
    if (unmatched > 0.5) ages[3] += unmatched;

    const since = lastPaymentDate || open[0]?.day || '';
    rows.push({
      id: c.id,
      name: c.name,
      phone: c.phone || '',
      totalCredit: round2(c.totalCredit),
      totalPaid: round2(c.totalPaid),
      balance: round2(c.balance),
      age0to30: round2(ages[0]),
      age31to60: round2(ages[1]),
      age61to90: round2(ages[2]),
      age90plus: round2(ages[3]),
      lastCreditDate,
      lastPaymentDate,
      daysSincePayment: since ? daysBetween(since, today) : null,
    });
  }
  return rows.sort((a, b) => b.balance - a.balance);
}

export interface CustomerPaymentRow {
  id: string;
  date: string;
  customer: string;
  method: string;
  description: string;
  amount: number;
}

export function buildCustomerPayments(
  customers: Customer[],
  transactions: CustomerTransaction[],
  range: DateRange
): CustomerPaymentRow[] {
  const names = new Map(customers.map((c) => [c.id, c.name]));
  return transactions
    .filter((t) => t.type === 'payment' && !isCreditReversal(t) && inRange(dayOf(t.createdAt), range))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((t) => ({
      id: t.id,
      date: dayOf(t.createdAt),
      customer: names.get(t.customerId) || 'Deleted customer',
      method: t.paymentMethod === 'card' ? 'Card' : 'Cash',
      description: t.description || '',
      amount: t.amount,
    }));
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export interface PayableRow {
  id: string;
  name: string;
  phone: string;
  totalPurchased: number;
  totalPaid: number;
  balance: number;
  purchasedInPeriod: number;
  paidInPeriod: number;
  lastPurchaseDate: string;
  lastPaymentDate: string;
}

export function buildSupplierPayables(suppliers: Supplier[], purchases: SupplierPurchase[], range: DateRange): PayableRow[] {
  const rows = new Map<string, PayableRow>(
    suppliers.map((s) => [
      s.id,
      {
        id: s.id,
        name: s.name,
        phone: s.phone || '',
        totalPurchased: round2(s.totalPurchased),
        totalPaid: round2(s.totalPaid),
        balance: round2(s.balance),
        purchasedInPeriod: 0,
        paidInPeriod: 0,
        lastPurchaseDate: '',
        lastPaymentDate: '',
      },
    ])
  );
  for (const p of purchases) {
    const row = rows.get(p.supplierId);
    if (!row) continue;
    const day = dayOf(p.purchaseDate || p.createdAt);
    if (p.amount >= 0) {
      if (day > row.lastPurchaseDate) row.lastPurchaseDate = day;
      if (inRange(day, range)) row.purchasedInPeriod = round2(row.purchasedInPeriod + p.amount);
    } else {
      if (day > row.lastPaymentDate) row.lastPaymentDate = day;
      if (inRange(day, range)) row.paidInPeriod = round2(row.paidInPeriod - p.amount);
    }
  }
  return [...rows.values()].sort((a, b) => b.balance - a.balance);
}

export interface SupplierPaymentRow {
  id: string;
  date: string;
  supplier: string;
  description: string;
  invoice: string;
  amount: number;
}

export function buildSupplierPayments(suppliers: Supplier[], purchases: SupplierPurchase[], range: DateRange): SupplierPaymentRow[] {
  const names = new Map(suppliers.map((s) => [s.id, s.name]));
  return purchases
    .filter((p) => p.amount < 0 && inRange(dayOf(p.purchaseDate || p.createdAt), range))
    .map((p) => ({
      id: p.id,
      date: dayOf(p.purchaseDate || p.createdAt),
      supplier: names.get(p.supplierId) || 'Deleted supplier',
      description: p.description || '',
      invoice: p.invoiceNumber || '',
      amount: round2(-p.amount),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

export type StockStatus = 'out' | 'low' | 'ok';
export type ExpiryStatus = 'expired' | 'expiring' | null;

export interface StockRow {
  id: string;
  sku: string;
  name: string;
  category: string;
  stock: number;
  costPrice: number;
  sellingPrice: number;
  costValue: number;
  retailValue: number;
  status: StockStatus;
  expiryDate: string;
  daysToExpiry: number | null;
  expiry: ExpiryStatus;
  /** Units sold in the last `slowDays` days. */
  soldRecently: number;
  lastSoldDate: string;
}

export interface StockReport {
  rows: StockRow[];
  costValue: number;
  retailValue: number;
  lowCount: number;
  outCount: number;
  expiringCount: number;
  expiredCount: number;
  slowCount: number;
}

export function buildStockReport(args: {
  products: Product[];
  categories: Category[];
  orders: Order[];
  orderItems: OrderItem[];
  slowDays: number;
  expiryDays: number;
  today?: string;
}): StockReport {
  const { products, categories, orders, orderItems, slowDays, expiryDays } = args;
  const today = args.today || todayLocal();
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const orderDay = new Map<string, string>();
  for (const o of orders) if (o.status !== 'refunded') orderDay.set(o.id, dayOf(o.createdAt));

  const recent = new Map<string, number>();
  const lastSold = new Map<string, string>();
  for (const item of orderItems) {
    const day = orderDay.get(item.orderId);
    if (!day) continue;
    if (day > (lastSold.get(item.productId) || '')) lastSold.set(item.productId, day);
    if (daysBetween(day, today) < slowDays) recent.set(item.productId, (recent.get(item.productId) || 0) + item.quantity);
  }

  let costValue = 0;
  let retailValue = 0;
  let lowCount = 0;
  let outCount = 0;
  let expiringCount = 0;
  let expiredCount = 0;
  let slowCount = 0;

  const rows = products.map((p): StockRow => {
    const units = Math.max(p.stockQuantity, 0);
    const status: StockStatus = p.stockQuantity <= 0 ? 'out' : p.stockQuantity <= p.lowStockThreshold ? 'low' : 'ok';
    const daysToExpiry = p.expiryDate ? daysBetween(today, dayOf(p.expiryDate)) : null;
    const expiry: ExpiryStatus =
      daysToExpiry === null || units === 0 ? null : daysToExpiry < 0 ? 'expired' : daysToExpiry <= expiryDays ? 'expiring' : null;
    const soldRecently = recent.get(p.id) || 0;

    costValue += units * p.costPrice;
    retailValue += units * p.sellingPrice;
    if (status === 'out') outCount += 1;
    if (status === 'low') lowCount += 1;
    if (expiry === 'expired') expiredCount += 1;
    if (expiry === 'expiring') expiringCount += 1;
    if (units > 0 && soldRecently === 0) slowCount += 1;

    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      category: categoryName.get(p.categoryId) || 'Uncategorised',
      stock: p.stockQuantity,
      costPrice: p.costPrice,
      sellingPrice: p.sellingPrice,
      costValue: round2(units * p.costPrice),
      retailValue: round2(units * p.sellingPrice),
      status,
      expiryDate: p.expiryDate ? dayOf(p.expiryDate) : '',
      daysToExpiry,
      expiry,
      soldRecently,
      lastSoldDate: lastSold.get(p.id) || '',
    };
  });

  return {
    rows: rows.sort((a, b) => a.name.localeCompare(b.name)),
    costValue: round2(costValue),
    retailValue: round2(retailValue),
    lowCount,
    outCount,
    expiringCount,
    expiredCount,
    slowCount,
  };
}
