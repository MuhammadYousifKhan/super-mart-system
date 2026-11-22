import { billNumber } from '@/lib/exchange';

const TYPE_LABELS: Record<string, string> = {
  order_with_items: 'Sale',
  customer_add: 'New customer',
  customer_update: 'Customer edit',
  customer_delete: 'Customer removal',
  customer_payment: 'Customer payment',
  customer_credit: 'Customer credit',
  customer_transaction_update: 'Ledger entry edit',
  customer_transaction_delete: 'Ledger entry removal',
  customer_reminder_add: 'New reminder',
  customer_reminder_update: 'Reminder edit',
  customer_reminder_delete: 'Reminder removal',
  supplier_add: 'New supplier',
  supplier_update: 'Supplier edit',
  supplier_delete: 'Supplier removal',
  supplier_purchase_add: 'Supplier purchase',
  supplier_purchase_update: 'Supplier purchase edit',
  supplier_purchase_delete: 'Supplier purchase removal',
  supplier_payment_add: 'Supplier payment',
  supplier_stock_receive: 'Stock received',
  supplier_stock_receive_batch: 'Stock received (batch)',
  supplier_schedule_add: 'New payment schedule',
  supplier_schedule_update: 'Payment schedule edit',
  supplier_schedule_delete: 'Payment schedule removal',
  product_add: 'New product',
  product_update: 'Product edit',
  product_delete: 'Product removal',
  db_writes: 'Data update',
  stock_movement: 'Stock change',
};

/** What a waiting change is, in words a shop owner understands, e.g. "Sale #A1B2C3D4". */
export function describeSyncOp(type: string, payload: unknown): string {
  const label = TYPE_LABELS[type] ?? type;
  const orderId = (payload as { order?: { id?: unknown } } | null | undefined)?.order?.id;
  if (type === 'order_with_items' && typeof orderId === 'string') return `${label} #${billNumber(orderId)}`;
  return label;
}
