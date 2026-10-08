import { useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { ArrowLeftRight, Banknote, Building2, CreditCard, Minus, Plus, Smartphone, Trash2, Undo2, User, UserCheck } from 'lucide-react';
import { useStore } from '@/contexts/useStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  billNumber,
  cartDiscountPercent,
  computeExchange,
  getReturnableLines,
  type ExchangeNewItem,
  type ExchangeReturn,
} from '@/lib/exchange';
import type { Order, PaymentMethod, Product, TransferType } from '@/types/pos';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Amounts here can have paisa (shares of a bill's discount), so up to 2 decimals are shown. */
const money = (n: number) =>
  `PKR ${Math.abs(n).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

interface ExchangeDialogProps {
  /** The bill the goods come back from; null closes the dialog. */
  order: Order | null;
  onOpenChange: (open: boolean) => void;
  /** Called with the new exchange order once it is saved. */
  onComplete: (exchange: Order) => void;
}

/** Return / exchange against a bill: pick what comes back, what the customer takes instead, and how the difference is settled. */
export function ExchangeDialog({ order, onOpenChange, onComplete }: ExchangeDialogProps) {
  return (
    <Dialog open={!!order} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] flex flex-col">
        {/* Keyed by bill so every bill starts with a clean form. */}
        {order && <ExchangeForm key={order.id} order={order} onClose={() => onOpenChange(false)} onComplete={onComplete} />}
      </DialogContent>
    </Dialog>
  );
}

interface NewLine {
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  unitPrice: number;
  /** Kept unrounded so an item at the same price as the returned one comes to exactly the same amount. */
  discountPercent: number;
}

const lineDiscount = (l: NewLine) =>
  round2(Math.min(l.unitPrice * l.quantity, Math.max(0, (l.unitPrice * l.quantity * l.discountPercent) / 100)));

function ExchangeForm({ order, onClose, onComplete }: { order: Order; onClose: () => void; onComplete: (exchange: Order) => void }) {
  const { orders, orderItems, products, customers, settings, createExchange } = useStore();

  const originalCustomer = order.customerId ? customers.find((c) => c.id === order.customerId) : undefined;
  const [returnQty, setReturnQty] = useState<Record<string, number>>({});
  const [newLines, setNewLines] = useState<NewLine[]>([]);
  const [search, setSearch] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    order.paymentMethod === 'credit' && !originalCustomer ? 'cash' : order.paymentMethod
  );
  const [customerId, setCustomerId] = useState(originalCustomer?.id || '');
  const [amountTendered, setAmountTendered] = useState('');
  const [transferType, setTransferType] = useState<TransferType>(order.transferType || 'bank');
  const [transactionId, setTransactionId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const originalItems = useMemo(() => orderItems.filter((i) => i.orderId === order.id), [orderItems, order.id]);
  const returnable = useMemo(() => getReturnableLines(order, orders, orderItems), [order, orders, orderItems]);
  const defaultDiscountPercent = useMemo(() => cartDiscountPercent(order, originalItems), [order, originalItems]);

  // Capped at what can still come back (another PC may have taken some back meanwhile).
  const returns: ExchangeReturn[] = returnable
    .map((l) => ({ item: l.item, alreadyReturned: l.returned, quantity: Math.min(returnQty[l.item.id] || 0, l.returnable) }))
    .filter((r) => r.quantity > 0);
  const newItems: ExchangeNewItem[] = newLines.map((l) => ({
    productId: l.productId,
    productName: l.productName,
    productSku: l.productSku,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discountAmount: lineDiscount(l),
  }));
  const { lines, totals } = computeExchange({
    original: order,
    originalItems,
    returns,
    newItems,
    paymentMethod,
    taxRate: settings.taxRate,
    cardFeePercent: settings.cardFeePercent || 0,
  });
  // Refund (before tax) per returned bill line; the first lines of `lines` are the returns, in order.
  const refundByItem = new Map(returns.map((r, i) => [r.item.id, -(lines[i].unitPriceAtSale * lines[i].quantity - lines[i].discountAmount)]));
  const total = totals.totalAmount;
  const tendered = parseFloat(amountTendered) || 0;

  // Stock needed for the new items, counting units of the same product that come back.
  const stockShort = (() => {
    if (settings.allowNegativeStock) return [];
    const need = new Map<string, number>();
    for (const r of returns) if (r.item.productId) need.set(r.item.productId, (need.get(r.item.productId) || 0) - r.quantity);
    for (const n of newLines) need.set(n.productId, (need.get(n.productId) || 0) + n.quantity);
    return products.filter((p) => (need.get(p.id) || 0) > 0 && p.stockQuantity < (need.get(p.id) || 0)).map((p) => p.name);
  })();

  const problem =
    returns.length === 0
      ? 'Choose what the customer is bringing back.'
      : stockShort.length > 0
        ? `Not enough stock for ${stockShort.join(', ')}.`
        : paymentMethod === 'credit' && !customerId
          ? 'Choose the customer whose account this goes on.'
          : paymentMethod === 'transfer' && total > 0 && !transactionId.trim()
            ? 'Enter the transaction ID of the transfer.'
            : paymentMethod === 'cash' && total > 0 && tendered > 0 && tendered < total
              ? 'The cash received is less than the amount due.'
              : null;

  const query = search.trim().toLowerCase();
  const searchResults: Product[] = query
    ? products
        .filter(
          (p) =>
            p.name.toLowerCase().includes(query) ||
            p.sku.toLowerCase().includes(query) ||
            (p.barcodeEnabled && !!p.barcode && p.barcode.toLowerCase() === query)
        )
        .slice(0, 6)
    : [];

  const addProduct = (product: Product) => {
    setNewLines((prev) =>
      prev.some((l) => l.productId === product.id)
        ? prev.map((l) => (l.productId === product.id ? { ...l, quantity: l.quantity + 1 } : l))
        : [
            ...prev,
            {
              productId: product.id,
              productName: product.name,
              productSku: product.sku,
              quantity: 1,
              unitPrice: product.sellingPrice,
              discountPercent: defaultDiscountPercent,
            },
          ]
    );
    setSearch('');
  };

  const handleSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !query) return;
    e.preventDefault();
    // A scanned barcode or typed SKU adds straight away, as does a search with one match.
    const exact = products.find(
      (p) => (p.barcodeEnabled && !!p.barcode && p.barcode.toLowerCase() === query) || p.sku.toLowerCase() === query
    );
    const pick = exact || (searchResults.length === 1 ? searchResults[0] : undefined);
    if (pick) addProduct(pick);
  };

  const updateLine = (productId: string, changes: Partial<NewLine>) =>
    setNewLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, ...changes } : l)));

  const setQty = (itemId: string, qty: number, max: number) =>
    setReturnQty((prev) => ({ ...prev, [itemId]: Math.max(0, Math.min(max, Math.floor(qty) || 0)) }));

  const confirm = async () => {
    if (problem || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const exchange = await createExchange(
        order.id,
        returns.map((r) => ({ itemId: r.item.id, quantity: r.quantity })),
        newLines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, discountAmount: lineDiscount(l) })),
        {
          paymentMethod,
          customerId: customerId || undefined,
          amountTendered: paymentMethod === 'cash' && total > 0 && tendered > 0 ? tendered : undefined,
          transferType: paymentMethod === 'transfer' ? transferType : undefined,
          transactionId: paymentMethod === 'transfer' ? transactionId : undefined,
        }
      );
      toast.success(
        exchange.totalAmount > 0
          ? `Exchange saved - customer paid ${money(exchange.totalAmount)}`
          : exchange.totalAmount < 0
            ? `${newLines.length > 0 ? 'Exchange' : 'Return'} saved - refund ${money(exchange.totalAmount)}`
            : 'Exchange saved - even exchange'
      );
      onComplete(exchange);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The exchange could not be saved.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const onAccount = paymentMethod === 'credit';
  const headline =
    total > 0
      ? { label: onAccount ? 'Add to customer account' : 'Customer pays', tone: 'text-primary' }
      : total < 0
        ? { label: onAccount ? 'Take off customer account' : 'Refund to customer', tone: 'text-success' }
        : { label: 'Even exchange', tone: 'text-foreground' };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-xl font-bold flex items-center gap-2">
          <ArrowLeftRight className="w-5 h-5 text-primary" />
          Return / Exchange - Bill #{billNumber(order.id)}
        </DialogTitle>
        <DialogDescription>
          Sold {format(new Date(order.createdAt), 'MMM dd, yyyy HH:mm')} - {money(order.totalAmount)} ({order.paymentMethod})
          {order.clientName ? ` - ${order.clientName}` : ''}
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 overflow-auto space-y-5 py-2 pr-1">
        {/* Goods coming back */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-sm font-semibold">Items coming back</Label>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setReturnQty(Object.fromEntries(returnable.map((l) => [l.item.id, l.returnable])))}
              disabled={returnable.every((l) => l.returnable === 0)}
            >
              <Undo2 className="w-3.5 h-3.5 mr-1" />
              Return everything
            </Button>
          </div>
          <div className="border rounded-lg overflow-hidden">
            <div className="grid grid-cols-[1fr_70px_60px_70px_120px_90px] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
              <span>Product</span>
              <span className="text-right">Price</span>
              <span className="text-center">Sold</span>
              <span className="text-center">Can return</span>
              <span className="text-center">Return</span>
              <span className="text-right">Refund</span>
            </div>
            {returnable.length === 0 && (
              <div className="text-center text-muted-foreground py-6 text-sm">This bill has no items.</div>
            )}
            {returnable.map((l) => {
              const qty = Math.min(returnQty[l.item.id] || 0, l.returnable);
              return (
                <div
                  key={l.item.id}
                  className={cn(
                    'grid grid-cols-[1fr_70px_60px_70px_120px_90px] gap-2 px-3 py-2 items-center border-t border-border/30',
                    qty > 0 && 'bg-primary/5'
                  )}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{l.item.productName}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">
                      {l.item.productSku}
                      {l.returned > 0 && <span className="ml-2 text-warning">{l.returned} returned before</span>}
                    </p>
                  </div>
                  <span className="text-xs text-right">{money(l.item.unitPriceAtSale)}</span>
                  <span className="text-xs text-center">{l.sold}</span>
                  <span className={cn('text-xs text-center', l.returnable === 0 && 'text-muted-foreground')}>{l.returnable}</span>
                  <div className="flex items-center justify-center gap-1">
                    <button
                      title="Return one less"
                      className="w-6 h-6 rounded bg-muted hover:bg-muted/80 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
                      disabled={qty === 0}
                      onClick={() => setQty(l.item.id, qty - 1, l.returnable)}
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <Input
                      type="number"
                      min={0}
                      max={l.returnable}
                      value={qty}
                      disabled={l.returnable === 0}
                      onChange={(e) => setQty(l.item.id, parseInt(e.target.value), l.returnable)}
                      className="w-12 h-7 text-center text-xs p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button
                      title="Return one more"
                      className="w-6 h-6 rounded bg-muted hover:bg-muted/80 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
                      disabled={qty >= l.returnable}
                      onClick={() => setQty(l.item.id, qty + 1, l.returnable)}
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  <span className="text-xs font-medium text-right">
                    {qty > 0 ? `-${money(refundByItem.get(l.item.id) || 0)}` : '-'}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Refunds are what the customer paid for those items, after the bill's discounts and before tax.
          </p>
        </div>

        {/* Goods the customer takes instead */}
        <div>
          <Label className="text-sm font-semibold mb-2 block">New items (leave empty for a plain return)</Label>
          <div className="relative mb-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleSearchKey}
              placeholder="Search by name or SKU, or scan a barcode..."
              className="h-9 text-sm"
            />
            {searchResults.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
                {searchResults.map((product) => (
                  <button
                    key={product.id}
                    className="w-full text-left px-3 py-2 hover:bg-muted/50 flex items-center justify-between text-sm transition-colors"
                    onClick={() => addProduct(product)}
                  >
                    <div>
                      <span className="font-medium">{product.name}</span>
                      <span className="text-muted-foreground ml-2 text-xs">({product.sku})</span>
                      <span className={cn('ml-2 text-[10px]', product.stockQuantity <= 0 ? 'text-destructive' : 'text-muted-foreground')}>
                        Stock: {product.stockQuantity}
                      </span>
                    </div>
                    <span className="text-xs font-mono">{money(product.sellingPrice)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {newLines.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <div className="grid grid-cols-[1fr_110px_90px_70px_90px_36px] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                <span>Product</span>
                <span className="text-center">Qty</span>
                <span className="text-right">Price</span>
                <span className="text-right">Disc %</span>
                <span className="text-right">Amount</span>
                <span></span>
              </div>
              {newLines.map((l) => (
                <div
                  key={l.productId}
                  className="grid grid-cols-[1fr_110px_90px_70px_90px_36px] gap-2 px-3 py-2 items-center border-t border-border/30"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{l.productName}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{l.productSku}</p>
                  </div>
                  <div className="flex items-center justify-center gap-1">
                    <button
                      title="Decrease quantity"
                      className="w-6 h-6 rounded bg-muted hover:bg-muted/80 flex items-center justify-center text-muted-foreground hover:text-foreground"
                      onClick={() => updateLine(l.productId, { quantity: Math.max(1, l.quantity - 1) })}
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <Input
                      type="number"
                      min={1}
                      value={l.quantity}
                      onChange={(e) => updateLine(l.productId, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                      className="w-12 h-7 text-center text-xs p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button
                      title="Increase quantity"
                      className="w-6 h-6 rounded bg-muted hover:bg-muted/80 flex items-center justify-center text-muted-foreground hover:text-foreground"
                      onClick={() => updateLine(l.productId, { quantity: l.quantity + 1 })}
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={l.unitPrice}
                    onChange={(e) => updateLine(l.productId, { unitPrice: Math.max(0, parseFloat(e.target.value) || 0) })}
                    className="h-7 text-xs text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={round2(l.discountPercent)}
                    title="Starts at the cart discount the original bill had"
                    onChange={(e) =>
                      updateLine(l.productId, { discountPercent: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)) })
                    }
                    className="h-7 text-xs text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-xs font-medium text-right">{money(l.unitPrice * l.quantity - lineDiscount(l))}</span>
                  <button
                    title="Remove item"
                    className="w-7 h-7 rounded flex items-center justify-center text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setNewLines((prev) => prev.filter((x) => x.productId !== l.productId))}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {defaultDiscountPercent > 0 && (
            <p className="text-[11px] text-muted-foreground mt-1">
              New items start with the bill's cart discount ({round2(defaultDiscountPercent)}%) so a like-for-like swap comes to nothing.
            </p>
          )}
        </div>

        {/* Settlement */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <Label className="text-sm font-semibold">
                {total < 0 ? 'Refund by' : total > 0 ? 'Customer pays by' : 'Settled by'}
              </Label>
              <ToggleGroup
                type="single"
                value={paymentMethod}
                onValueChange={(v) => v && setPaymentMethod(v as PaymentMethod)}
                className="mt-2 grid grid-cols-4 gap-2"
              >
                <ToggleGroupItem value="cash" className="flex-col h-auto py-2">
                  <Banknote className="w-4 h-4 mb-1" />
                  <span className="text-xs">Cash</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="card" className="flex-col h-auto py-2">
                  <CreditCard className="w-4 h-4 mb-1" />
                  <span className="text-xs">Card</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="transfer" className="flex-col h-auto py-2">
                  <ArrowLeftRight className="w-4 h-4 mb-1" />
                  <span className="text-xs">Transfer</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="credit" className="flex-col h-auto py-2">
                  <UserCheck className="w-4 h-4 mb-1" />
                  <span className="text-xs">Account</span>
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">
                Customer {paymentMethod === 'credit' ? <span className="text-destructive">*</span> : '(optional)'}
              </Label>
              <Select value={customerId} onValueChange={(v) => setCustomerId(v === 'none' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="No customer" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">--- No customer ---</SelectItem>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <div className="flex items-center gap-2">
                        <User className="w-3.5 h-3.5 text-muted-foreground" />
                        <span>{c.name}</span>
                        <span className="text-[10px] text-muted-foreground">({c.phone})</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {paymentMethod === 'cash' && total > 0 && (
              <div className="space-y-1">
                <Label htmlFor="exchange-tendered" className="text-xs">Cash received (optional)</Label>
                <Input
                  id="exchange-tendered"
                  type="number"
                  min={0}
                  value={amountTendered}
                  onChange={(e) => setAmountTendered(e.target.value)}
                  placeholder={String(Math.ceil(total))}
                  className="h-9 text-sm"
                />
                {tendered >= total && (
                  <p className="text-xs text-muted-foreground">
                    Change: <span className="font-semibold text-foreground">{money(tendered - total)}</span>
                  </p>
                )}
              </div>
            )}

            {paymentMethod === 'transfer' && (
              <div className="space-y-2">
                <ToggleGroup
                  type="single"
                  value={transferType}
                  onValueChange={(v) => v && setTransferType(v as TransferType)}
                  className="grid grid-cols-3 gap-2"
                >
                  <ToggleGroupItem value="bank" className="h-8 text-xs">
                    <Building2 className="w-3.5 h-3.5 mr-1" /> Bank
                  </ToggleGroupItem>
                  <ToggleGroupItem value="jazzcash" className="h-8 text-xs">
                    <Smartphone className="w-3.5 h-3.5 mr-1" /> JazzCash
                  </ToggleGroupItem>
                  <ToggleGroupItem value="easypaisa" className="h-8 text-xs">
                    <Smartphone className="w-3.5 h-3.5 mr-1" /> Easypaisa
                  </ToggleGroupItem>
                </ToggleGroup>
                <Input
                  value={transactionId}
                  onChange={(e) => setTransactionId(e.target.value)}
                  placeholder={total > 0 ? 'Transaction ID (required)' : 'Transaction ID (optional)'}
                  className="h-9 text-sm"
                />
              </div>
            )}

            {paymentMethod === 'card' && total < 0 && (
              <p className="text-[11px] text-muted-foreground">The card fee paid on the original bill is not refunded.</p>
            )}
          </div>

          {/* Summary */}
          <div className="bg-muted/30 rounded-lg p-4 border border-border/50 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Returned items (incl. tax)</span>
              <span className="font-medium text-success">-{money(totals.returnedValue)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">New items (incl. tax)</span>
              <span className="font-medium">{money(totals.newValue)}</span>
            </div>
            {totals.cardFeeAmount > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Card fee ({totals.cardFeeRate}%)</span>
                <span className="font-medium">{money(totals.cardFeeAmount)}</span>
              </div>
            )}
            <Separator className="my-2" />
            <div className="text-center pt-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{headline.label}</p>
              <p className={cn('text-3xl font-bold', headline.tone)}>{total === 0 ? money(0) : money(total)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-3 border-t border-border/50">
        {problem && <p className="text-xs text-destructive sm:mr-auto">{problem}</p>}
        <Button variant="outline" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={confirm} disabled={!!problem || submitting}>
          {submitting ? 'Saving...' : newLines.length > 0 ? 'Confirm exchange' : 'Confirm return'}
        </Button>
      </div>
    </>
  );
}
