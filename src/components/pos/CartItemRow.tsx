import { useStore } from '@/contexts/StoreContext';
import { CartItem } from '@/types/pos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Minus, Plus, X, Percent, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { formatPKR } from '@/pages/Analytics';

interface CartItemRowProps {
  item: CartItem;
}

export function CartItemRow({ item }: CartItemRowProps) {
  const { units, updateCartItem, removeFromCart, calculateItemDiscount } = useStore();
  const [discountOpen, setDiscountOpen] = useState(false);
  const [tempDiscount, setTempDiscount] = useState(item.discountAmount.toString());
  const [tempType, setTempType] = useState<'fixed' | 'percentage'>(item.discountType);

  const unitName = units.find(u => u.id === item.product.unitId)?.name || '';
  const itemTotal = item.product.sellingPrice * item.quantity;
  const discount = calculateItemDiscount(item);
  const finalTotal = itemTotal - discount;

  const handleQuantityChange = (delta: number) => {
    const newQty = item.quantity + delta;
    if (newQty <= 0) {
      removeFromCart(item.product.id);
    } else {
      updateCartItem(item.product.id, { quantity: newQty });
    }
  };

  const handleApplyDiscount = () => {
    const amount = parseFloat(tempDiscount) || 0;
    updateCartItem(item.product.id, {
      discountAmount: amount,
      discountType: tempType,
    });
    setDiscountOpen(false);
  };

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{item.product.name}</p>
          <p className="text-xs text-muted-foreground font-mono">
            {item.product.sku}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={() => removeFromCart(item.product.id)}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => handleQuantityChange(-1)}
          >
            <Minus className="w-3 h-3" />
          </Button>
          <Input
            value={item.quantity}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (!isNaN(val) && val > 0) {
                updateCartItem(item.product.id, { quantity: val });
              }
            }}
            className="w-14 h-8 text-center text-sm px-1"
          />
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => handleQuantityChange(1)}
          >
            <Plus className="w-3 h-3" />
          </Button>
          {unitName && <span className="text-xs text-muted-foreground ml-1">{unitName}</span>}
        </div>

        <div className="text-right">
          <p className="font-medium">
            {formatPKR(finalTotal)}
          </p>
          {discount > 0 && (
            <p className="text-xs text-success line-through opacity-70">
              {formatPKR(itemTotal)}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mt-2">
        <span className="text-xs text-muted-foreground">
          @ {formatPKR(item.product.sellingPrice)} each
        </span>

        <Popover open={discountOpen} onOpenChange={setDiscountOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-6 text-xs ml-auto',
                discount > 0 && 'text-success'
              )}
            >
              {discount > 0 ? `-${formatPKR(discount)}` : 'Add Discount'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56" align="end">
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Discount Type</Label>
                <ToggleGroup
                  type="single"
                  value={tempType}
                  onValueChange={(v) => v && setTempType(v as 'fixed' | 'percentage')}
                  className="mt-1"
                >
                  <ToggleGroupItem value="fixed" size="sm" className="flex-1">
                    <DollarSign className="w-3 h-3 mr-1" />
                    Fixed
                  </ToggleGroupItem>
                  <ToggleGroupItem value="percentage" size="sm" className="flex-1">
                    <Percent className="w-3 h-3 mr-1" />
                    Percent
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              <div>
                <Label className="text-xs">Amount</Label>
                <Input
                  type="number"
                  value={tempDiscount}
                  onChange={(e) => setTempDiscount(e.target.value)}
                  min="0"
                  step={tempType === 'percentage' ? '1' : '1'}
                  className="mt-1"
                />
              </div>
              <Button size="sm" className="w-full" onClick={handleApplyDiscount}>
                Apply
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
