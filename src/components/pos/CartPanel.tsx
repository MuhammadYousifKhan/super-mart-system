import { useStore } from '@/contexts/useStore';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { CartItemRow } from '@/components/pos/CartItemRow';
import { GlobalDiscountInput } from '@/components/pos/GlobalDiscountInput';
import { formatPKR } from '@/pages/Analytics';
import { ShoppingCart, Pause, Trash2, CreditCard } from 'lucide-react';
import { toast } from 'sonner';

interface CartPanelProps {
  onCheckout: () => void;
  /** Called after the cart was put on hold (the drawer closes itself). */
  onHeld?: () => void;
}

/** The cart: lines, discount, totals and the Pay button. Shown beside the products and inside the drawer. */
export function CartPanel({ onCheckout, onHeld }: CartPanelProps) {
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
    onHeld?.();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 overflow-auto">
        {cart.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-8 text-muted-foreground">
            <ShoppingCart className="mb-4 h-16 w-16 opacity-30" />
            <p className="text-lg">Cart is empty</p>
            <p className="text-sm">Scan or pick a product to begin</p>
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
        <div className="space-y-4 border-t bg-muted/30 p-4">
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
            <Button variant="outline" size="sm" onClick={handleHoldCart} className="flex-1">
              <Pause className="mr-1 h-4 w-4" />
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
              <Trash2 className="mr-1 h-4 w-4" />
              Clear
            </Button>
          </div>

          <Button size="lg" className="h-14 w-full text-lg" onClick={onCheckout}>
            <CreditCard className="mr-2 h-5 w-5" />
            Pay {formatPKR(calculateTotal())}
          </Button>
        </div>
      )}
    </div>
  );
}
