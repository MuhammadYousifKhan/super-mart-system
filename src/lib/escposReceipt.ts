import { format } from 'date-fns';
import type { Order, OrderItem } from '@/types/pos';
import { getExchangeBreakdown, getOrderBreakdown } from '@/lib/orderMath';
import { billNumber } from '@/lib/exchange';

export type PaperColumns = 32 | 42 | 48;

export interface ReceiptStoreSettings {
  storeName: string;
  address: string;
  phone: string;
  receiptFooterMessage: string;
}

const ESC = 0x1b;
const GS = 0x1d;
// Font A is 24 dots tall; printers default to 30-34 dots per line. 28 keeps a small gap between
// lines (also on 180 dpi heads) while using noticeably less paper per receipt.
const LINE_SPACING_DOTS = 28;

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
    return this.raw(ESC, 0x40, ESC, 0x74, 0x00) // reset, code page PC437
      .raw(GS, 0x50, 0, 203) // vertical motion unit 1/203 inch (one dot on 203 dpi printers)
      .raw(ESC, 0x33, LINE_SPACING_DOTS); // tighter line spacing than the default ~1/6 inch
  }

  align(a: 'left' | 'center' | 'right') {
    return this.raw(ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2);
  }

  bold(on: boolean) {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  /** 1 = normal, 2 = double width and height. */
  size(n: 1 | 2) {
    // Line spacing follows the text height, so a double-height line never overlaps the next one.
    return this.raw(GS, 0x21, n === 2 ? 0x11 : 0x00).raw(ESC, 0x33, LINE_SPACING_DOTS * n);
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

/** Negative amounts print as "-PKR 1,000" (not "PKR -1,000"), like discounts. */
const signedMoney = (amount: number) => (amount < 0 ? `-${formatMoney(-amount)}` : formatMoney(amount));

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
  // Title and bill number share one line to save paper.
  if (breakdown.isExchange) {
    b.bold(true).wrapped(`EXCHANGE / RETURN #${billNumber(order.id)}`).bold(false);
    b.line(`Against bill #${billNumber(order.originalOrderId || '')}`);
  } else {
    b.bold(true).line(`INVOICE #${order.id.slice(-8).toUpperCase()}`).bold(false);
  }
  b.align('left').rule('-');

  // Order info
  b.row(`Date: ${format(created, 'dd MMM yyyy')}`, format(created, 'hh:mm a'));
  b.row('Cashier:', order.cashierName || '');
  if (order.clientName) b.row('Customer:', order.clientName);
  if (order.clientPhone) b.row('Phone:', order.clientPhone);
  b.rule('-');

  if (breakdown.isExchange) {
    printExchangeBody(b, order, items);
  } else {
    printSaleBody(b, order, items, breakdown);
  }

  // Footer
  b.rule('-').align('center');
  if (settings.receiptFooterMessage) b.bold(true).wrapped(settings.receiptFooterMessage).bold(false);
  b.wrapped('Aceva Technology - +92 305 555 2230');

  // The cut command itself feeds the last line past the cutter, so no blank lines are added.
  b.align('left').cut();
  return b.build();
}

/** One item: a single line when the quantity is 1, otherwise the name and then "qty x price". */
function printItemLine(b: EscPosBuilder, index: number, name: string, quantity: number, unitPrice: number, total: string) {
  if (quantity === 1) {
    b.bold(true).row(`${index + 1}. ${name}`, total).bold(false);
  } else {
    b.bold(true).wrapped(`${index + 1}. ${name}`).bold(false);
    b.row(`   ${quantity} x ${formatMoney(unitPrice)}`, total);
  }
}

/** The grand total, in double size when it fits on a wide roll. */
function printBigTotal(b: EscPosBuilder, label: string, value: string) {
  const half = Math.floor(b.cols / 2);
  b.bold(true);
  if (b.cols >= 42 && label.length + 1 + value.length <= half) {
    // Double size halves the column count, so build the row for cols / 2.
    const gap = value ? Math.max(half - label.length - value.length, 1) : 0;
    b.size(2).line(label + ' '.repeat(gap) + value).size(1);
  } else {
    b.row(label, value);
  }
  b.bold(false);
}

/** Items, totals and payment of a normal sale. */
function printSaleBody(b: EscPosBuilder, order: Order, items: OrderItem[], breakdown: ReturnType<typeof getOrderBreakdown>) {
  // Items (the rule above the list already separates them from the order info)
  items.forEach((item, i) => {
    const lineTotal = item.unitPriceAtSale * item.quantity;
    printItemLine(b, i, item.productName, item.quantity, item.unitPriceAtSale, formatMoney(lineTotal));
    if (item.discountAmount > 0) b.row('   Item discount', `-${formatMoney(item.discountAmount)}`);
  });
  b.rule('-');

  // Totals. Subtotal is only worth a line when something changes it; a zero tax is left out.
  const hasTax = Math.abs(order.taxAmount) >= 0.005;
  if (breakdown.discount > 0 || hasTax || breakdown.cardFee > 0) {
    b.row('Subtotal:', formatMoney(breakdown.subtotal));
    if (breakdown.discount > 0) b.row('Discount:', `-${formatMoney(breakdown.discount)}`);
    if (hasTax) b.row(`Tax (${breakdown.taxRate}%):`, formatMoney(order.taxAmount));
    if (breakdown.cardFee > 0) b.row(`Card Fee (${order.cardFeeRate ?? 0}%):`, formatMoney(breakdown.cardFee));
  }
  printBigTotal(b, 'TOTAL:', formatMoney(order.totalAmount));
  b.rule('-');

  // Payment
  b.row('Payment:', `${order.paymentMethod.toUpperCase()}${order.transferType ? ` (${order.transferType.toUpperCase()})` : ''}`);
  if (order.transactionId) b.row('TID:', order.transactionId);
  if (order.paymentMethod === 'cash' && order.amountTendered) {
    b.row('Cash:', formatMoney(order.amountTendered));
    b.row('Change:', formatMoney(order.changeGiven || 0));
  }
  if (order.status === 'credit') {
    b.align('center').bold(true).wrapped('*** CREDIT SALE - PAYMENT PENDING ***').bold(false).align('left');
  }
}

/**
 * Items, totals and settlement of an exchange/return: the goods that came back (quantities shown
 * as positive, amounts as negative), the new goods, the tax line and what changed hands.
 */
function printExchangeBody(b: EscPosBuilder, order: Order, items: OrderItem[]) {
  const ex = getExchangeBreakdown(order, items);

  if (ex.returned.length > 0) {
    b.bold(true).line('RETURNED:').bold(false);
    ex.returned.forEach((l, i) => {
      printItemLine(b, i, l.item.productName, l.quantity, l.item.unitPriceAtSale, `-${formatMoney(l.gross)}`);
      // The discount they had on these goods isn't refunded.
      if (l.discount > 0.005) b.row('   Less discount', `+${formatMoney(l.discount)}`);
    });
    b.rule('-');
  }

  if (ex.added.length > 0) {
    b.bold(true).line('NEW ITEMS:').bold(false);
    ex.added.forEach((l, i) => {
      printItemLine(b, i, l.item.productName, l.quantity, l.item.unitPriceAtSale, formatMoney(l.gross));
      if (l.discount > 0.005) b.row('   Item discount', `-${formatMoney(l.discount)}`);
    });
    b.rule('-');
  }

  // Totals (a zero tax is left out)
  b.row('Returned:', `-${formatMoney(ex.returnedNet)}`);
  if (ex.added.length > 0) b.row('New items:', formatMoney(ex.newNet));
  if (Math.abs(ex.tax) >= 0.005) b.row('Tax:', signedMoney(ex.tax));
  if (ex.cardFee > 0) b.row(`Card Fee (${order.cardFeeRate ?? 0}%):`, formatMoney(ex.cardFee));
  const label = ex.settlement === 'Even exchange' ? 'EVEN EXCHANGE' : `${ex.settlement.toUpperCase()}:`;
  const value = ex.settlement === 'Even exchange' ? '' : formatMoney(ex.settlementAmount);
  printBigTotal(b, label, value);
  b.rule('-');

  // How the difference was settled
  if (ex.settledVia) b.row(`${ex.settledVia.label}:`, ex.settledVia.method.toUpperCase());
  if (order.transactionId) b.row('TID:', order.transactionId);
  if (order.paymentMethod === 'cash' && order.amountTendered) {
    b.row('Cash:', formatMoney(order.amountTendered));
    b.row('Change:', formatMoney(order.changeGiven || 0));
  }
  if (order.status === 'credit') {
    b.align('center').bold(true).wrapped('*** ADDED TO ACCOUNT - PAYMENT PENDING ***').bold(false).align('left');
  }
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
  b.rule('=').align('center').line('If you can read this, printing works.');
  b.line('This last line must not be cut off.').align('left');
  b.cut();
  return b.build();
}
