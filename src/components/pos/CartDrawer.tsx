import { useStore } from '@/contexts/useStore';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { CartItemRow } from '@/components/pos/CartItemRow';
import { GlobalDiscountInput } from '@/components/pos/GlobalDiscountInput';
import { formatPKR } from '@/pages/Analytics';
import { ShoppingCart, Pause, Trash2, CreditCard } from 'lucide-react';
import { toast } from 'sonner';

interface CartDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCheckout: () => void;
}

export function CartDrawer({ open, onOpenChange, onCheckout }: CartDrawerProps) {
  const {
    cart,
    clearCart,
    holdCart,
    settings,
    calculateSubtotal,
    calculateTax,
    calculateTotal,
    calculateGlobalDiscountAmount,
  } = useStore();

  const handleHoldCart = () => {
    if (cart.length === 0) {
      toast.error('Cart is empty');
      return;
    }
    holdCart();
    toast.success('Cart held');
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md flex flex-col p-0">
        <SheetHeader className="p-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5" />
            Cart ({cart.reduce((sum, item) => sum + item.quantity, 0)} items)
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-auto">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
              <ShoppingCart className="w-16 h-16 mb-4 opacity-30" />
              <p className="text-lg">Cart is empty</p>
              <p className="text-sm">Add products to begin</p>
            </div>
          ) : (
            <div className="divide-y">
              {cart.map((item) => (
                <CartItemRow key={item.product.id} item={item} />
              ))}
            </div>
          )}
        </div>

        {cart.length > 0 && (
          <div className="p-4 border-t space-y-4 bg-muted/30">
            <GlobalDiscountInput />

            <Separator />

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatPKR(calculateSubtotal())}</span>
              </div>
              {calculateGlobalDiscountAmount() > 0 && (
                <div className="flex justify-between text-success">
                  <span>Discount</span>
                  <span>-{formatPKR(calculateGlobalDiscountAmount())}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax ({settings.taxRate}%)</span>
                <span>{formatPKR(calculateTax())}</span>
              </div>
              <Separator />
              <div className="flex justify-between text-xl font-bold">
                <span>Total</span>
                <span>{formatPKR(calculateTotal())}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleHoldCart}
                className="flex-1"
              >
                <Pause className="w-4 h-4 mr-1" />
                Hold
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  clearCart();
                  toast.info('Cart cleared');
                }}
                className="flex-1"
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Clear
              </Button>
            </div>

            <Button
              size="lg"
              className="w-full h-14 text-lg"
              onClick={onCheckout}
            >
              <CreditCard className="w-5 h-5 mr-2" />
              Pay {formatPKR(calculateTotal())}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
