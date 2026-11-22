import { useStore } from '@/contexts/useStore';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { CartPanel } from '@/components/pos/CartPanel';
import { ShoppingCart } from 'lucide-react';

interface CartDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCheckout: () => void;
}

/** The cart as a slide-over, for windows too narrow to show it beside the products. */
export function CartDrawer({ open, onOpenChange, onCheckout }: CartDrawerProps) {
  const { cart } = useStore();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md flex flex-col p-0">
        <SheetHeader className="p-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5" />
            Cart ({cart.reduce((sum, item) => sum + item.quantity, 0)} items)
          </SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1">
          <CartPanel onCheckout={onCheckout} onHeld={() => onOpenChange(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
