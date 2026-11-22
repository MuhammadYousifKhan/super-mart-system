import type { Customer, Order, OrderItem, Product, Supplier } from '@/types/pos';

/** The parts of a queued upload this module needs. */
export interface PendingOpLike {
  type: string;
  payload: unknown;
}

export interface OverlayTables {
  products: Product[];
  orders: Order[];
  orderItems: OrderItem[];
  customers: Customer[];
  suppliers: Supplier[];
}

/**
 * Puts this PC's not-yet-uploaded rows back on top of a cloud copy.
 *
 * A cloud copy is applied when every queued upload is either done or set aside after database
 * errors. Set-aside uploads are not in the cloud, so without this a new product (or sale, customer,
 * supplier) disappears from this PC on the next refresh, although it is still waiting to upload.
 * The local version of each such row wins over the cloud one; everything else comes from the cloud.
 */
export function overlayPendingRows(cloud: OverlayTables, local: OverlayTables, ops: PendingOpLike[]): OverlayTables {
  const productIds = new Set<string>();
  const orderIds = new Set<string>();
  const customerIds = new Set<string>();
  const supplierIds = new Set<string>();

  for (const op of ops) {
    const p = op.payload as Record<string, { id?: unknown } | undefined> | null | undefined;
    const id = (key: string) => (typeof p?.[key]?.id === 'string' ? (p[key]!.id as string) : null);
    if (op.type === 'product_add') {
      const v = id('newProduct');
      if (v) productIds.add(v);
    } else if (op.type === 'order_with_items') {
      const v = id('order');
      if (v) orderIds.add(v);
    } else if (op.type === 'customer_add') {
      const v = id('customer');
      if (v) customerIds.add(v);
    } else if (op.type === 'supplier_add') {
      const v = id('supplier');
      if (v) supplierIds.add(v);
    }
  }

  const orders = overlay(cloud.orders, local.orders, orderIds);
  // Waiting sales this PC still has (one deleted here meanwhile keeps the cloud lines).
  const keepLocalLines = new Set(local.orders.filter((o) => orderIds.has(o.id)).map((o) => o.id));
  return {
    products: overlay(cloud.products, local.products, productIds),
    orders: orders === cloud.orders ? orders : [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    orderItems:
      keepLocalLines.size === 0
        ? cloud.orderItems
        : [
            // A waiting sale or bill edit keeps exactly the lines this PC has for it.
            ...cloud.orderItems.filter((i) => !keepLocalLines.has(i.orderId)),
            ...local.orderItems.filter((i) => keepLocalLines.has(i.orderId)),
          ],
    customers: overlay(cloud.customers, local.customers, customerIds, true),
    suppliers: overlay(cloud.suppliers, local.suppliers, supplierIds, true),
  };
}

/** Cloud rows, with the local version of each id in `ids` replacing or added to them. */
function overlay<T extends { id: string }>(cloud: T[], local: T[], ids: Set<string>, newestFirst = false): T[] {
  if (ids.size === 0) return cloud;
  const localById = new Map(local.filter((row) => ids.has(row.id)).map((row) => [row.id, row]));
  if (localById.size === 0) return cloud;
  const merged = cloud.map((row) => localById.get(row.id) ?? row);
  const cloudIds = new Set(cloud.map((row) => row.id));
  const added = [...localById.values()].filter((row) => !cloudIds.has(row.id));
  return newestFirst ? [...added, ...merged] : [...merged, ...added];
}
