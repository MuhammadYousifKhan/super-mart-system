import type { Order, OrderItem, PaymentMethod } from '@/types/pos';
import { getOrderBreakdown, getOrderGlobalDiscount } from '@/lib/orderMath';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Exchanges and returns are recorded as their own order, dated when the customer came back, so
 * daily sales and the cash drawer show the money that actually changed hands that day. See
 * Order.originalOrderId for how such an order is laid out.
 */
export const isExchangeOrder = (order: Pick<Order, 'originalOrderId'>) => !!order.originalOrderId;

/** Bill number as staff see it on screen and on receipts: the last 8 characters of the id. */
export const billNumber = (id: string) => id.slice(-8).toUpperCase();

/** Exchanges/returns made against a bill that have not been cancelled, oldest first. */
export function getActiveExchanges(originalOrderId: string, orders: Order[]): Order[] {
  return orders
    .filter((o) => o.originalOrderId === originalOrderId && o.status !== 'refunded')
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** Why goods from a bill cannot be returned/exchanged, or null when they can. */
export function exchangeBlockReason(order: Order): string | null {
  if (order.status === 'refunded') return 'This bill was cancelled.';
  if (order.originalOrderId) {
    return `This is an exchange. To change it, cancel it and make a new exchange from bill #${billNumber(order.originalOrderId)}.`;
  }
  return null;
}

/** Why a bill cannot be edited, or null when it can. */
export function editBlockReason(order: Order, orders: Order[]): string | null {
  if (order.status === 'refunded') return 'This bill was cancelled.';
  if (order.originalOrderId) return 'An exchange cannot be edited. Cancel it and make a new exchange instead.';
  if (getActiveExchanges(order.id, orders).length > 0) {
    return 'Items on this bill were returned or exchanged. Cancel the exchange first.';
  }
  return null;
}

/** Why a bill cannot be cancelled, or null when it can. */
export function cancelBlockReason(order: Order, orders: Order[]): string | null {
  if (order.status === 'refunded') return 'This bill is already cancelled.';
  if (getActiveExchanges(order.id, orders).length > 0) {
    return 'Items on this bill were returned or exchanged. Cancel the exchange first.';
  }
  return null;
}

export interface ReturnableLine {
  /** The line on the original bill. */
  item: OrderItem;
  sold: number;
  /** Units already brought back on exchanges that still stand. */
  returned: number;
  returnable: number;
}

/**
 * How much of each line on a bill can still be brought back. Returned lines on earlier exchanges
 * are matched to the bill's lines by product (or by name and SKU once the product is deleted).
 */
export function getReturnableLines(original: Order, orders: Order[], orderItems: OrderItem[]): ReturnableLine[] {
  const lines: ReturnableLine[] = orderItems
    .filter((i) => i.orderId === original.id && i.quantity > 0)
    .map((item) => ({ item, sold: item.quantity, returned: 0, returnable: item.quantity }));

  for (const exchange of getActiveExchanges(original.id, orders)) {
    for (const back of orderItems) {
      if (back.orderId !== exchange.id || back.quantity >= 0) continue;
      const byProduct = back.productId ? lines.filter((l) => l.item.productId === back.productId) : [];
      const candidates =
        byProduct.length > 0
          ? byProduct
          : lines.filter((l) => l.item.productSku === back.productSku && l.item.productName === back.productName);
      let left = -back.quantity;
      for (const line of candidates) {
        const take = Math.min(left, line.sold - line.returned);
        if (take <= 0) continue;
        line.returned += take;
        left -= take;
        if (left <= 0) break;
      }
    }
  }

  for (const line of lines) line.returnable = Math.max(0, line.sold - line.returned);
  return lines;
}

/**
 * The bill's cart-wide discount as a percentage of its subtotal. New items taken in an exchange
 * start with this discount, so swapping for an item at the same price comes to nothing.
 */
export function cartDiscountPercent(original: Order, originalItems: OrderItem[]): number {
  if (!(original.subtotal > 0)) return 0;
  return (getOrderGlobalDiscount(original, originalItems) / original.subtotal) * 100;
}

export interface ExchangeReturn {
  /** The line on the original bill. */
  item: OrderItem;
  /** Units of that line returned before (ReturnableLine.returned). */
  alreadyReturned: number;
  /** Units coming back now. */
  quantity: number;
}

export interface ExchangeNewItem {
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  unitPrice: number;
  unitCost?: number;
  /** Discount on the whole line, not per unit. */
  discountAmount: number;
}

/** An exchange order line before it gets its ids. */
export type ExchangeLine = Omit<OrderItem, 'id' | 'orderId'>;

export interface ExchangeTotals {
  /** What the customer paid for the returned goods, before tax (positive). */
  returnedNet: number;
  /** The same including the tax they paid on them. */
  returnedValue: number;
  /** New goods after discounts, before tax. */
  newNet: number;
  /** The same including tax at today's rate. */
  newValue: number;
  // Order fields:
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  cardFeeRate: number;
  cardFeeAmount: number;
  /** Positive: the customer pays this. Negative: this much goes back to the customer. */
  totalAmount: number;
}

/**
 * Lines and totals of an exchange/return order (see Order.originalOrderId):
 *  - returned goods are negative lines at the original price, with a negative discount equal to
 *    their part of the line's discount and of the bill's cart-wide discount, so each line comes to
 *    minus what the customer actually paid for those units;
 *  - new goods are normal lines;
 *  - tax: today's rate on the new goods minus the rate the bill was charged on the returned goods;
 *  - card fee only when the customer pays the difference by card (the original fee is not refunded).
 */
export function computeExchange(args: {
  original: Order;
  originalItems: OrderItem[];
  returns: ExchangeReturn[];
  newItems: ExchangeNewItem[];
  paymentMethod: PaymentMethod;
  /** Today's tax rate (%), for the new goods. */
  taxRate: number;
  cardFeePercent: number;
}): { lines: ExchangeLine[]; totals: ExchangeTotals } {
  const { original, originalItems, returns, newItems, paymentMethod, taxRate, cardFeePercent } = args;
  const cartDiscount = getOrderGlobalDiscount(original, originalItems);
  const originalBreakdown = getOrderBreakdown(original, originalItems);
  const originalTaxRate = originalBreakdown.taxRate;
  // The whole bill coming back in one go refunds exactly what was paid for it (less any card fee),
  // so rounding each line's share of the cart discount can't leave a paisa over or under.
  const soldLines = originalItems.filter((i) => i.orderId === original.id && i.quantity > 0);
  const wholeBill =
    soldLines.length > 0 &&
    soldLines.every((i) => returns.some((r) => r.item.id === i.id && r.alreadyReturned === 0 && r.quantity === i.quantity));

  // Discount (item discount + share of the cart-wide discount) on the first `units` units of a line.
  const discountOn = (item: OrderItem, units: number) => {
    const itemDiscount = item.quantity > 0 ? (item.discountAmount * units) / item.quantity : 0;
    const net = item.unitPriceAtSale * units - itemDiscount;
    const share = original.subtotal > 0 ? (cartDiscount * net) / original.subtotal : 0;
    return round2(itemDiscount + share);
  };

  const lines: ExchangeLine[] = [];
  let returnedNet = 0;
  for (const r of returns) {
    if (!(r.quantity > 0)) continue;
    // Worked out on the running total, so a line returned in several goes refunds exactly what was paid.
    const discount = round2(discountOn(r.item, r.alreadyReturned + r.quantity) - discountOn(r.item, r.alreadyReturned));
    returnedNet += round2(r.item.unitPriceAtSale * r.quantity - discount);
    lines.push({
      productId: r.item.productId,
      productName: r.item.productName,
      productSku: r.item.productSku,
      quantity: -r.quantity,
      unitPriceAtSale: r.item.unitPriceAtSale,
      unitCostAtSale: r.item.unitCostAtSale,
      discountAmount: -discount,
    });
  }

  let newNet = 0;
  for (const n of newItems) {
    if (!(n.quantity > 0)) continue;
    const gross = n.unitPrice * n.quantity;
    const discount = round2(Math.min(Math.max(0, n.discountAmount || 0), gross));
    newNet += round2(gross - discount);
    lines.push({
      productId: n.productId,
      productName: n.productName,
      productSku: n.productSku,
      quantity: n.quantity,
      unitPriceAtSale: n.unitPrice,
      unitCostAtSale: n.unitCost,
      discountAmount: discount,
    });
  }

  returnedNet = round2(returnedNet);
  if (wholeBill) {
    // Any rounding left over goes on the last returned line.
    const gap = round2(originalBreakdown.taxable - returnedNet);
    const last = lines[returns.filter((r) => r.quantity > 0).length - 1];
    if (gap !== 0 && last) {
      last.discountAmount = round2(last.discountAmount + gap);
      returnedNet = round2(originalBreakdown.taxable);
    }
  }
  const returnedTax = wholeBill ? round2(original.taxAmount) : (returnedNet * originalTaxRate) / 100;
  newNet = round2(newNet);
  const subtotal = round2(newNet - returnedNet);
  const discountAmount = round2(lines.reduce((sum, l) => sum + l.discountAmount, 0));
  const taxAmount = round2((newNet * taxRate) / 100 - returnedTax);
  const difference = round2(subtotal + taxAmount);
  const cardFeeRate = paymentMethod === 'card' && difference > 0 ? cardFeePercent || 0 : 0;
  const cardFeeAmount = cardFeeRate > 0 ? round2((difference * cardFeeRate) / 100) : 0;
  const totalAmount = round2(difference + cardFeeAmount);
  const returnedValue = round2(returnedNet + returnedTax);
  // Derived so that new value - returned value + card fee is exactly the total.
  const newValue = round2(difference + returnedValue);

  return {
    lines,
    totals: {
      returnedNet,
      returnedValue,
      newNet,
      newValue,
      subtotal,
      discountAmount,
      taxAmount,
      cardFeeRate: cardFeeAmount > 0 ? cardFeeRate : 0,
      cardFeeAmount,
      totalAmount,
    },
  };
}

const money = (n: number) =>
  `PKR ${Math.abs(n).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** One-line description of an exchange for the bill's history, e.g. "returned 1 x Milk; took 1 x Bread; even exchange". */
export function describeExchange(lines: Array<Pick<OrderItem, 'quantity' | 'productName'>>, totalAmount: number, paymentMethod: PaymentMethod): string {
  const returned = lines.filter((l) => l.quantity < 0).map((l) => `${-l.quantity} x ${l.productName}`);
  const taken = lines.filter((l) => l.quantity > 0).map((l) => `${l.quantity} x ${l.productName}`);
  const how = paymentMethod === 'credit' ? 'customer account' : paymentMethod;
  const money_ =
    totalAmount > 0
      ? `customer paid ${money(totalAmount)} (${how})`
      : totalAmount < 0
        ? `refunded ${money(totalAmount)} (${how})`
        : 'even exchange';
  return [
    returned.length > 0 ? `returned ${returned.join(', ')}` : '',
    taken.length > 0 ? `took ${taken.join(', ')}` : '',
    money_,
  ]
    .filter(Boolean)
    .join('; ');
}
