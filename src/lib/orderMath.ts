import type { Order, OrderItem } from '@/types/pos';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface OrderBreakdown {
  /** Sum of unit price x quantity, before any discount (what the printed item lines add up to). */
  subtotal: number;
  /** Item-level and cart-wide discounts together. */
  discount: number;
  /** Amount tax was charged on: subtotal - discount. */
  taxable: number;
  /** Tax percentage that was actually applied to this order. */
  taxRate: number;
  cardFee: number;
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
  const cardFee = order.cardFeeAmount || 0;
  const taxable = round2(order.totalAmount - order.taxAmount - cardFee);
  const subtotal =
    items.length > 0
      ? round2(items.reduce((sum, item) => sum + item.unitPriceAtSale * item.quantity, 0))
      : order.subtotal;
  const discount = Math.max(0, round2(subtotal - taxable));
  const taxRate = taxable > 0 ? round2((order.taxAmount / taxable) * 100) : 0;

  return { subtotal, discount, taxable, taxRate, cardFee };
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
