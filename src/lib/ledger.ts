import type { Customer, CustomerTransaction, Supplier, SupplierPurchase } from '@/types/pos';
import { toLocalISODate, withLocalDate } from '@/lib/dates';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A customer ledger entry reversing a credit bill (cancelled, edited or returned) rather than a real payment. */
export const isCreditReversal = (t: Pick<CustomerTransaction, 'type' | 'description'>) =>
  t.type === 'payment' && /^credit reversal/i.test(t.description || '');

/**
 * What one customer ledger entry does to the customer's totals. Same rules as the database
 * trigger pos_customer_tx_totals (MULTI_PC_SETUP.sql), so the figures on screen always match
 * the ones the database keeps:
 *   - a credit sale adds to credit;
 *   - a "Credit reversal ..." entry takes that amount off credit again;
 *   - any other payment adds to paid.
 */
export function customerTxEffect(t: Pick<CustomerTransaction, 'type' | 'amount' | 'description'>): {
  credit: number;
  paid: number;
} {
  if (t.type === 'credit') return { credit: t.amount, paid: 0 };
  if (isCreditReversal(t)) return { credit: -t.amount, paid: 0 };
  return { credit: 0, paid: t.amount };
}

/**
 * The customer after ledger entries are removed and/or added (an edit is a removal of the old
 * entry plus an addition of the new one). Use inside a functional setState so quick successive
 * changes never start from a stale copy.
 */
export function applyCustomerLedger(
  customer: Customer,
  change: { removed?: Array<Pick<CustomerTransaction, 'type' | 'amount' | 'description'>>; added?: Array<Pick<CustomerTransaction, 'type' | 'amount' | 'description'>> }
): Customer {
  let credit = customer.totalCredit;
  let paid = customer.totalPaid;
  for (const t of change.removed || []) {
    const e = customerTxEffect(t);
    credit -= e.credit;
    paid -= e.paid;
  }
  for (const t of change.added || []) {
    const e = customerTxEffect(t);
    credit += e.credit;
    paid += e.paid;
  }
  credit = round2(credit);
  paid = round2(paid);
  return { ...customer, totalCredit: credit, totalPaid: paid, balance: round2(credit - paid) };
}

/**
 * What one supplier ledger entry does to the supplier's totals. Same rules as the database
 * trigger pos_supplier_purchase_totals: positive amounts are purchases, negative amounts are
 * payments to the supplier.
 */
export function supplierEntryEffect(p: Pick<SupplierPurchase, 'amount'>): { purchased: number; paid: number } {
  return p.amount >= 0 ? { purchased: p.amount, paid: 0 } : { purchased: 0, paid: -p.amount };
}

/** A money amount for a ledger entry: a finite number above zero with at most two decimals. */
export function isValidAmount(n: number): boolean {
  return Number.isFinite(n) && n > 0 && Math.abs(Math.round(n * 100) - n * 100) < 1e-6;
}

/** Reads an amount typed into a form; null when it is not a valid amount (see isValidAmount). */
export function parseAmount(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return isValidAmount(n) ? round2(n) : null;
}

/**
 * Card fee on a customer payment. The fee is charged on top of the amount, so the amount still
 * comes off the balance in full. Cash payments have no fee.
 */
export function customerPaymentCharges(
  amount: number,
  method: 'cash' | 'card',
  cardFeeRate: number
): Pick<CustomerTransaction, 'cardFeeRate' | 'cardFeeAmount' | 'totalCharged'> {
  if (method !== 'card') return { cardFeeRate: undefined, cardFeeAmount: undefined, totalCharged: round2(amount) };
  const rate = Number.isFinite(cardFeeRate) && cardFeeRate > 0 ? cardFeeRate : 0;
  const fee = round2((amount * rate) / 100);
  return { cardFeeRate: rate || undefined, cardFeeAmount: fee || undefined, totalCharged: round2(amount + fee) };
}

/**
 * A customer ledger entry after an edit, and the database columns that change. Changing the amount
 * or method of a payment recomputes its card fee: a card payment keeps the rate it was taken with,
 * switching to card uses `cardFeePercent` (today's rate), cash has no fee. `date` (YYYY-MM-DD) moves
 * the entry to that calendar day, keeping its local time of day. Inputs are assumed valid.
 */
export function editedCustomerTransaction(
  old: CustomerTransaction,
  updates: { amount?: number; description?: string; paymentMethod?: 'cash' | 'card'; date?: string },
  cardFeePercent: number
): { next: CustomerTransaction; dbUpdates: Record<string, unknown> } {
  const amount = updates.amount !== undefined ? round2(updates.amount) : old.amount;
  const description = updates.description?.trim() || old.description;
  const paymentMethod = old.type === 'payment' ? updates.paymentMethod ?? old.paymentMethod : old.paymentMethod;
  const createdAt =
    updates.date !== undefined && updates.date !== toLocalISODate(new Date(old.createdAt))
      ? withLocalDate(old.createdAt, updates.date)
      : old.createdAt;

  const feesChanged =
    old.type === 'payment' && paymentMethod !== undefined && (amount !== old.amount || paymentMethod !== old.paymentMethod);
  const fees = feesChanged
    ? customerPaymentCharges(amount, paymentMethod, old.paymentMethod === 'card' ? old.cardFeeRate ?? 0 : cardFeePercent)
    : { cardFeeRate: old.cardFeeRate, cardFeeAmount: old.cardFeeAmount, totalCharged: old.totalCharged };
  const next: CustomerTransaction = { ...old, amount, description, paymentMethod, ...fees, createdAt };

  const dbUpdates: Record<string, unknown> = {};
  if (amount !== old.amount) dbUpdates.amount = amount;
  if (description !== old.description) dbUpdates.description = description;
  if (paymentMethod !== old.paymentMethod) dbUpdates.payment_method = paymentMethod ?? null;
  if (feesChanged) {
    dbUpdates.card_fee_rate = fees.cardFeeRate ?? 0;
    dbUpdates.card_fee_amount = fees.cardFeeAmount ?? 0;
    dbUpdates.total_charged = fees.totalCharged ?? null;
  }
  if (createdAt !== old.createdAt) dbUpdates.created_at = createdAt;
  return { next, dbUpdates };
}

/**
 * A supplier ledger entry after an edit, and the database columns that change. The description is
 * never emptied (the database requires one); an empty invoice number clears it. Inputs are assumed valid.
 */
export function editedSupplierPurchase(
  old: SupplierPurchase,
  updates: { amount?: number; description?: string; purchaseDate?: string; invoiceNumber?: string }
): { next: SupplierPurchase; dbUpdates: Record<string, unknown> } {
  const next: SupplierPurchase = {
    ...old,
    amount: updates.amount !== undefined ? round2(updates.amount) : old.amount,
    description: updates.description?.trim() || old.description,
    purchaseDate: updates.purchaseDate ?? old.purchaseDate,
    invoiceNumber: updates.invoiceNumber !== undefined ? updates.invoiceNumber.trim() || undefined : old.invoiceNumber,
  };
  const dbUpdates: Record<string, unknown> = {};
  if (next.amount !== old.amount) dbUpdates.amount = next.amount;
  if (next.description !== old.description) dbUpdates.description = next.description;
  if (next.purchaseDate !== old.purchaseDate) dbUpdates.purchase_date = next.purchaseDate;
  if (next.invoiceNumber !== old.invoiceNumber) dbUpdates.invoice_number = next.invoiceNumber ?? null;
  return { next, dbUpdates };
}

/**
 * A purchase entry made by Inventory → Receive Supplier Stock, which also added the stock. Editing
 * or deleting the entry does not change stock. Recognised by the description that screen writes
 * ("Stock intake ...") or its auto-generated invoice number (INV-YYYYMMDD-NNNNNN).
 */
export const isStockIntakeEntry = (p: Pick<SupplierPurchase, 'amount' | 'description' | 'invoiceNumber'>) =>
  p.amount >= 0 && (/^stock intake/i.test(p.description || '') || /^INV-\d{8}-\d{6}$/.test(p.invoiceNumber || ''));

/** The supplier after ledger entries are removed and/or added. See applyCustomerLedger. */
export function applySupplierLedger(
  supplier: Supplier,
  change: { removed?: Array<Pick<SupplierPurchase, 'amount'>>; added?: Array<Pick<SupplierPurchase, 'amount'>> }
): Supplier {
  let purchased = supplier.totalPurchased;
  let paid = supplier.totalPaid;
  for (const p of change.removed || []) {
    const e = supplierEntryEffect(p);
    purchased -= e.purchased;
    paid -= e.paid;
  }
  for (const p of change.added || []) {
    const e = supplierEntryEffect(p);
    purchased += e.purchased;
    paid += e.paid;
  }
  purchased = round2(purchased);
  paid = round2(paid);
  return { ...supplier, totalPurchased: purchased, totalPaid: paid, balance: round2(purchased - paid) };
}
