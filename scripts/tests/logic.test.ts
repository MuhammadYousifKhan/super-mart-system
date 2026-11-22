// Logic tests (no test runner in this project): run with `npm run test:logic`.
// Covers error classification, backoff, chunking, log redaction, queue ordering and opening balances.
import assert from 'node:assert/strict';
import { classifySyncError, backoffDelayMs, chunk, isConnectionProblem, isPermanentProblem } from '@/lib/syncErrors';
import { redact, serializeError } from '@/lib/logger';
import { orderQueue } from '@/lib/syncQueueStore';
import {
  applyCustomerLedger,
  applySupplierLedger,
  buildOpeningBalanceEntry,
  buildSupplierOpeningEntry,
  isOpeningBalance,
  openingBalanceError,
} from '@/lib/ledger';
import { buildCustomerOutstanding, buildCustomerPayments, buildCustomerLedger } from '@/lib/reports';
import { acceptRemoteEntry, __resetRemoteLogForTests, __remoteDropped } from '@/lib/remoteLog';
import type { Customer, Supplier } from '@/types/pos';

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

// --- error classification -------------------------------------------------
test('classifies auth errors and does not treat them as connection problems', () => {
  assert.equal(classifySyncError({ message: 'JWT expired', status: 401 }, true).kind, 'auth');
  assert.equal(classifySyncError(new Error('Invalid Refresh Token: Refresh Token Not Found'), true).kind, 'auth');
});
test('classifies database rejections by code', () => {
  assert.equal(classifySyncError({ message: 'x', code: '42501' }, true).kind, 'rls');
  assert.equal(classifySyncError({ message: 'x', code: '23503' }, true).kind, 'fk');
  assert.equal(classifySyncError({ message: 'x', code: '23505' }, true).kind, 'conflict');
  assert.equal(classifySyncError({ message: 'x', code: '23502' }, true).kind, 'validation');
  for (const code of ['42P01', '42703', 'PGRST204', 'PGRST202']) {
    const c = classifySyncError({ message: 'x', code }, true);
    assert.equal(c.kind, 'schema', code);
    assert.ok(isPermanentProblem(c.kind));
  }
});
test('classifies network and timeout problems', () => {
  assert.equal(classifySyncError(new TypeError('Failed to fetch'), true).kind, 'network');
  assert.equal(classifySyncError(new Error('Request timed out'), true).kind, 'timeout');
  assert.equal(classifySyncError(new Error('anything'), false).kind, 'network'); // offline
  assert.ok(isConnectionProblem('network') && isConnectionProblem('timeout') && !isConnectionProblem('auth'));
  assert.equal(classifySyncError({ message: 'bad gateway', status: 502 }, true).kind, 'network');
  assert.equal(classifySyncError(new Error('something odd'), true).kind, 'unknown');
});
test('keeps code, details and hint of a Supabase error', () => {
  const c = classifySyncError({ message: 'm', code: '23503', details: 'Key is not present', hint: 'h' }, true);
  assert.equal(c.detail.code, '23503');
  assert.equal(c.detail.details, 'Key is not present');
  assert.equal(c.detail.hint, 'h');
});

// --- backoff and chunking ---------------------------------------------------
test('backoff doubles from 2 s and caps at 60 s', () => {
  const none = () => 0;
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 20].map((n) => backoffDelayMs(n, none)), [2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  assert.ok(backoffDelayMs(3, () => 1) <= 8000 * 1.25 + 1);
});
test('chunk splits without losing or reordering items', () => {
  const items = Array.from({ length: 2000 }, (_, i) => i);
  const parts = chunk(items, 200);
  assert.equal(parts.length, 10);
  assert.ok(parts.every((p) => p.length === 200));
  assert.deepEqual(parts.flat(), items);
  assert.deepEqual(chunk([1, 2, 3], 2), [[1, 2], [3]]);
  assert.deepEqual(chunk([], 5), []);
  assert.throws(() => chunk([1], 0));
});

// --- redaction --------------------------------------------------------------
test('redaction removes secrets by key and JWT-looking text', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdEFGH1234';
  const out = redact({
    password: 'hunter2',
    access_token: jwt,
    nested: { Authorization: 'Bearer abc', apikey: 'k', ok: 'fine' },
    text: `failed with ${jwt} in the message`,
    list: [{ refresh_token: 'r' }],
  }) as Record<string, any>;
  const json = JSON.stringify(out);
  assert.ok(!json.includes('hunter2') && !json.includes('eyJ') && !json.includes('Bearer abc'));
  assert.equal(out.nested.ok, 'fine');
  assert.equal(out.list[0].refresh_token, '[redacted]');
});
test('serializeError keeps useful fields only', () => {
  const e = serializeError({ name: 'PostgrestError', message: 'boom', code: '42P01', hint: 'run setup', extra: 'ignored' });
  assert.deepEqual(e, { name: 'PostgrestError', message: 'boom', code: '42P01', hint: 'run setup' });
});

// --- queue ordering ----------------------------------------------------------
test('queue order follows seq, then keeps legacy order', () => {
  const rows = [
    { id: 'c', createdAt: '2026-01-01T00:00:00.000Z', seq: 3 },
    { id: 'a', createdAt: '2026-01-01T00:00:00.000Z' }, // legacy, no seq
    { id: 'b', createdAt: '2026-01-01T00:00:00.000Z' }, // legacy, no seq
    { id: 'd', createdAt: '2026-01-01T00:00:00.000Z', seq: 4 },
  ];
  assert.deepEqual(orderQueue(rows).map((r) => r.id), ['a', 'b', 'c', 'd']);
});

// --- opening balances --------------------------------------------------------
const customer = (): Customer => ({
  id: 'c1', name: 'Ali', phone: '1', address: 'x', createdAt: '2026-01-01T00:00:00.000Z', totalCredit: 0, totalPaid: 0, balance: 0,
});

test('opening balance "owes" is a credit entry dated at the start of the chosen day', () => {
  const e = buildOpeningBalanceEntry({ id: 't1', customerId: 'c1', amount: 15000, direction: 'owes', asOfDate: '2026-03-05', note: 'Book page 14' });
  assert.equal(e.type, 'credit');
  assert.equal(e.orderId, undefined);
  assert.equal(e.paymentMethod, undefined);
  assert.ok(isOpeningBalance(e));
  assert.match(e.description, /^Opening balance \(from ledger book\) - Book page 14$/);
  const d = new Date(e.createdAt);
  assert.deepEqual([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()], [2026, 3, 5, 0, 0]);
});
test('balances: 15000 owed, +2000 credit sale, -5000 payment = 12000', () => {
  let c = applyCustomerLedger(customer(), { added: [buildOpeningBalanceEntry({ id: 't1', customerId: 'c1', amount: 15000, direction: 'owes', asOfDate: '2026-03-05' })] });
  assert.equal(c.balance, 15000);
  c = applyCustomerLedger(c, { added: [{ type: 'credit', amount: 2000, description: 'Credit sale - Order #X' }] });
  assert.equal(c.balance, 17000);
  c = applyCustomerLedger(c, { added: [{ type: 'payment', amount: 5000, description: 'Cash payment received' }] });
  assert.equal(c.balance, 12000);
});
test('an advance makes the balance negative and has no payment method', () => {
  const e = buildOpeningBalanceEntry({ id: 't2', customerId: 'c1', amount: 3000, direction: 'advance', asOfDate: '2026-03-05' });
  assert.equal(e.type, 'payment');
  assert.equal(e.paymentMethod, undefined);
  const c = applyCustomerLedger(customer(), { added: [e] });
  assert.equal(c.balance, -3000);
  assert.equal(c.totalPaid, 3000);
});
test('removing the opening entry restores the balance (edit = remove + add)', () => {
  const e = buildOpeningBalanceEntry({ id: 't1', customerId: 'c1', amount: 15000, direction: 'owes', asOfDate: '2026-03-05' });
  const withIt = applyCustomerLedger(customer(), { added: [e] });
  assert.equal(applyCustomerLedger(withIt, { removed: [e] }).balance, 0);
  assert.equal(applyCustomerLedger(withIt, { removed: [e], added: [{ ...e, amount: 12000 }] }).balance, 12000);
});
test('opening balance validation: amount, date, future, and only one', () => {
  const ok = { amount: 100, direction: 'owes' as const, asOfDate: '2026-03-05' };
  assert.equal(openingBalanceError(ok, [], '2026-11-23'), null);
  assert.ok(openingBalanceError({ ...ok, amount: 0 }, [], '2026-11-23'));
  assert.ok(openingBalanceError({ ...ok, amount: 10.123 }, [], '2026-11-23'));
  assert.ok(openingBalanceError({ ...ok, amount: -5 }, [], '2026-11-23'));
  assert.ok(openingBalanceError({ ...ok, asOfDate: '2026-02-31' }, [], '2026-11-23'));
  assert.ok(openingBalanceError({ ...ok, asOfDate: '2026-12-01' }, [], '2026-11-23'));
  assert.match(openingBalanceError(ok, [{ description: 'Opening balance (from ledger book)' }], '2026-11-23') ?? '', /already has an opening balance/);
  assert.equal(openingBalanceError(ok, [{ description: 'Cash payment received' }], '2026-11-23'), null);
});
test('payments worded like an opening balance are recognised so they can be refused', () => {
  assert.ok(isOpeningBalance({ description: 'opening balance 2025' }));
  assert.ok(!isOpeningBalance({ description: 'Cash payment received' }));
});

test('reports: opening balance is not cash collected, and ages from its date', () => {
  const owes = buildOpeningBalanceEntry({ id: 'o1', customerId: 'c1', amount: 15000, direction: 'owes', asOfDate: '2026-01-01' });
  const advance = buildOpeningBalanceEntry({ id: 'o2', customerId: 'c2', amount: 3000, direction: 'advance', asOfDate: '2026-01-01' });
  const real = { id: 'p1', customerId: 'c1', type: 'payment' as const, amount: 1000, paymentMethod: 'cash' as const, description: 'Cash payment received', createdAt: '2026-11-20T10:00:00.000Z' };
  const range = { from: '2026-01-01', to: '2026-12-31' };
  const payments = buildCustomerPayments([{ ...customer(), id: 'c1' }, { ...customer(), id: 'c2', name: 'B' }], [owes, advance, real], range);
  assert.deepEqual(payments.map((p) => p.amount), [1000]);

  const c1 = applyCustomerLedger(customer(), { added: [owes, real] });
  const rows = buildCustomerOutstanding([c1], [owes, real], '2026-11-23');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].balance, 14000);
  assert.equal(rows[0].age90plus, 14000); // old book balance is over 90 days old (less the 1000 paid, oldest first)
  assert.equal(rows[0].lastCreditDate, ''); // not a credit sale
  assert.equal(rows[0].lastPaymentDate, '2026-11-20');

  const ledger = buildCustomerLedger('c1', [owes, real], range);
  assert.equal(ledger.entries[0].kind, 'Opening balance');
});

// --- supplier opening balance ------------------------------------------------
test('supplier opening balance: positive when we owe, negative when paid in advance', () => {
  const supplier: Supplier = { id: 's1', name: 'S', phone: '1', address: 'x', createdAt: '2026-01-01T00:00:00.000Z', totalPurchased: 0, totalPaid: 0, balance: 0 };
  const owe = buildSupplierOpeningEntry({ id: 'e1', supplierId: 's1', amount: 8000, direction: 'owes', asOfDate: '2026-02-01' });
  const adv = buildSupplierOpeningEntry({ id: 'e2', supplierId: 's1', amount: 500, direction: 'advance', asOfDate: '2026-02-01' });
  assert.equal(owe.amount, 8000);
  assert.equal(adv.amount, -500);
  assert.equal(owe.purchaseDate, '2026-02-01');
  assert.ok(isOpeningBalance(owe));
  assert.equal(applySupplierLedger(supplier, { added: [owe] }).balance, 8000);
  assert.equal(applySupplierLedger(supplier, { added: [adv] }).balance, -500);
});

// --- central error log throttle -------------------------------------------------
test('remote log accepts only warn/error, never perf, and at most 50 per hour', () => {
  __resetRemoteLogForTests();
  const t0 = 1_000_000;
  assert.equal(acceptRemoteEntry({ level: 'info', cat: 'sync' }, t0), false);
  assert.equal(acceptRemoteEntry({ level: 'debug', cat: 'sync' }, t0), false);
  assert.equal(acceptRemoteEntry({ level: 'warn', cat: 'perf' }, t0), false);
  let accepted = 0;
  for (let i = 0; i < 80; i++) if (acceptRemoteEntry({ level: i % 2 ? 'warn' : 'error', cat: 'sync' }, t0 + i)) accepted++;
  assert.equal(accepted, 50);
  assert.equal(__remoteDropped(), 30);
  // a new hour starts a new allowance
  assert.equal(acceptRemoteEntry({ level: 'error', cat: 'sync' }, t0 + 61 * 60 * 1000), true);
});

console.log(`\n${passed} tests passed`);
