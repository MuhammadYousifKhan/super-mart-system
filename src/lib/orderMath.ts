import type { Order, OrderItem } from '@/types/pos';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface OrderBreakdown {
  /** Sum of unit price x quantity, before any discount (what the printed item lines add up to). */
  subtotal: number;
  /**
   * Item-level and cart-wide discounts together. On an exchange it can be negative, because
   * returned goods hand back the discount the customer had on them.
   */
  discount: number;
  /** Amount tax was charged on: subtotal - discount. Negative on an exchange that refunds money. */
  taxable: number;
  /**
   * Tax percentage that was actually applied to this order. Always 0 on an exchange: its tax is
   * tax on the new goods less tax refunded on the returned ones, which can be at different rates,
   * so no single rate means anything. Don't print a rate for an exchange.
   */
  taxRate: number;
  cardFee: number;
  /** An exchange/return (see Order.originalOrderId) rather than a normal sale. */
  isExchange: boolean;
}

/**
 * Totals as they should be shown on a bill so the lines add up:
 * subtotal - discount + tax + card fee = total.
 *
 * `order.subtotal` is already net of item discounts while `order.discountAmount`
 * also contains them, so showing both double counts item discounts. This derives
 * the figures from the item lines and the stored total instead. The tax rate is
 * taken from the order itself, so later changes to the store's tax setting don't
 * rewrite old bills.
 */
export function getOrderBreakdown(order: Order, items: OrderItem[]): OrderBreakdown {
  // Same test as isExchangeOrder (lib/exchange), written out because that module imports this one.
  const isExchange = !!order.originalOrderId;
  const cardFee = order.cardFeeAmount || 0;
  const taxable = round2(order.totalAmount - order.taxAmount - cardFee);
  const subtotal =
    items.length > 0
      ? round2(items.reduce((sum, item) => sum + item.unitPriceAtSale * item.quantity, 0))
      : order.subtotal;
  // An exchange's discount is legitimately negative when discounted goods come back, so it is
  // only kept at zero or above on a normal bill.
  const discount = isExchange ? round2(subtotal - taxable) : Math.max(0, round2(subtotal - taxable));
  const taxRate = !isExchange && taxable > 0 ? round2((order.taxAmount / taxable) * 100) : 0;

  return { subtotal, discount, taxable, taxRate, cardFee, isExchange };
}

export interface ExchangeReceiptLine {
  item: OrderItem;
  /** Units, always positive (returned lines are stored with a negative quantity). */
  quantity: number;
  /** Unit price x units, before discount. */
  gross: number;
  /** Discount on the line. For returned goods, the discount the customer had on them. */
  discount: number;
  /**
   * gross - discount. For returned goods this is what the customer had actually paid for them
   * before tax (after item and cart-wide discounts), i.e. what they get back before tax.
   */
  net: number;
}

export interface ExchangeBreakdown {
  /** The bill the goods came back from. */
  originalOrderId: string;
  returned: ExchangeReceiptLine[];
  added: ExchangeReceiptLine[];
  /** What the customer had paid for the returned goods, before tax. Positive. */
  returnedNet: number;
  /** New goods after their item discounts, before tax. */
  newNet: number;
  /** Tax on the new goods less tax refunded on the returned ones (can be negative). */
  tax: number;
  cardFee: number;
  /** newNet - returnedNet + tax + card fee: the difference that changed hands. */
  total: number;
  /** "Customer paid", "Refunded" or "Even exchange". */
  settlement: 'Customer paid' | 'Refunded' | 'Even exchange';
  /** Size of the difference, always positive (0 on an even exchange). */
  settlementAmount: number;
  /** How the difference was settled, e.g. { label: 'Refunded by', method: 'Cash' }. Null on an even exchange. */
  settledVia: { label: string; method: string } | null;
}

/**
 * An exchange/return split into the goods that came back and the goods that went out, for
 * receipts and bill views. Only meaningful for an exchange order (see Order.originalOrderId).
 */
export function getExchangeBreakdown(order: Order, items: OrderItem[]): ExchangeBreakdown {
  const toLine = (item: OrderItem): ExchangeReceiptLine => {
    const quantity = Math.abs(item.quantity);
    const gross = round2(item.unitPriceAtSale * quantity);
    // Line net as stored is negative for returned goods; flip it so both lists read as positive amounts.
    const net = round2((item.quantity < 0 ? -1 : 1) * (item.unitPriceAtSale * item.quantity - item.discountAmount));
    return { item, quantity, gross, discount: round2(gross - net), net };
  };
  const returned = items.filter((i) => i.quantity < 0).map(toLine);
  const added = items.filter((i) => i.quantity > 0).map(toLine);
  const total = order.totalAmount;
  const settlement = total > 0.005 ? 'Customer paid' : total < -0.005 ? 'Refunded' : 'Even exchange';

  const method =
    order.paymentMethod === 'credit'
      ? 'Customer account'
      : order.paymentMethod.charAt(0).toUpperCase() +
        order.paymentMethod.slice(1) +
        (order.transferType ? ` (${order.transferType})` : '');
  const settledVia =
    settlement === 'Even exchange'
      ? null
      : order.paymentMethod === 'credit'
        ? { label: settlement === 'Refunded' ? 'Refunded to' : 'Added to', method }
        : { label: settlement === 'Refunded' ? 'Refunded by' : 'Paid by', method };

  return {
    originalOrderId: order.originalOrderId || '',
    returned,
    added,
    returnedNet: round2(returned.reduce((s, l) => s + l.net, 0)),
    newNet: round2(added.reduce((s, l) => s + l.net, 0)),
    tax: order.taxAmount,
    cardFee: order.cardFeeAmount || 0,
    total,
    settlement,
    settlementAmount: settlement === 'Even exchange' ? 0 : round2(Math.abs(total)),
    settledVia,
  };
}

/**
 * The body of an exchange as plain text lines for sharing on WhatsApp (*bold* markers included),
 * from the item lists down to how the difference was settled. `money` formats a positive amount.
 */
export function exchangeShareLines(order: Order, items: OrderItem[], money: (amount: number) => string): string[] {
  const ex = getExchangeBreakdown(order, items);
  const signed = (n: number) => (n < 0 ? `-${money(-n)}` : money(n));
  const lines: string[] = [];
  if (ex.returned.length > 0) {
    lines.push('*Returned:*');
    ex.returned.forEach((l) => lines.push(`${l.quantity}x ${l.item.productName} - -${money(l.net)}`));
  }
  if (ex.added.length > 0) {
    lines.push('*New items:*');
    ex.added.forEach((l) => lines.push(`${l.quantity}x ${l.item.productName} - ${money(l.net)}`));
  }
  lines.push('');
  lines.push(`Returned: -${money(ex.returnedNet)}`);
  if (ex.added.length > 0) lines.push(`New items: ${money(ex.newNet)}`);
  if (Math.abs(ex.tax) > 0.005) lines.push(`Tax: ${signed(ex.tax)}`);
  if (ex.cardFee > 0) lines.push(`Card Fee: ${money(ex.cardFee)}`);
  lines.push(ex.settlement === 'Even exchange' ? '*Even exchange*' : `*${ex.settlement}: ${money(ex.settlementAmount)}*`);
  if (ex.settledVia) lines.push(`${ex.settledVia.label}: ${ex.settledVia.method}`);
  return lines;
}

/** Cart-wide discount on an order: total discount minus what the item lines account for. */
export function getOrderGlobalDiscount(order: Order, items: OrderItem[]): number {
  const itemDiscounts = items.reduce((sum, item) => sum + item.discountAmount, 0);
  return Math.max(0, round2(order.discountAmount - itemDiscounts));
}

export function escapeHtml(value: string | number | undefined | null): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface EditedOrderTotals {
  /** Net of item discounts, same meaning as Order.subtotal. */
  subtotal: number;
  /** Cart-wide discount carried over from the original bill. */
  globalDiscount: number;
  taxRate: number;
  taxAmount: number;
  cardFeeRate: number;
  cardFeeAmount: number;
  totalAmount: number;
  /** Item discounts plus the cart-wide discount (Order.discountAmount). */
  totalDiscount: number;
}

/**
 * Totals for a bill after its items/payment method are edited. Keeps the original
 * cart-wide discount and tax rate instead of silently dropping/changing them.
 */
export function computeEditedOrderTotals(args: {
  existingOrder: Order;
  oldItems: OrderItem[];
  newItems: Array<{ unitPrice: number; quantity: number; discountAmount: number }>;
  paymentMethod: string;
  fallbackTaxRate: number;
  fallbackCardFeePercent: number;
}): EditedOrderTotals {
  const { existingOrder, oldItems, newItems, paymentMethod, fallbackTaxRate, fallbackCardFeePercent } = args;

  let subtotal = 0;
  let itemDiscounts = 0;
  for (const item of newItems) {
    const gross = item.unitPrice * item.quantity;
    const net = Math.max(0, gross - item.discountAmount);
    subtotal += net;
    itemDiscounts += gross - net;
  }
  subtotal = round2(subtotal);

  const prior = getOrderBreakdown(existingOrder, oldItems);
  const globalDiscount = Math.min(getOrderGlobalDiscount(existingOrder, oldItems), subtotal);
  const taxRate = prior.taxable > 0 ? prior.taxRate : fallbackTaxRate;
  const taxable = round2(subtotal - globalDiscount);
  const taxAmount = round2((taxable * taxRate) / 100);

  const cardFeeRate = paymentMethod === 'card' ? existingOrder.cardFeeRate || fallbackCardFeePercent || 0 : 0;
  const cardFeeAmount = cardFeeRate > 0 ? round2(((taxable + taxAmount) * cardFeeRate) / 100) : 0;

  return {
    subtotal,
    globalDiscount,
    taxRate,
    taxAmount,
    cardFeeRate,
    cardFeeAmount,
    totalAmount: round2(taxable + taxAmount + cardFeeAmount),
    totalDiscount: round2(itemDiscounts + globalDiscount),
  };
}
