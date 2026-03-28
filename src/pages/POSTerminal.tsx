import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from '@/contexts/StoreContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { CartDrawer } from '@/components/pos/CartDrawer';
import { CheckoutModal } from '@/components/pos/CheckoutModal';
import { HeldCartsPanel } from '@/components/pos/HeldCartsPanel';
import { Receipt } from '@/components/pos/Receipt';
import { formatPKR } from '@/pages/Analytics';
import {
  Search,
  ShoppingCart,
} from 'lucide-react';
import { toast } from 'sonner';
import { Order } from '@/types/pos';

export default function POSTerminal() {
  const {
    products,
    cart,
    addToCart,
    clearCart,
    heldCarts,
    settings,
    calculateTotal,
  } = useStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
    setShowReceipt(true);
  };

  const handlePrintReceipt = useCallback(() => {
    window.print();
  }, []);

  // Hotkeys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'F12') {
        e.preventDefault();
        if (cart.length > 0) setIsCheckoutOpen(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (isCheckoutOpen) {
          setIsCheckoutOpen(false);
        } else if (isCartOpen) {
          setIsCartOpen(false);
        } else {
          clearCart();
          toast.info('Cart cleared');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cart.length, clearCart, isCheckoutOpen, isCartOpen]);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  return (
    <div className="flex flex-col h-full relative">
      {/* Header with Search */}
      <div className="p-6 border-b border-white/5 bg-background/40 backdrop-blur-md sticky top-0 z-10">
        <div className="relative max-w-3xl mx-auto">
          <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full opacity-20 animate-pulse" />
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-primary" />
          <Input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Scan barcode or search product... (F2)"
            className="pl-12 h-14 text-lg barcode-input bg-black/40 border-white/10 focus:border-primary/50 focus:ring-primary/20 rounded-xl shadow-inner transition-all"
          />
        </div>
        <div className="flex justify-center gap-6 mt-3 text-xs font-medium text-muted-foreground/80">
          <span className="flex items-center gap-1.5"><span className="hotkey bg-primary/10 text-primary border-primary/20">F2</span> Focus search</span>
          <span className="flex items-center gap-1.5"><span className="hotkey bg-primary/10 text-primary border-primary/20">F12</span> Checkout</span>
          <span className="flex items-center gap-1.5"><span className="hotkey bg-primary/10 text-primary border-primary/20">Esc</span> Clear/Close</span>
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
                  <span className="font-mono text-[10px] text-muted-foreground/70 bg-black/30 px-1.5 py-0.5 rounded border border-white/5 truncate max-w-[70%]">
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
                
                <p className="relative z-10 font-medium text-sm line-clamp-2 flex-1 text-foreground/90 group-hover:text-primary transition-colors">
                  {product.name}
                </p>
                
                <div className="relative z-10 mt-3 flex items-end justify-between">
                  <p className="text-lg font-bold text-white tracking-tight">
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
      <div className="p-6 border-t border-white/5 bg-background/60 backdrop-blur-md">
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

      {/* Cart Drawer */}
      <CartDrawer
        open={isCartOpen}
        onOpenChange={setIsCartOpen}
        onCheckout={() => {
          setIsCartOpen(false);
          setIsCheckoutOpen(true);
        }}
      />

      {/* Checkout Modal */}
      <CheckoutModal
        open={isCheckoutOpen}
        onOpenChange={setIsCheckoutOpen}
        onComplete={handleCheckoutComplete}
      />

      {/* Receipt Display & Print */}
      {lastOrder && showReceipt && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 no-print animate-in fade-in duration-200 overflow-y-auto">
          <div className="glass-card p-4 sm:p-8 rounded-2xl shadow-2xl max-w-lg w-full border border-white/10 my-4">
            <div className="text-center mb-6">
              <div className="w-14 h-14 sm:w-16 sm:h-16 bg-success/20 rounded-full flex items-center justify-center mx-auto mb-4 text-success">
                <svg className="w-7 h-7 sm:w-8 sm:h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-white">Transaction Complete</h2>
              {lastOrder.clientName && (
                <p className="text-sm text-muted-foreground mt-1">Customer: {lastOrder.clientName}</p>
              )}
            </div>
            
            <div className="bg-black/40 p-4 sm:p-6 rounded-xl mb-6 text-center border border-white/5">
              <p className="text-sm text-muted-foreground mb-1">Total Amount</p>
              <p className="text-2xl sm:text-3xl font-bold text-primary mb-4">
                {formatPKR(lastOrder.totalAmount)}
              </p>
              
              <div className="grid grid-cols-2 gap-2 text-xs sm:text-sm text-muted-foreground border-t border-white/5 pt-4">
                <div>
                  <p className="text-muted-foreground/70">Payment</p>
                  <p className="text-white font-medium capitalize">
                    {lastOrder.paymentMethod}
                    {lastOrder.transferType && ` (${lastOrder.transferType})`}
                  </p>
                </div>
                {lastOrder.transactionId && (
                  <div>
                    <p className="text-muted-foreground/70">TID</p>
                    <p className="text-white font-medium">{lastOrder.transactionId}</p>
                  </div>
                )}
              </div>

              {lastOrder.changeGiven !== undefined && lastOrder.changeGiven > 0 && (
                <div className="pt-4 border-t border-white/5 mt-4">
                  <p className="text-sm text-muted-foreground mb-1">Change Due</p>
                  <p className="text-xl font-mono text-white">
                    {formatPKR(lastOrder.changeGiven)}
                  </p>
                </div>
              )}

              {lastOrder.status === 'credit' && (
                <div className="mt-4 p-2 bg-warning/20 rounded-lg border border-warning/30">
                  <p className="text-warning text-sm font-medium">⚠️ Credit Sale - Payment Pending</p>
                </div>
              )}
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
              <Button 
                variant="outline" 
                className="h-12 border-white/10 hover:bg-white/5" 
                onClick={handlePrintReceipt}
              >
                <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                Print A4
              </Button>
              <Button 
                className="h-12 bg-green-600 hover:bg-green-700 text-white"
                onClick={() => {
                  const text = encodeURIComponent(
                    `*${lastOrder.id.slice(-8).toUpperCase()}*\nTotal: ${formatPKR(lastOrder.totalAmount)}\nPayment: ${lastOrder.paymentMethod.toUpperCase()}${lastOrder.clientName ? `\nCustomer: ${lastOrder.clientName}` : ''}\nThank you for your purchase!`
                  );
                  window.open(`https://wa.me/?text=${text}`, '_blank');
                }}
              >
                <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                WhatsApp
              </Button>
              <Button
                className="h-12 bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20"
                onClick={() => {
                  setShowReceipt(false);
                  searchInputRef.current?.focus();
                }}
              >
                New Sale
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden Receipt for Printing */}
      {lastOrder && <Receipt order={lastOrder} showActions={false} />}
    </div>
  );
}
