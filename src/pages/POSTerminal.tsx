import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useStore } from '@/contexts/useStore';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { CartDrawer } from '@/components/pos/CartDrawer';
import { CheckoutModal } from '@/components/pos/CheckoutModal';
import { HeldCartsPanel } from '@/components/pos/HeldCartsPanel';
import { printOrderReceipt } from '@/components/pos/Receipt';
import { CancelBillDialog } from '@/components/pos/CancelBillDialog';
import { ExchangeDialog } from '@/components/pos/ExchangeDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatPKR } from '@/pages/Analytics';
import {
  Search,
  ShoppingCart,
  History,
  Receipt as ReceiptIcon,
  XCircle,
  Pencil,
  Calculator,
  Trash2,
  Plus,
  Minus,
  User,
  Eye,
  Printer,
  ArrowLeftRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { Order, PaymentMethod } from '@/types/pos';
import { format } from 'date-fns';
import { POSNumpad } from '@/components/pos/POSNumpad';
import { computeEditedOrderTotals, exchangeShareLines } from '@/lib/orderMath';
import {
  billNumber,
  cancelBlockReason,
  editBlockReason,
  exchangeBlockReason,
  isExchangeOrder,
} from '@/lib/exchange';

// How many bills Manage Bills lists at once (the newest, or the newest matches of a search).
const BILL_LIST_LIMIT = 50;

/** Which way the money went on an exchange, e.g. "Refund PKR 1,100"; null for a normal bill. */
function exchangeAmountLabel(order: Order): string | null {
  if (!isExchangeOrder(order)) return null;
  const toAccount = order.paymentMethod === 'credit';
  if (order.totalAmount > 0.005) return `${toAccount ? 'Added to account' : 'Customer pays'} ${formatPKR(order.totalAmount)}`;
  if (order.totalAmount < -0.005) return `${toAccount ? 'Refund to account' : 'Refund'} ${formatPKR(-order.totalAmount)}`;
  return 'Even exchange';
}

/** A bill's amount as staff read it in lists. */
const billAmountLabel = (order: Order) => exchangeAmountLabel(order) ?? `Total: ${formatPKR(order.totalAmount)}`;


export default function POSTerminal() {
  const {
    products,
    cart,
    orders,
    addToCart,
    clearCart,
    heldCarts,
    settings,
    calculateTotal,
    updateOrderFull,
    cancelOrder,
    holdCart,
    updateCartItem,
    removeFromCart,
    getOrderItems,
    getOrderEditLogs,
    customers,
    getCustomerById,
  } = useStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [isOrdersDialogOpen, setIsOrdersDialogOpen] = useState(false);
  const [isEditBillDialogOpen, setIsEditBillDialogOpen] = useState(false);
  const [isManageBillsDialogOpen, setIsManageBillsDialogOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [editClientName, setEditClientName] = useState('');
  const [editClientPhone, setEditClientPhone] = useState('');
  const [isNumpadVisible, setIsNumpadVisible] = useState(true);
  const [showEditHistory, setShowEditHistory] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Full bill editor state
  interface EditItem {
    /** Identifies the row in the editor (lines of deleted products share an empty product id). */
    key: string;
    sourceItemId?: string;
    productId: string;
    productName: string;
    productSku: string;
    quantity: number;
    unitPrice: number;
    discountAmount: number;
  }
  const [editItems, setEditItems] = useState<EditItem[]>([]);
  const [editProductSearch, setEditProductSearch] = useState('');
  const [editPaymentMethod, setEditPaymentMethod] = useState<PaymentMethod>('cash');
  const [editCustomerId, setEditCustomerId] = useState<string>('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Manage Bills: search, cancel confirmation, exchange, and history
  const [billSearch, setBillSearch] = useState('');
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [exchangeTarget, setExchangeTarget] = useState<Order | null>(null);
  const [historyOrderId, setHistoryOrderId] = useState<string | null>(null);

  // Searches every bill (not just the newest), so a customer coming back days later can be found.
  const listedOrders = useMemo(() => {
    const q = billSearch.trim().toLowerCase();
    if (!q) return orders.slice(0, BILL_LIST_LIMIT);
    const amountQuery = q.replace(/,/g, '');
    const isAmount = /^\d+(\.\d+)?$/.test(amountQuery);
    const customerNames = new Map(customers.map((c) => [c.id, c.name.toLowerCase()]));
    const matches: Order[] = [];
    for (const order of orders) {
      const total = Math.abs(order.totalAmount);
      const hit =
        order.id.slice(-8).toLowerCase().includes(q) ||
        (order.clientName || '').toLowerCase().includes(q) ||
        (order.clientPhone || '').toLowerCase().includes(q) ||
        (!!order.customerId && (customerNames.get(order.customerId) || '').includes(q)) ||
        (isAmount && (String(Math.round(total)) === amountQuery || total.toFixed(2).startsWith(amountQuery)));
      if (hit) {
        matches.push(order);
        if (matches.length >= BILL_LIST_LIMIT) break;
      }
    }
    return matches;
  }, [orders, customers, billSearch]);

  // Bills with returns/exchanges against them that still stand.
  const exchangedBillIds = useMemo(() => {
    const ids = new Set<string>();
    for (const o of orders) if (o.originalOrderId && o.status !== 'refunded') ids.add(o.originalOrderId);
    return ids;
  }, [orders]);

  // Filtered products for the edit dialog add-product search
  const editFilteredProducts = editProductSearch.trim()
    ? products.filter(
        (p) =>
          p.name.toLowerCase().includes(editProductSearch.toLowerCase()) ||
          p.sku.toLowerCase().includes(editProductSearch.toLowerCase())
      ).slice(0, 5)
    : [];

  // Calculate edit totals in real-time (same rules the store applies when the bill is saved)
  const editTotals = selectedOrder
    ? computeEditedOrderTotals({
        existingOrder: selectedOrder,
        oldItems: getOrderItems(selectedOrder.id),
        newItems: editItems,
        paymentMethod: editPaymentMethod || selectedOrder.paymentMethod,
        fallbackTaxRate: settings.taxRate,
        fallbackCardFeePercent: settings.cardFeePercent || 0,
      })
    : null;
  const editSubtotal = editTotals?.subtotal ?? 0;
  const editGlobalDiscount = editTotals?.globalDiscount ?? 0;
  const editTaxRate = editTotals?.taxRate ?? settings.taxRate;
  const editTax = editTotals?.taxAmount ?? 0;
  const editCardFeeRate = editTotals?.cardFeeRate ?? 0;
  const editCardFee = editTotals?.cardFeeAmount ?? 0;
  const editTotal = editTotals?.totalAmount ?? 0;

  const filteredProducts = products.filter(
    (p) =>
      (p.barcodeEnabled && !!p.barcode && p.barcode.toLowerCase().includes(searchQuery.toLowerCase())) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const cartItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchQuery) {
      const query = searchQuery.trim().toLowerCase();
      const barcodeProductAny = products.find(
        (p) => p.barcode && p.barcode.toLowerCase() === query
      );

      if (barcodeProductAny && !barcodeProductAny.barcodeEnabled) {
        toast.error('Barcode scanning is disabled for this product');
        setSearchQuery('');
        return;
      }

      const product =
        products.find((p) => p.barcodeEnabled && p.barcode && p.barcode.toLowerCase() === query) ||
        products.find((p) => p.sku.toLowerCase() === query);

      if (product) {
        if (product.stockQuantity <= 0 && !settings.allowNegativeStock) {
          toast.error('Out of stock');
        } else {
          addToCart(product);
          toast.success(`Added ${product.name}`);
        }
        setSearchQuery('');
      } else if (filteredProducts.length === 1) {
        const singleProduct = filteredProducts[0];
        if (singleProduct.stockQuantity <= 0 && !settings.allowNegativeStock) {
          toast.error('Out of stock');
        } else {
          addToCart(singleProduct);
          toast.success(`Added ${singleProduct.name}`);
        }
        setSearchQuery('');
      }
    }
  };

  const handleProductClick = (product: typeof products[0]) => {
    if (product.stockQuantity <= 0 && !settings.allowNegativeStock) {
      toast.error('Out of stock');
      return;
    }
    addToCart(product);
    toast.success(`Added ${product.name}`);
    searchInputRef.current?.focus();
  };

  const handleCheckoutComplete = (order: Order) => {
    setLastOrder(order);
    setIsCheckoutOpen(false);
    setIsCartOpen(false);
    // Some customers want a receipt and some don't, so ask instead of printing automatically.
    // Enter or Esc skips it and starts the next sale; P or the Print button prints it.
    toast.success(`Sale complete - ${formatPKR(order.totalAmount)}`, { duration: 4000 });
    setShowReceipt(true);
  };

  const openEditBillDialog = (order: Order) => {
    const blocked = editBlockReason(order, orders);
    if (blocked) {
      toast.error(blocked);
      return;
    }
    setSelectedOrder(order);
    setEditClientName(order.clientName || '');
    setEditClientPhone(order.clientPhone || '');
    setEditPaymentMethod(order.paymentMethod);
    // A customer deleted since can't be kept on the bill.
    setEditCustomerId(order.customerId && getCustomerById(order.customerId) ? order.customerId : '');
    setShowEditHistory(false);

    // Load existing order items into editable state
    const currentItems = getOrderItems(order.id);
    setEditItems(
      currentItems.map((item) => ({
        key: item.id,
        sourceItemId: item.id,
        productId: item.productId,
        productName: item.productName,
        productSku: item.productSku,
        quantity: item.quantity,
        unitPrice: item.unitPriceAtSale,
        discountAmount: item.discountAmount,
      }))
    );
    setEditProductSearch('');
    setIsEditBillDialogOpen(true);
  };

  const handleAddProductToEdit = (product: typeof products[0]) => {
    const existing = editItems.find((item) => item.productId === product.id);
    if (existing) {
      setEditItems((prev) =>
        prev.map((item) =>
          item.key === existing.key
            ? { ...item, quantity: item.quantity + 1 }
            : item
        )
      );
    } else {
      setEditItems((prev) => [
        ...prev,
        {
          key: `new-${product.id}`,
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          quantity: 1,
          unitPrice: product.sellingPrice,
          discountAmount: 0,
        },
      ]);
    }
    setEditProductSearch('');
    toast.success(`Added ${product.name} to bill`);
  };

  // A credit bill must stay on someone's account.
  const editNeedsCustomer = editPaymentMethod === 'credit' && !editCustomerId;

  const handleSaveBillEdit = async () => {
    if (!selectedOrder || isSavingEdit) return;
    if (editItems.length === 0) {
      toast.error('Bill must have at least one item');
      return;
    }
    if (editNeedsCustomer) {
      toast.error('A credit bill needs a customer. Choose one, or pick another payment method.');
      return;
    }
    setIsSavingEdit(true);
    try {
      const saved = await updateOrderFull(
        selectedOrder.id,
        editItems.map(({ key: _key, ...line }) => line),
        {
          clientName: editClientName.trim() || undefined,
          clientPhone: editClientPhone.trim() || undefined,
          paymentMethod: editPaymentMethod,
          // Empty removes the customer from the bill.
          customerId: editCustomerId || undefined,
        }
      );
      if (saved) setIsEditBillDialogOpen(false);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleCancelBill = async (order: Order, reason: string) => {
    const cancelled = await cancelOrder(order.id, reason);
    if (cancelled) {
      toast.success(isExchangeOrder(order) ? 'Exchange cancelled and everything put back' : 'Bill cancelled and stock restored');
    }
    return cancelled;
  };

  const handleExchangeComplete = (exchange: Order) => {
    setExchangeTarget(null);
    setIsManageBillsDialogOpen(false);
    setLastOrder(exchange);
    setShowReceipt(true);
  };

  const handlePrintReceipt = useCallback(() => {
    if (!lastOrder) return;
    const items = getOrderItems(lastOrder.id);
    if (items.length === 0) {
      toast.error('The receipt is not ready yet. Try again in a moment, or print it from Manage Bills.');
      return;
    }
    printOrderReceipt(lastOrder, items, settings);
    setShowReceipt(false);
    setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [lastOrder, getOrderItems, settings]);

  // Hotkeys
  useEffect(() => {
    // Bill dialogs (manage, edit, exchange, cancel) handle their own keys.
    const billDialogOpen = isManageBillsDialogOpen || isEditBillDialogOpen || !!exchangeTarget || !!cancelTarget;
    const anyDialogOpen = isCheckoutOpen || isCartOpen || billDialogOpen;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isSearchBox = !!target && target === searchInputRef.current;
      // Typing in any other field (phone numbers, prices, SKUs...) must never trigger cart shortcuts.
      const isTypingElsewhere =
        !!target && !isSearchBox && !!target.closest('input, textarea, select, [contenteditable="true"]');

      // If the receipt prompt is showing, P prints it
      if (showReceipt && (e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        handlePrintReceipt();
        return;
      }

      // If receipt is showing, Enter starts a new sale (no receipt)
      if (showReceipt && e.key === 'Enter') {
        e.preventDefault();
        setShowReceipt(false);
        setTimeout(() => searchInputRef.current?.focus(), 0);
        return;
      }

      // A barcode scanner just types, so if focus has drifted (after clearing the cart, clicking a
      // button or empty space) hand the keystrokes to the search box instead of losing the scan.
      // The browser then delivers this very key to the newly focused box.
      if (
        e.key.length === 1 &&
        /[A-Za-z0-9]/.test(e.key) &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !anyDialogOpen &&
        !showReceipt &&
        !target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"]')
      ) {
        searchInputRef.current?.focus();
        return;
      }

      if (e.key === 'F2') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'F12') {
        e.preventDefault();
        if (cart.length > 0 && !billDialogOpen) setIsCheckoutOpen(true);
      } else if (e.key === 'Escape') {
        if (billDialogOpen) return; // the dialog closes itself
        e.preventDefault();
        if (isCheckoutOpen) {
          setIsCheckoutOpen(false);
        } else if (isCartOpen) {
          setIsCartOpen(false);
        } else if (showReceipt) {
          setShowReceipt(false);
          setTimeout(() => searchInputRef.current?.focus(), 0);
        } else if (cart.length > 0) {
          clearCart();
          toast.info('Cart cleared');
        }
      } else if (e.key === 'F9') {
        e.preventDefault();
        if (cart.length > 0 && !billDialogOpen) {
          holdCart(`Bill held at ${new Date().toLocaleTimeString()}`);
          toast.success('Bill placed on hold');
        }
      } else if (e.key === '+' || e.key === 'Add' || e.key === '-' || e.key === 'Subtract') {
        if (anyDialogOpen || showReceipt || isTypingElsewhere || cart.length === 0) return;
        // In the search box these keys only work while it is empty (SKUs like GROC-001 contain "-").
        if (isSearchBox && (target as HTMLInputElement).value !== '') return;

        e.preventDefault();
        const lastItem = cart[cart.length - 1];
        if (e.key === '+' || e.key === 'Add') {
          const newQty = lastItem.quantity + 1;
          const liveStock =
            products.find((p) => p.id === lastItem.product.id)?.stockQuantity ?? lastItem.product.stockQuantity;
          if (liveStock < newQty && !settings.allowNegativeStock) {
            toast.error('Cannot add more: Out of stock');
          } else {
            updateCartItem(lastItem.product.id, { quantity: newQty });
          }
        } else if (lastItem.quantity > 1) {
          updateCartItem(lastItem.product.id, { quantity: lastItem.quantity - 1 });
        } else {
          removeFromCart(lastItem.product.id);
          toast.info('Item removed from cart');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    cart,
    products,
    settings.allowNegativeStock,
    isCheckoutOpen,
    isCartOpen,
    isManageBillsDialogOpen,
    isEditBillDialogOpen,
    exchangeTarget,
    cancelTarget,
    showReceipt,
    handlePrintReceipt,
    clearCart,
    holdCart,
    updateCartItem,
    removeFromCart,
  ]);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  return (
    <div className="flex h-full relative overflow-hidden">
      <div className="flex-1 flex flex-col h-full relative">
      {/* Header with Search */}
      <div className="p-6 border-b border-border/50 bg-background/40 backdrop-blur-md sticky top-0 z-10">
        <div className="relative max-w-3xl mx-auto">
          <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full opacity-20 animate-pulse" />
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-primary" />
          <Input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Scan barcode or search product... (F2)"
            className="pl-12 h-14 text-lg barcode-input bg-muted/50 border-border/50 focus:border-primary/50 focus:ring-primary/20 rounded-xl shadow-inner transition-all"
          />
        </div>
        <div className="flex justify-center flex-wrap gap-4 sm:gap-6 mt-3 text-xs font-medium text-muted-foreground/80">
          <span className="flex items-center gap-1.5"><span className="hotkey bg-primary/10 text-primary border-primary/20">F2</span> Search</span>
          <span className="flex items-center gap-1.5"><span className="hotkey bg-primary/10 text-primary border-primary/20">F12</span> Pay</span>
          <span className="flex items-center gap-1.5"><span className="hotkey bg-primary/10 text-primary border-primary/20">F9</span> Hold</span>
          <span className="flex items-center gap-1.5"><span className="hotkey bg-primary/10 text-primary border-primary/20">Esc</span> Exit</span>
          <span className="flex items-center gap-1.5"><span className="hotkey bg-primary/10 text-primary border-primary/20">+/-</span> Qty</span>
        </div>
        
        {/* Bill Management */}
        <div className="flex justify-between items-center mt-4 px-2">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "text-xs gap-2",
              isNumpadVisible ? "text-primary bg-primary/10" : "text-muted-foreground"
            )}
            onClick={() => setIsNumpadVisible(!isNumpadVisible)}
          >
            <Calculator className="w-4 h-4" />
            {isNumpadVisible ? "Hide Numpad" : "Show Numpad"}
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            className="border-primary/20 text-primary hover:bg-primary/10"
            onClick={() => {
              setBillSearch('');
              setHistoryOrderId(null);
              setIsManageBillsDialogOpen(true);
            }}
          >
            <ReceiptIcon className="w-4 h-4 mr-2" />
            Manage Bills
          </Button>
        </div>
      </div>

      {/* Held Carts */}
      {heldCarts.length > 0 && (
        <div className="px-6 pt-4">
          <HeldCartsPanel />
        </div>
      )}

      {/* Product Grid */}
      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {filteredProducts.map((product) => {
            const isLowStock =
              product.stockQuantity > 0 &&
              product.stockQuantity < product.lowStockThreshold;
            const isOutOfStock = product.stockQuantity <= 0;

            return (
              <button
                key={product.id}
                onClick={() => handleProductClick(product)}
                disabled={isOutOfStock && !settings.allowNegativeStock}
                className="group relative p-4 glass-card rounded-xl text-left hover:bg-primary/5 hover:border-primary/30 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex flex-col overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                
                <div className="relative z-10 flex justify-between items-start gap-2 mb-3">
                  <span className="font-mono text-[10px] text-muted-foreground/70 bg-muted/50 px-1.5 py-0.5 rounded border border-border/50 truncate max-w-[70%]">
                    {product.sku}
                  </span>
                  {isLowStock && (
                    <Badge variant="outline" className="text-warning border-warning/50 bg-warning/10 text-[10px] px-1.5 h-5">
                      Low
                    </Badge>
                  )}
                  {isOutOfStock && (
                    <Badge variant="destructive" className="text-[10px] px-1.5 h-5 shadow-lg shadow-destructive/20">
                      Out
                    </Badge>
                  )}
                </div>
                
                <div className="relative z-10 mb-1 flex items-center justify-between">
                  <p className="font-medium text-sm line-clamp-1 flex-1 text-foreground/90 group-hover:text-primary transition-colors">
                    {product.name}
                  </p>
                  <span className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded-md",
                    isOutOfStock ? "bg-destructive/20 text-destructive border border-destructive/30" :
                    isLowStock ? "bg-amber-500/20 text-amber-500 border border-amber-500/30" :
                    "bg-success/20 text-success border border-success/30"
                  )}>
                    Qty: {product.stockQuantity}
                  </span>
                </div>
                
                <div className="relative z-10 mt-3 flex items-end justify-between">
                  <p className="text-lg font-bold text-foreground tracking-tight">
                    {formatPKR(product.sellingPrice)}
                  </p>
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary opacity-0 group-hover:opacity-100 transform translate-y-2 group-hover:translate-y-0 transition-all duration-300">
                    <ShoppingCart className="w-4 h-4" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        {filteredProducts.length === 0 && searchQuery && (
          <div className="text-center text-muted-foreground py-20 flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center">
              <Search className="w-8 h-8 opacity-50" />
            </div>
            <p>No products found for "{searchQuery}"</p>
          </div>
        )}
      </div>

      {/* Bottom Cart Button */}
      <div className="p-6 border-t border-border/50 bg-background/60 backdrop-blur-md">
        <Button
          size="lg"
          className="w-full h-16 text-lg relative overflow-hidden group bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_20px_hsl(var(--primary)/0.3)] hover:shadow-[0_0_30px_hsl(var(--primary)/0.5)] transition-all duration-300 rounded-xl"
          onClick={() => setIsCartOpen(true)}
          disabled={cart.length === 0}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]" />
          <ShoppingCart className="w-6 h-6 mr-3" />
          <span className="font-bold tracking-wide">View Cart</span>
          {cartItemsCount > 0 && (
            <>
              <Separator orientation="vertical" className="mx-6 h-8 bg-primary-foreground/20" />
              <span className="font-mono font-bold text-xl">{formatPKR(calculateTotal())}</span>
              <Badge className="absolute -top-2 -right-2 w-6 h-6 p-0 flex items-center justify-center rounded-full bg-destructive text-white border-2 border-background shadow-lg animate-in zoom-in">
                {cartItemsCount}
              </Badge>
            </>
          )}
        </Button>
      </div>
      </div>

      {/* Right Sidebar Numpad */}
      {isNumpadVisible && (
        <div className="hidden lg:block">
          <POSNumpad />
        </div>
      )}
      {/* Cart Drawer */}
      <CartDrawer
        open={isCartOpen}
        onOpenChange={setIsCartOpen}
        onCheckout={() => {
          setIsCartOpen(false);
          setIsCheckoutOpen(true);
        }}
      />

      {/* Bill Management Modal */}
      <Dialog open={isManageBillsDialogOpen} onOpenChange={setIsManageBillsDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold flex items-center gap-2">
              <ReceiptIcon className="w-6 h-6 text-primary" />
              Manage Bills
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={billSearch}
                onChange={(e) => setBillSearch(e.target.value)}
                placeholder="Search all bills: bill no., customer, phone or amount"
                className="pl-9 h-10"
              />
            </div>
            <p className="text-xs text-muted-foreground px-1">
              {billSearch.trim()
                ? listedOrders.length >= BILL_LIST_LIMIT
                  ? `Showing the newest ${BILL_LIST_LIMIT} matches. Type more to narrow it down.`
                  : `${listedOrders.length} matching bill${listedOrders.length === 1 ? '' : 's'}`
                : `Newest ${BILL_LIST_LIMIT} bills. Search to find older ones.`}
            </p>
          </div>
          <div className="flex-1 overflow-auto mt-2 px-1">
             <div className="space-y-4">
              {listedOrders.length === 0 ? (
                 <div className="text-center text-muted-foreground p-8">
                    {billSearch.trim() ? 'No bills match this search.' : 'No recent bills found.'}
                 </div>
              ) : (
                listedOrders.map(order => {
                  const exchange = isExchangeOrder(order);
                  const hasExchanges = exchangedBillIds.has(order.id);
                  // Only bills with exchanges need the full list to work out what is locked.
                  const related = hasExchanges ? orders : [];
                  const editLock = editBlockReason(order, related);
                  const cancelLock = cancelBlockReason(order, related);
                  const exchangeLock = exchangeBlockReason(order);
                  const lockHint = order.status === 'refunded' ? null : exchange ? exchangeLock : editLock;
                  const logs = getOrderEditLogs(order.id);
                  const showHistory = historyOrderId === order.id;
                  return (
                  <div key={order.id} className="glass-card p-4 rounded-xl">
                    <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-semibold">{billNumber(order.id)}</span>
                        <Badge variant={order.status === 'completed' ? 'default' : order.status === 'refunded' ? 'destructive' : 'secondary'}>
                          {order.status === 'refunded' ? 'cancelled' : order.status}
                        </Badge>
                        {exchange && order.originalOrderId && (
                          <Badge variant="outline" className="border-primary/40 text-primary bg-primary/5">
                            <ArrowLeftRight className="w-3 h-3 mr-1" />
                            Exchange for bill #{billNumber(order.originalOrderId)}
                          </Badge>
                        )}
                        {hasExchanges && (
                          <Badge variant="outline" className="border-warning/50 text-warning bg-warning/10">
                            Returned items
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground flex flex-col gap-1">
                        {order.clientName && <span>Client: {order.clientName} {order.clientPhone && `(${order.clientPhone})`}</span>}
                        <span>Date: {format(new Date(order.createdAt), 'MMM dd, yyyy HH:mm')}</span>
                        <span>
                          {billAmountLabel(order)}
                          <span className="capitalize"> ({order.paymentMethod === 'credit' ? 'account' : order.paymentMethod})</span>
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        className="bg-primary/5 hover:bg-primary/10 border-primary/20 text-primary"
                        onClick={() => {
                          const items = getOrderItems(order.id);
                          printOrderReceipt(order, items, settings);
                        }}
                      >
                        <Printer className="w-3.5 h-3.5 mr-1.5" />
                        Print
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setLastOrder(order);
                          setIsManageBillsDialogOpen(false);
                          setShowReceipt(true);
                        }}
                      >
                        <Eye className="w-3.5 h-3.5 mr-1.5" />
                        View
                      </Button>
                      {logs.length > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className={cn(showHistory && 'bg-muted')}
                          onClick={() => setHistoryOrderId(showHistory ? null : order.id)}
                        >
                          <History className="w-3.5 h-3.5 mr-1.5" />
                          History ({logs.length})
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!!editLock}
                        title={editLock || undefined}
                        onClick={() => openEditBillDialog(order)}
                      >
                        <Pencil className="w-3.5 h-3.5 mr-1.5" />
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!!exchangeLock}
                        title={exchangeLock || undefined}
                        onClick={() => setExchangeTarget(order)}
                      >
                        <ArrowLeftRight className="w-3.5 h-3.5 mr-1.5" />
                        Return / Exchange
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={!!cancelLock}
                        title={cancelLock || undefined}
                        onClick={() => setCancelTarget(order)}
                      >
                        Cancel
                      </Button>
                    </div>
                    </div>
                    {lockHint && (
                      <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
                        <XCircle className="w-3.5 h-3.5 shrink-0" />
                        {lockHint}
                      </p>
                    )}
                    {showHistory && (
                      <div className="space-y-2 mt-3 max-h-48 overflow-auto">
                        {logs.map((log) => (
                          <div key={log.id} className="text-xs bg-muted/20 rounded-lg p-3 border border-border/30">
                            <div className="flex justify-between items-center mb-1">
                              <span className="font-medium text-foreground">{log.editedBy}</span>
                              <span className="text-muted-foreground">{format(new Date(log.editedAt), 'MMM dd, yyyy HH:mm')}</span>
                            </div>
                            <p className="text-muted-foreground leading-relaxed">{log.changesSummary}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  );
                })
              )}
             </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cancel a bill or an exchange (asks for an optional reason) */}
      <CancelBillDialog
        order={cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        onConfirm={handleCancelBill}
      />

      {/* Return / exchange against a bill */}
      <ExchangeDialog
        order={exchangeTarget}
        onOpenChange={(open) => !open && setExchangeTarget(null)}
        onComplete={handleExchangeComplete}
      />


      {/* Full Bill Editor Dialog */}
      <Dialog open={isEditBillDialogOpen} onOpenChange={setIsEditBillDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Pencil className="w-5 h-5 text-primary" />
              Edit Bill {selectedOrder?.id.slice(-8).toUpperCase()}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-auto space-y-5 py-2">
            {/* Items Table */}
            <div>
              <Label className="text-sm font-semibold mb-2 block">Items</Label>
              <div className="border rounded-lg overflow-hidden">
                <div className="grid grid-cols-[1fr_80px_100px_90px_80px_40px] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                  <span>Product</span>
                  <span className="text-center">Qty</span>
                  <span className="text-right">Price</span>
                  <span className="text-right">Discount</span>
                  <span className="text-right">Subtotal</span>
                  <span></span>
                </div>
                {editItems.length === 0 ? (
                  <div className="text-center text-muted-foreground py-6 text-sm">
                    No items. Add products below.
                  </div>
                ) : (
                  editItems.map((item, idx) => (
                    <div
                      key={item.key}
                      className="grid grid-cols-[1fr_80px_100px_90px_80px_40px] gap-2 px-3 py-2 items-center border-t border-border/30 hover:bg-muted/20 transition-colors"
                    >
                      <div>
                        <p className="text-sm font-medium truncate">{item.productName}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{item.productSku}</p>
                      </div>
                      <div className="flex items-center justify-center gap-1">
                        <button
                          title="Decrease Quantity"
                          className="w-6 h-6 rounded bg-muted hover:bg-muted/80 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                          onClick={() =>
                            setEditItems((prev) =>
                              prev.map((i) =>
                                i.key === item.key && i.quantity > 1
                                  ? { ...i, quantity: i.quantity - 1 }
                                  : i
                              )
                            )
                          }
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <Input
                          type="number"
                          min={1}
                          value={item.quantity}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || 1;
                            setEditItems((prev) =>
                              prev.map((i) =>
                                i.key === item.key ? { ...i, quantity: Math.max(1, val) } : i
                              )
                            );
                          }}
                          className="w-12 h-7 text-center text-xs p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <button
                          title="Increase Quantity"
                          className="w-6 h-6 rounded bg-muted hover:bg-muted/80 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                          onClick={() =>
                            setEditItems((prev) =>
                              prev.map((i) =>
                                i.key === item.key ? { ...i, quantity: i.quantity + 1 } : i
                              )
                            )
                          }
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={item.unitPrice}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          setEditItems((prev) =>
                            prev.map((i) =>
                              i.key === item.key ? { ...i, unitPrice: Math.max(0, val) } : i
                            )
                          );
                        }}
                        className="h-7 text-xs text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={item.discountAmount}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          setEditItems((prev) =>
                            prev.map((i) =>
                              i.key === item.key ? { ...i, discountAmount: Math.max(0, val) } : i
                            )
                          );
                        }}
                        className="h-7 text-xs text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <span className="text-xs font-medium text-right">
                        {formatPKR(item.unitPrice * item.quantity - item.discountAmount)}
                      </span>
                      <button
                        title="Remove Item"
                        className="w-7 h-7 rounded flex items-center justify-center text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
                        onClick={() =>
                          setEditItems((prev) =>
                            prev.filter((i) => i.key !== item.key)
                          )
                        }
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Add Product */}
            <div className="relative">
              <Label className="text-sm font-semibold mb-1 block">Add Product</Label>
              <Input
                value={editProductSearch}
                onChange={(e) => setEditProductSearch(e.target.value)}
                placeholder="Search products to add..."
                className="h-9 text-sm"
              />
              {editFilteredProducts.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
                  {editFilteredProducts.map((product) => (
                    <button
                      key={product.id}
                      className="w-full text-left px-3 py-2 hover:bg-muted/50 flex items-center justify-between text-sm transition-colors"
                      onClick={() => handleAddProductToEdit(product)}
                    >
                      <div>
                        <span className="font-medium">{product.name}</span>
                        <span className="text-muted-foreground ml-2 text-xs">({product.sku})</span>
                      </div>
                      <span className="text-xs font-mono">{formatPKR(product.sellingPrice)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Client Info & Payment */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">
                  {editPaymentMethod === 'credit' ? (
                    <>Customer <span className="text-destructive">*</span></>
                  ) : (
                    'Select Customer (Optional)'
                  )}
                </Label>
                <Select
                  value={editCustomerId}
                  onValueChange={(val) => {
                    if (val === 'none') {
                      setEditCustomerId('');
                      return;
                    }
                    setEditCustomerId(val);
                    const customer = getCustomerById(val);
                    if (customer) {
                      setEditClientName(customer.name);
                      setEditClientPhone(customer.phone);
                    }
                  }}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Search or select a customer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">--- Clear Selection ---</SelectItem>
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
              <div className="space-y-1">
                <Label className="text-xs">Payment Method</Label>
                <select
                  title="Payment Method"
                  value={editPaymentMethod}
                  onChange={(e) => setEditPaymentMethod(e.target.value as PaymentMethod)}
                  className="w-full h-9 text-sm rounded-md border border-input bg-background px-3 py-1 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="transfer">Transfer</option>
                  <option value="credit">Credit</option>
                </select>
              </div>
              {editNeedsCustomer && (
                <p className="sm:col-span-2 text-xs text-destructive">
                  A credit bill goes on a customer's account: choose the customer, or pick another payment method.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Client Name</Label>
                <Input
                  value={editClientName}
                  onChange={(e) => setEditClientName(e.target.value)}
                  placeholder="Client name"
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Client Phone</Label>
                <Input
                  value={editClientPhone}
                  onChange={(e) => setEditClientPhone(e.target.value)}
                  placeholder="Client phone"
                  className="h-9 text-sm"
                />
              </div>
            </div>

            {/* Totals Preview */}
            <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
              <div className="grid grid-cols-2 gap-1 text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="text-right font-medium">{formatPKR(editSubtotal)}</span>
                {editGlobalDiscount > 0 && (
                  <>
                    <span className="text-muted-foreground">Cart discount</span>
                    <span className="text-right font-medium text-success">-{formatPKR(editGlobalDiscount)}</span>
                  </>
                )}
                {editTaxRate > 0 && (
                  <>
                    <span className="text-muted-foreground">Tax ({editTaxRate}%)</span>
                    <span className="text-right font-medium">{formatPKR(editTax)}</span>
                  </>
                )}
                {editCardFee > 0 && (
                  <>
                    <span className="text-muted-foreground">Card Fee ({editCardFeeRate}%)</span>
                    <span className="text-right font-medium">{formatPKR(editCardFee)}</span>
                  </>
                )}
                <Separator className="col-span-2 my-1" />
                <span className="font-bold">Total</span>
                <span className="text-right font-bold text-primary text-lg">{formatPKR(editTotal)}</span>
              </div>
            </div>

            {/* Edit History */}
            {selectedOrder && (
              <div>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-2 transition-colors"
                  onClick={() => setShowEditHistory(!showEditHistory)}
                >
                  <History className="w-3.5 h-3.5" />
                  {showEditHistory ? 'Hide' : 'Show'} Edit History
                </button>
                {showEditHistory && (() => {
                  const logs = getOrderEditLogs(selectedOrder.id);
                  if (logs.length === 0) {
                    return (
                      <div className="text-xs text-muted-foreground bg-muted/20 rounded-lg p-3 border border-border/30">
                        No edits have been made to this bill.
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-2 max-h-40 overflow-auto">
                      {logs.map((log) => (
                        <div key={log.id} className="text-xs bg-muted/20 rounded-lg p-3 border border-border/30">
                          <div className="flex justify-between items-center mb-1">
                            <span className="font-medium text-foreground">{log.editedBy}</span>
                            <span className="text-muted-foreground">
                              {format(new Date(log.editedAt), 'MMM dd, HH:mm')}
                            </span>
                          </div>
                          <p className="text-muted-foreground leading-relaxed">{log.changesSummary}</p>
                          <p className="text-muted-foreground/70 mt-1">
                            Previous total: {formatPKR(log.previousOrder.totalAmount || 0)}
                          </p>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex justify-end gap-2 pt-3 border-t border-border/50">
            <Button variant="outline" onClick={() => setIsEditBillDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveBillEdit} disabled={editItems.length === 0 || editNeedsCustomer || isSavingEdit}>
              {isSavingEdit ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>


      {/* Checkout Modal */}
      <CheckoutModal
        open={isCheckoutOpen}
        onOpenChange={setIsCheckoutOpen}
        onComplete={handleCheckoutComplete}
      />

      {/* Receipt Display & Print */}
      {lastOrder && showReceipt && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 no-print animate-in fade-in duration-200 overflow-y-auto">
          <div className="glass-card p-4 sm:p-8 rounded-2xl shadow-2xl max-w-lg w-full border border-border/20 my-4">
            <div className="text-center mb-6">
              <div className="w-14 h-14 sm:w-16 sm:h-16 bg-success/20 rounded-full flex items-center justify-center mx-auto mb-4 text-success">
                <svg className="w-7 h-7 sm:w-8 sm:h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-foreground">
                {isExchangeOrder(lastOrder) ? 'Exchange Complete' : 'Transaction Complete'}
              </h2>
              {lastOrder.originalOrderId && (
                <p className="text-sm text-muted-foreground mt-1">
                  Exchange #{billNumber(lastOrder.id)} for bill #{billNumber(lastOrder.originalOrderId)}
                </p>
              )}
              <p className="text-sm text-muted-foreground mt-1">Print a receipt for the customer?</p>
              {lastOrder.clientName && (
                <p className="text-sm text-muted-foreground mt-1">Customer: {lastOrder.clientName}</p>
              )}
            </div>

            <div className="bg-muted/30 p-4 sm:p-6 rounded-xl mb-6 text-center border border-border/50">
              {(() => {
                // An exchange shows which way the money went instead of a (possibly negative) total.
                const total = lastOrder.totalAmount;
                const toAccount = lastOrder.paymentMethod === 'credit';
                const label = !isExchangeOrder(lastOrder)
                  ? 'Total Amount'
                  : total > 0.005
                    ? toAccount ? 'Added to customer account' : 'Customer pays'
                    : total < -0.005
                      ? toAccount ? 'Refunded to customer account' : 'Refund to customer'
                      : 'Even exchange';
                return (
                  <>
                    <p className="text-sm text-muted-foreground mb-1">{label}</p>
                    <p className="text-2xl sm:text-3xl font-bold text-primary mb-4">
                      {formatPKR(isExchangeOrder(lastOrder) ? Math.abs(total) : total)}
                    </p>
                  </>
                );
              })()}
              
              <div className="grid grid-cols-2 gap-2 text-xs sm:text-sm text-muted-foreground border-t border-border/50 pt-4">
                <div>
                  <p className="text-muted-foreground/70">Payment</p>
                  <p className="text-foreground font-medium capitalize">
                    {lastOrder.paymentMethod}
                    {lastOrder.transferType && ` (${lastOrder.transferType})`}
                  </p>
                </div>
                {lastOrder.transactionId && (
                  <div>
                    <p className="text-muted-foreground/70">TID</p>
                    <p className="text-foreground font-medium">{lastOrder.transactionId}</p>
                  </div>
                )}
              </div>

              {lastOrder.changeGiven !== undefined && lastOrder.changeGiven > 0 && (
                <div className="pt-4 border-t border-border/50 mt-4">
                  <p className="text-sm text-muted-foreground mb-1">Change Due</p>
                  <p className="text-xl font-mono text-foreground">
                    {formatPKR(lastOrder.changeGiven)}
                  </p>
                </div>
              )}

              {lastOrder.status === 'credit' && (
                <div className="mt-4 p-2 bg-warning/20 rounded-lg border border-warning/30">
                  <p className="text-warning text-sm font-medium">
                    ⚠️ {isExchangeOrder(lastOrder) ? 'Added to customer account' : 'Credit Sale'} - Payment Pending
                  </p>
                </div>
              )}
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                className="h-auto py-3 flex-col gap-1 whitespace-normal border-primary/40 hover:bg-primary/10 text-foreground"
                onClick={handlePrintReceipt}
              >
                <span className="flex items-center text-base font-semibold">
                  <svg className="w-4 h-4 mr-2 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  Print Receipt
                </span>
                <span className="text-xs text-muted-foreground">Press P</span>
              </Button>
              <Button
                className="h-auto py-3 flex-col gap-1 whitespace-normal bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20"
                onClick={() => {
                  setShowReceipt(false);
                  searchInputRef.current?.focus();
                }}
              >
                <span className="text-base font-semibold">No Receipt</span>
                <span className="text-xs opacity-80">Press Enter - next sale</span>
              </Button>
              <Button
                className="col-span-2 h-10 bg-green-600 hover:bg-green-700 text-white"
                onClick={() => {
                  const body = lastOrder.originalOrderId
                    ? [
                        `*Exchange ${billNumber(lastOrder.id)}* for bill #${billNumber(lastOrder.originalOrderId)}`,
                        ...exchangeShareLines(lastOrder, getOrderItems(lastOrder.id), formatPKR),
                      ]
                    : [
                        `*${billNumber(lastOrder.id)}*`,
                        `Total: ${formatPKR(lastOrder.totalAmount)}`,
                        `Payment: ${lastOrder.paymentMethod.toUpperCase()}`,
                      ];
                  if (lastOrder.clientName) body.push(`Customer: ${lastOrder.clientName}`);
                  body.push('Thank you for your purchase!');
                  const text = encodeURIComponent(body.join('\n'));
                  window.open(`https://wa.me/?text=${text}`, '_blank');
                }}
              >
                <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                Share on WhatsApp
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

