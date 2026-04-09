import React, { useState } from 'react';
import { useStore } from '@/contexts/useStore';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Delete, X, ArrowBigUpDash } from 'lucide-react';
import { cn } from '@/lib/utils';

export function POSNumpad() {
  const { cart, updateCartItem, removeFromCart, settings, holdCart, clearCart } = useStore();
  const [value, setValue] = useState('');

  const lastItem = cart.length > 0 ? cart[cart.length - 1] : null;

  const handleNumberClick = (num: string) => {
    setValue((prev) => (prev.length < 5 ? prev + num : prev));
  };

  const handleClear = () => {
    setValue('');
  };

  const handleBackspace = () => {
    setValue((prev) => prev.slice(0, -1));
  };

  const applyQuantity = () => {
    if (!lastItem) {
      toast.error('No item in cart to adjust');
      return;
    }

    const newQty = parseInt(value, 10);
    if (isNaN(newQty) || newQty <= 0) {
      toast.error('Invalid quantity');
      return;
    }

    if (lastItem.product.stockQuantity < newQty && !settings.allowNegativeStock) {
      toast.error(`Only ${lastItem.product.stockQuantity} items in stock`);
      return;
    }

    updateCartItem(lastItem.product.id, { quantity: newQty });
    toast.success(`Updated ${lastItem.product.name} quantity to ${newQty}`);
    setValue('');
  };

  const addQuickQty = (qty: number) => {
    if (!lastItem) {
      toast.error('No item in cart to adjust');
      return;
    }

    const newQty = lastItem.quantity + qty;
    if (lastItem.product.stockQuantity < newQty && !settings.allowNegativeStock) {
      toast.error(`Not enough stock available`);
      return;
    }

    updateCartItem(lastItem.product.id, { quantity: newQty });
    toast.success(`Added ${qty} to ${lastItem.product.name}`);
  };

  return (
    <div className="flex flex-col h-full bg-card/50 backdrop-blur-md border-l border-border/50 p-4 space-y-4 w-72 animate-in slide-in-from-right duration-300">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Quick Numpad</h3>
        <div className="bg-background/80 border border-border/50 rounded-lg p-3 h-14 flex items-center justify-end overflow-hidden">
          <span className={cn(
            "text-2xl font-mono tracking-tighter",
            value ? "text-foreground" : "text-muted-foreground/30"
          )}>
            {value || '000'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
          <Button
            key={num}
            variant="outline"
            className="h-12 text-lg font-bold border-border/30 hover:bg-primary/10 hover:border-primary/50 transition-all"
            onClick={() => handleNumberClick(num.toString())}
          >
            {num}
          </Button>
        ))}
        <Button
          variant="ghost"
          className="h-12 text-destructive hover:bg-destructive/10"
          onClick={handleClear}
        >
          <X className="w-5 h-5" />
        </Button>
        <Button
          variant="outline"
          className="h-12 text-lg font-bold border-border/30"
          onClick={() => handleNumberClick('0')}
        >
          0
        </Button>
        <Button
          variant="ghost"
          className="h-12"
          onClick={handleBackspace}
        >
          <Delete className="w-5 h-5" />
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <Button
          className="h-12 text-lg font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20"
          onClick={applyQuantity}
          disabled={!value || !lastItem}
        >
          Set Quantity
        </Button>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest pl-1">Quick Add</p>
        <div className="grid grid-cols-3 gap-2">
          {[1, 5, 10].map((qty) => (
            <Button
              key={qty}
              variant="secondary"
              className="h-10 text-xs font-bold bg-success/10 text-success border border-success/20 hover:bg-success/20"
              onClick={() => addQuickQty(qty)}
              disabled={!lastItem}
            >
              +{qty}
            </Button>
          ))}
        </div>
      </div>

      <div className="pt-4 border-t border-border/50 space-y-2">
        <Button
          variant="outline"
          className="w-full h-10 border-warning/20 text-warning hover:bg-warning/10 text-xs"
          onClick={() => {
            if (cart.length > 0) {
              holdCart();
              toast.success('Bill held');
            }
          }}
          disabled={cart.length === 0}
        >
          Hold Bill (F9)
        </Button>
        <Button
          variant="outline"
          className="w-full h-10 border-destructive/20 text-destructive hover:bg-destructive/10 text-xs"
          onClick={() => {
            if (cart.length > 0) {
              clearCart();
              toast.info('Cart cleared');
            }
          }}
          disabled={cart.length === 0}
        >
          Clear All
        </Button>
      </div>
      
      {lastItem && (
        <div className="mt-auto p-3 bg-primary/5 rounded-xl border border-primary/10">
          <p className="text-[10px] text-muted-foreground uppercase mb-1">Active Item</p>
          <p className="text-sm font-medium line-clamp-1">{lastItem.product.name}</p>
          <p className="text-xs text-primary font-bold">Qty: {lastItem.quantity}</p>
        </div>
      )}
    </div>
  );
}
