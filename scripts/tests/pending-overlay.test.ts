// Waiting (or set-aside) uploads must survive a cloud refresh. Run with `npm run test:logic`.
import assert from 'node:assert/strict';
import { overlayPendingRows, type OverlayTables } from '@/lib/pendingOverlay';
import type { Order, OrderItem, Product } from '@/types/pos';

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}`);
    throw err;
  }
}

const product = (id: string, stock = 5) => ({ id, sku: id, name: id, stockQuantity: stock }) as unknown as Product;
const order = (id: string, createdAt: string, total = 100) => ({ id, createdAt, totalAmount: total }) as unknown as Order;
const line = (id: string, orderId: string) => ({ id, orderId }) as unknown as OrderItem;
const tables = (t: Partial<OverlayTables>): OverlayTables => ({
  products: [], orders: [], orderItems: [], customers: [], suppliers: [], ...t,
});

test('nothing waiting: the cloud copy is returned unchanged', () => {
  const cloud = tables({ products: [product('a')] });
  const out = overlayPendingRows(cloud, tables({ products: [product('local')] }), []);
  assert.equal(out.products, cloud.products);
});

test('a set-aside new product stays after a refresh', () => {
  const cloud = tables({ products: [product('a')] });
  const local = tables({ products: [product('a'), product('new', 7)] });
  const out = overlayPendingRows(cloud, local, [{ type: 'product_add', payload: { newProduct: product('new') } }]);
  assert.deepEqual(out.products.map((p) => p.id), ['a', 'new']);
  assert.equal(out.products[1].stockQuantity, 7, 'the local version (with later stock changes) is kept');
});

test('a product deleted on this PC meanwhile is not brought back', () => {
  const out = overlayPendingRows(tables({}), tables({}), [{ type: 'product_add', payload: { newProduct: product('gone') } }]);
  assert.equal(out.products.length, 0);
});

test('a waiting sale keeps its lines and the newest-first order', () => {
  const cloud = tables({ orders: [order('o2', '2026-11-02'), order('o1', '2026-11-01')], orderItems: [line('l1', 'o1')] });
  const local = tables({
    orders: [order('o3', '2026-11-03'), ...cloud.orders],
    orderItems: [line('l1', 'o1'), line('l3', 'o3')],
  });
  const out = overlayPendingRows(cloud, local, [{ type: 'order_with_items', payload: { order: order('o3', '2026-11-03') } }]);
  assert.deepEqual(out.orders.map((o) => o.id), ['o3', 'o2', 'o1']);
  assert.deepEqual(out.orderItems.map((i) => i.id).sort(), ['l1', 'l3']);
});

test('a waiting bill edit replaces the cloud version and its lines', () => {
  const cloud = tables({ orders: [order('o1', '2026-11-01', 100)], orderItems: [line('old', 'o1')] });
  const local = tables({ orders: [order('o1', '2026-11-01', 80)], orderItems: [line('new', 'o1')] });
  const out = overlayPendingRows(cloud, local, [{ type: 'order_with_items', payload: { order: order('o1', '2026-11-01') } }]);
  assert.equal(out.orders[0].totalAmount, 80);
  assert.deepEqual(out.orderItems.map((i) => i.id), ['new']);
});

console.log(`\n${passed} pending-overlay tests passed`);
