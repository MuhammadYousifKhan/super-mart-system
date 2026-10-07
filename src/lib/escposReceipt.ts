import { format } from 'date-fns';
import type { Order, OrderItem } from '@/types/pos';
import { getOrderBreakdown } from '@/lib/orderMath';

export type PaperColumns = 32 | 42 | 48;

export interface ReceiptStoreSettings {
  storeName: string;
  address: string;
  phone: string;
  receiptFooterMessage: string;
}

const ESC = 0x1b;
const GS = 0x1d;

// Thermal printers only know a handful of single-byte characters, so everything is reduced to
// plain ASCII. Common typographic symbols get a sensible stand-in; anything else becomes '?'.
const REPLACEMENTS: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
  '•': '-',
  '·': '-',
  '…': '...',
  '⚠': '!',
  ' ': ' ',
};

export function toPrinterAscii(value: string): string {
  let out = '';
  for (const ch of String(value ?? '')) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 10) out += '\n';
    else if (code >= 32 && code < 127) out += ch;
    else if (REPLACEMENTS[ch] !== undefined) out += REPLACEMENTS[ch];
    else if (code === 9 || code === 13) out += ' ';
    else out += '?';
  }
  return out;
}

export function formatMoney(amount: number): string {
  return `PKR ${amount.toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** Word-wraps to `width`, splitting words that are longer than a whole line. */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of toPrinterAscii(text).split('\n')) {
    let current = '';
    for (const word of paragraph.split(' ').filter(Boolean)) {
      let w = word;
      while (w.length > width) {
        if (current) {
          lines.push(current);
          current = '';
        }
        lines.push(w.slice(0, width));
        w = w.slice(width);
      }
      if (!current) current = w;
      else if (current.length + 1 + w.length <= width) current += ` ${w}`;
      else {
        lines.push(current);
        current = w;
      }
    }
    lines.push(current);
  }
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

class EscPosBuilder {
  private bytes: number[] = [];

  constructor(readonly cols: number) {}

  raw(...b: number[]) {
    this.bytes.push(...b);
    return this;
  }

  init() {
    return this.raw(ESC, 0x40, ESC, 0x74, 0x00); // reset, code page PC437
  }

  align(a: 'left' | 'center' | 'right') {
    return this.raw(ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2);
  }

  bold(on: boolean) {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  /** 1 = normal, 2 = double width and height. */
  size(n: 1 | 2) {
    return this.raw(GS, 0x21, n === 2 ? 0x11 : 0x00);
  }

  text(s: string) {
    for (const ch of toPrinterAscii(s)) this.bytes.push(ch.charCodeAt(0));
    return this;
  }

  line(s = '') {
    return this.text(s).raw(0x0a);
  }

  /** Wrapped lines, each at most `cols` wide (or `width` if given). */
  wrapped(s: string, width = this.cols) {
    for (const l of wrapText(s, width)) this.line(l);
    return this;
  }

  rule(ch = '-') {
    return this.line(ch.repeat(this.cols));
  }

  /** `left` on the left edge, `right` flush right; left is wrapped if the two don't fit. */
  row(left: string, right: string) {
    const l = toPrinterAscii(left);
    const r = toPrinterAscii(right);
    const room = this.cols - r.length - 1;
    if (l.length <= room) {
      return this.line(l + ' '.repeat(this.cols - l.length - r.length) + r);
    }
    const parts = wrapText(l, Math.max(room, 1));
    parts.forEach((p, i) => {
      if (i === parts.length - 1) this.line(p + ' '.repeat(Math.max(this.cols - p.length - r.length, 1)) + r);
      else this.line(p);
    });
    return this;
  }

  feed(n: number) {
    return this.raw(ESC, 0x64, n);
  }

  cut() {
    return this.raw(GS, 0x56, 66, 0); // feed to cutting position, then cut
  }

  build() {
    return new Uint8Array(this.bytes);
  }
}

export function buildReceiptBytes(
  order: Order,
  items: OrderItem[],
  settings: ReceiptStoreSettings,
  cols: PaperColumns = 48
): Uint8Array {
  const b = new EscPosBuilder(cols);
  const breakdown = getOrderBreakdown(order, items);
  const created = new Date(order.createdAt);

  b.init();

  // Header
  b.align('center').bold(true);
  const name = toPrinterAscii(settings.storeName).toUpperCase();
  if (name.length <= Math.floor(cols / 2)) b.size(2).line(name).size(1);
  else b.wrapped(name);
  b.bold(false);
  if (settings.address) b.wrapped(settings.address);
  if (settings.phone) b.line(`Tel: ${settings.phone}`);
  b.rule('=');
  b.bold(true).line('INVOICE').line(`#${order.id.slice(-8).toUpperCase()}`).bold(false);
  b.align('left').rule('-');

  // Order info
  b.row('Date:', format(created, 'dd MMM yyyy'));
  b.row('Time:', format(created, 'hh:mm a'));
  b.row('Cashier:', order.cashierName || '');
  if (order.clientName) b.row('Customer:', order.clientName);
  if (order.clientPhone) b.row('Phone:', order.clientPhone);
  b.rule('-');

  // Items
  b.bold(true).line('ITEMS').bold(false).rule('-');
  items.forEach((item, i) => {
    b.bold(true).wrapped(`${i + 1}. ${item.productName}`).bold(false);
    const lineTotal = item.unitPriceAtSale * item.quantity;
    b.row(`   ${item.quantity} x ${formatMoney(item.unitPriceAtSale)}`, formatMoney(lineTotal));
    if (item.discountAmount > 0) b.row('   Item discount', `-${formatMoney(item.discountAmount)}`);
  });
  b.rule('-');

  // Totals
  b.row('Subtotal:', formatMoney(breakdown.subtotal));
  if (breakdown.discount > 0) b.row('Discount:', `-${formatMoney(breakdown.discount)}`);
  b.row(`Tax (${breakdown.taxRate}%):`, formatMoney(order.taxAmount));
  if (breakdown.cardFee > 0) b.row(`Card Fee (${order.cardFeeRate ?? 0}%):`, formatMoney(breakdown.cardFee));
  b.rule('=');
  b.bold(true);
  if (cols >= 42) {
    // Double size halves the column count, so build the row for cols / 2.
    const label = 'TOTAL:';
    const value = formatMoney(order.totalAmount);
    const half = Math.floor(cols / 2);
    const gap = Math.max(half - label.length - value.length, 1);
    b.size(2).line(label + ' '.repeat(gap) + value).size(1);
  } else {
    b.row('TOTAL:', formatMoney(order.totalAmount));
  }
  b.bold(false).rule('=');

  // Payment
  b.row('Payment:', `${order.paymentMethod.toUpperCase()}${order.transferType ? ` (${order.transferType.toUpperCase()})` : ''}`);
  if (order.transactionId) b.row('TID:', order.transactionId);
  if (order.paymentMethod === 'cash' && order.amountTendered) {
    b.row('Cash:', formatMoney(order.amountTendered));
    b.row('Change:', formatMoney(order.changeGiven || 0));
  }
  if (order.status === 'credit') {
    b.rule('-').align('center').bold(true).line('*** CREDIT SALE ***').line('PAYMENT PENDING').bold(false).align('left');
  }

  // Footer
  b.rule('-').align('center');
  if (settings.receiptFooterMessage) b.bold(true).wrapped(settings.receiptFooterMessage).bold(false);
  b.line(`Generated: ${format(new Date(), 'dd MMM yyyy hh:mm a')}`);
  b.rule('-');
  b.bold(true).line('Team Axioms').bold(false).line('Contact: 03367544180');

  b.align('left').feed(3).cut();
  return b.build();
}

/** A short page used to check the connection, the paper width and the cutter. */
export function buildTestPageBytes(storeName: string, printerName: string, cols: PaperColumns): Uint8Array {
  const b = new EscPosBuilder(cols);
  b.init().align('center').bold(true).size(2).line('TEST PRINT').size(1).bold(false);
  b.wrapped(storeName).wrapped(`Printer: ${printerName}`);
  b.line(format(new Date(), 'dd MMM yyyy hh:mm a'));
  b.align('left').rule('=');
  b.line('Ruler (should fit on one line):');
  const ruler = '1234567890'.repeat(5).slice(0, cols);
  b.line(ruler);
  b.row('Left text', 'Right text');
  b.bold(true).line('Bold text').bold(false).line('Normal text');
  b.rule('=').align('center').line('If you can read this, printing works.').align('left');
  b.feed(3).cut();
  return b.build();
}
