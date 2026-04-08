import { useState } from 'react';
import { useStore } from '@/contexts/useStore';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Percent, DollarSign } from 'lucide-react';

export function GlobalDiscountInput() {
  const { globalDiscount, globalDiscountType, setGlobalDiscount } = useStore();
  const [inputValue, setInputValue] = useState(globalDiscount.toString());

  const handleValueChange = (value: string) => {
    setInputValue(value);
    const num = parseFloat(value) || 0;
    setGlobalDiscount(num, globalDiscountType);
  };

  const handleTypeChange = (type: string) => {
    if (type) {
      setGlobalDiscount(globalDiscount, type as 'fixed' | 'percentage');
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs whitespace-nowrap text-muted-foreground">
        Cart Discount
      </Label>
      <ToggleGroup
        type="single"
        value={globalDiscountType}
        onValueChange={handleTypeChange}
        size="sm"
      >
        <ToggleGroupItem value="fixed" className="h-7 w-7 p-0">
          <DollarSign className="w-3 h-3" />
        </ToggleGroupItem>
        <ToggleGroupItem value="percentage" className="h-7 w-7 p-0">
          <Percent className="w-3 h-3" />
        </ToggleGroupItem>
      </ToggleGroup>
      <Input
        type="number"
        value={inputValue}
        onChange={(e) => handleValueChange(e.target.value)}
        min="0"
        step={globalDiscountType === 'percentage' ? '1' : '0.01'}
        className="h-7 w-20 text-sm"
      />
    </div>
  );
}
